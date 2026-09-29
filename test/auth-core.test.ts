import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/db/open.js';
import { createRepository, type Repository } from '../src/db/repository.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { LoginRateLimiter } from '../src/auth/rate-limit.js';
import { ensureInitialAdmin } from '../src/auth/bootstrap.js';
import { SESSION_TTL_MS, createSession, destroySession, resolveSession } from '../src/auth/session.js';
import { createEvents } from '../src/events.js';

describe('password hashing', () => {
  it('hashes with a random salt and verifies the right password only', async () => {
    const h1 = await hashPassword('correct horse');
    const h2 = await hashPassword('correct horse');
    expect(h1).not.toBe(h2);
    expect(h1).not.toContain('correct horse');
    expect(h1.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse', h1)).toBe(true);
    expect(await verifyPassword('wrong', h1)).toBe(false);
  });

  it('rejects malformed stored hashes instead of throwing', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$1$2$3$a$b')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });
});

describe('LoginRateLimiter', () => {
  it('allows 5 attempts per key within the window, then blocks and recovers', () => {
    let now = 1_000;
    const limiter = new LoginRateLimiter({ maxFailures: 5, windowMs: 60_000, now: () => now });
    for (let i = 0; i < 5; i++) expect(limiter.consume('1.1.1.1')).toBe(true);
    expect(limiter.consume('1.1.1.1')).toBe(false);
    expect(limiter.consume('2.2.2.2')).toBe(true);
    now += 60_001;
    expect(limiter.consume('1.1.1.1')).toBe(true);
  });

  it('counts an attempt atomically, before any async work can interleave', () => {
    const limiter = new LoginRateLimiter({ maxFailures: 3, windowMs: 60_000 });
    const results = Array.from({ length: 6 }, () => limiter.consume('ip'));
    expect(results.filter(Boolean)).toHaveLength(3);
  });

  it('clears the counter on success', () => {
    const limiter = new LoginRateLimiter({ maxFailures: 2, windowMs: 60_000 });
    limiter.consume('ip');
    limiter.consume('ip');
    limiter.reset('ip');
    expect(limiter.consume('ip')).toBe(true);
  });

  it('never evicts a key that is currently blocked while an unblocked one can go', () => {
    let now = 0;
    const limiter = new LoginRateLimiter({ maxFailures: 2, windowMs: 60_000, maxKeys: 2, now: () => now });
    limiter.consume('attacker');
    limiter.consume('attacker');
    expect(limiter.consume('attacker')).toBe(false); // blocked
    now += 1;
    limiter.consume('a');
    now += 1;
    limiter.consume('b'); // over capacity: 'a' (not blocked) goes, 'attacker' stays
    expect(limiter.size).toBe(2);
    expect(limiter.consume('attacker')).toBe(false);
  });

  it('stays bounded: expired keys are evicted first, then the oldest key', () => {
    let now = 0;
    const limiter = new LoginRateLimiter({ maxFailures: 5, windowMs: 1_000, maxKeys: 3, now: () => now });
    for (const key of ['a', 'b', 'c']) limiter.consume(key);
    expect(limiter.size).toBe(3);
    now += 1_001;
    limiter.consume('d');
    expect(limiter.size).toBe(1);
    for (const key of ['e', 'f', 'g', 'h']) limiter.consume(key);
    expect(limiter.size).toBeLessThanOrEqual(3);
    expect(limiter.consume('h')).toBe(true);
  });
});

describe('sessions and bootstrap', () => {
  let db: Database.Database;
  let repo: Repository;
  beforeEach(() => {
    db = openDatabase(':memory:');
    repo = createRepository(db);
  });
  afterEach(() => db.close());

  it('creates the initial admin from ADMIN_PASSWORD only when none exists', async () => {
    await ensureInitialAdmin(repo, 'a-strong-password');
    const admin = repo.getAdminByUsername('admin');
    expect(admin).toBeDefined();
    expect(admin?.passwordHash).not.toContain('a-strong-password');
    await ensureInitialAdmin(repo, 'other-password');
    expect(repo.countAdmins()).toBe(1);
    expect(await verifyPassword('a-strong-password', admin!.passwordHash)).toBe(true);
  });

  it('reports what happened instead of refusing to start when there is no ADMIN_PASSWORD', async () => {
    expect(await ensureInitialAdmin(repo, undefined)).toBe('setup-required');
    expect(await ensureInitialAdmin(repo, '')).toBe('setup-required');
    expect(repo.countAdmins()).toBe(0);
    expect(await ensureInitialAdmin(repo, 'a-strong-password')).toBe('created');
    expect(await ensureInitialAdmin(repo, undefined)).toBe('exists');
  });

  it('stores only a hash of the session token and expires after 7 days', () => {
    const admin = repo.createAdmin('root', 'hash');
    const now = new Date('2026-10-01T00:00:00.000Z');
    const token = createSession(repo, admin.id, now);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(db.prepare('SELECT id FROM sessions').pluck().get()).not.toBe(token);
    expect(resolveSession(repo, token, now)?.id).toBe(admin.id);
    const later = new Date(now.getTime() + SESSION_TTL_MS - 1000);
    expect(resolveSession(repo, token, later)?.id).toBe(admin.id);
    const expired = new Date(now.getTime() + SESSION_TTL_MS + 1000);
    expect(resolveSession(repo, token, expired)).toBeUndefined();
    expect(resolveSession(repo, 'nope', now)).toBeUndefined();
  });

  it('destroys sessions', () => {
    const admin = repo.createAdmin('root', 'hash');
    const now = new Date();
    const token = createSession(repo, admin.id, now);
    destroySession(repo, token);
    expect(resolveSession(repo, token, now)).toBeUndefined();
  });
});

describe('events', () => {
  it('notifies subscribers of a tournament and supports unsubscribing', () => {
    const events = createEvents();
    const seen: number[] = [];
    const off = events.onTournamentChanged(7, () => seen.push(7));
    events.onTournamentChanged(8, () => seen.push(8));
    events.tournamentChanged(7);
    events.tournamentChanged(8);
    off();
    events.tournamentChanged(7);
    expect(seen).toEqual([7, 8]);
  });

  it('emits the tournament:<id>:changed event name', () => {
    const events = createEvents();
    let fired = 0;
    events.emitter.on('tournament:3:changed', () => fired++);
    events.tournamentChanged(3);
    expect(fired).toBe(1);
  });
});
