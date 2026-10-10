import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/open.js';
import { createRepository, type Repository } from '../src/db/repository.js';

let db: Database.Database;
let repo: Repository;
beforeEach(() => {
  db = openDatabase(':memory:');
  repo = createRepository(db);
});
afterEach(() => db.close());

describe('observer tokens', () => {
  it('creates a token row without exposing the hash', () => {
    const row = repo.createObserverToken('Juan', 'a'.repeat(64), 'aaaaaa');
    expect(row).toMatchObject({ name: 'Juan', tokenPrefix: 'aaaaaa', lastSeenAt: null, revokedAt: null });
    expect(row.id).toBeGreaterThan(0);
    expect(row.createdAt).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain('a'.repeat(64));
  });

  it('lists newest first', () => {
    repo.createObserverToken('Uno', '1'.repeat(64), '111111');
    repo.createObserverToken('Dos', '2'.repeat(64), '222222');
    expect(repo.listObserverTokens().map((o) => o.name)).toEqual(['Dos', 'Uno']);
  });

  it('finds only active tokens by hash', () => {
    const row = repo.createObserverToken('Juan', 'b'.repeat(64), 'bbbbbb');
    expect(repo.findActiveObserverByHash('b'.repeat(64))?.id).toBe(row.id);
    expect(repo.findActiveObserverByHash('c'.repeat(64))).toBeUndefined();
    repo.revokeObserverToken(row.id);
    expect(repo.findActiveObserverByHash('b'.repeat(64))).toBeUndefined();
    expect(repo.listObserverTokens()[0]!.revokedAt).toBeTruthy();
  });

  it('keeps the first revocation time when revoked twice', () => {
    const row = repo.createObserverToken('Juan', 'd'.repeat(64), 'dddddd');
    repo.revokeObserverToken(row.id);
    db.prepare("UPDATE observer_tokens SET revoked_at = '2020-01-01 00:00:00'").run();
    repo.revokeObserverToken(row.id);
    expect(repo.listObserverTokens()[0]!.revokedAt).toBe('2020-01-01 00:00:00');
  });

  it('touches last seen', () => {
    const row = repo.createObserverToken('Juan', 'e'.repeat(64), 'eeeeee');
    repo.touchObserverLastSeen(row.id);
    expect(repo.listObserverTokens()[0]!.lastSeenAt).toBeTruthy();
  });

  it('rejects duplicate hashes and blank names at the database level', () => {
    repo.createObserverToken('Juan', 'f'.repeat(64), 'ffffff');
    expect(() => repo.createObserverToken('Otro', 'f'.repeat(64), 'ffffff')).toThrow();
    expect(() => repo.createObserverToken('  ', '0'.repeat(64), '000000')).toThrow();
  });
});
