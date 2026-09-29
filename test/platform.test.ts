import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assetUrl } from '../src/assets.js';
import { createEvents } from '../src/events.js';
import { makeApp, type TestApp } from './helpers/app.js';

describe('events', () => {
  it('announces every tournament change to global listeners and unsubscribes cleanly', () => {
    const events = createEvents();
    const seen: number[] = [];
    const off = events.onAnyChanged((id) => seen.push(id));
    events.tournamentChanged(3);
    events.tournamentChanged(7);
    off();
    events.tournamentChanged(9);
    expect(seen).toEqual([3, 7]);
    expect(events.emitter.listenerCount('tournament:any:changed')).toBe(0);
  });

  it('keeps per-tournament listeners scoped to their tournament', () => {
    const events = createEvents();
    let hits = 0;
    events.onTournamentChanged(1, () => hits++);
    events.tournamentChanged(2);
    events.tournamentChanged(1);
    expect(hits).toBe(1);
  });
});

describe('assetUrl', () => {
  it('fingerprints the file so long-lived caching is safe', () => {
    expect(assetUrl('admin.css')).toMatch(/^\/assets\/admin\.css\?v=[0-9a-f]{10}$/);
    expect(assetUrl('admin.css')).toBe(assetUrl('admin.css'));
  });

  it('falls back to the bare path for a missing file', () => {
    expect(assetUrl('nope.css')).toBe('/assets/nope.css');
  });
});

describe('platform headers', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeApp();
  });
  afterEach(() => t.db.close());

  it('caches static assets for a year', async () => {
    const res = await t.get('/assets/admin.css');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('forbids framing of the backoffice, login included', async () => {
    for (const path of ['/admin/login', '/admin']) {
      const res = await t.get(path);
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    }
  });

  it('links fingerprinted assets from the backoffice layout', async () => {
    const html = await (await t.get('/admin/login')).text();
    expect(html).toMatch(/href="\/assets\/admin\.css\?v=[0-9a-f]{10}"/);
  });
});
