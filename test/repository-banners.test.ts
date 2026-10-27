import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/open.js';
import { createRepository, type NewBanner, type Repository } from '../src/db/repository.js';

let db: Database.Database;
let repo: Repository;
let tid: number;
beforeEach(() => {
  db = openDatabase(':memory:');
  repo = createRepository(db);
  tid = repo.createTournament({ name: 'Cup', slug: 'cup' }).id;
});
afterEach(() => db.close());

const input = (over: Partial<NewBanner> = {}): NewBanner => ({
  name: 'Grand Final',
  altText: 'Grand Final BO5',
  imageKey: 'banners/1/abc.webp',
  imageWidth: 1920,
  imageHeight: 1080,
  imageKeySmall: 'banners/1/abc-1280.webp',
  imageWidthSmall: 1280,
  ctaText: 'Ver playoffs',
  ctaTab: 'playoffs',
  active: true,
  startsAt: null,
  endsAt: null,
  ...over,
});

describe('promo_banners schema', () => {
  it('migration 015 is applied (user_version at least 15)', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(17);
  });

  it('rejects an unknown CTA tab and a window that ends before it starts', () => {
    expect(() => repo.createBanner(tid, input({ ctaTab: 'inicio' as never }))).toThrow();
    expect(() => repo.createBanner(tid, input({ startsAt: '2026-10-18T05:00:00Z', endsAt: '2026-10-18T05:00:00Z' }))).toThrow();
    expect(() => repo.createBanner(tid, input({ startsAt: '2026-10-18T05:00:00Z', endsAt: '2026-10-17T05:00:00Z' }))).toThrow();
  });
});

describe('banner CRUD', () => {
  it('creates and reads back a banner with version 1', () => {
    const b = repo.createBanner(tid, input({ startsAt: '2026-10-16T23:00:00Z', endsAt: '2026-10-18T05:00:00Z' }));
    expect(repo.getBanner(b.id)).toEqual(b);
    expect(b).toMatchObject({
      tournamentId: tid,
      name: 'Grand Final',
      altText: 'Grand Final BO5',
      imageKey: 'banners/1/abc.webp',
      imageWidth: 1920,
      imageHeight: 1080,
      imageKeySmall: 'banners/1/abc-1280.webp',
      imageWidthSmall: 1280,
      ctaText: 'Ver playoffs',
      ctaTab: 'playoffs',
      active: true,
      startsAt: '2026-10-16T23:00:00Z',
      endsAt: '2026-10-18T05:00:00Z',
      version: 1,
    });
  });

  it('stores a button-less banner with null CTA fields', () => {
    const b = repo.createBanner(tid, input({ ctaText: null, ctaTab: null, active: false }));
    expect(b).toMatchObject({ ctaText: null, ctaTab: null, active: false });
  });

  it('lists only the banners of the tournament, newest first', () => {
    const other = repo.createTournament({ name: 'Other', slug: 'other' }).id;
    const a = repo.createBanner(tid, input({ name: 'A' }));
    const b = repo.createBanner(tid, input({ name: 'B' }));
    repo.createBanner(other, input({ name: 'Elsewhere' }));
    expect(repo.listBanners(tid).map((x) => x.id)).toEqual([b.id, a.id]);
  });

  it('updates fields and bumps the version; the image stays when no new keys are given', () => {
    const b = repo.createBanner(tid, input());
    const u = repo.updateBanner(b.id, { name: 'Renamed', altText: 'Alt', ctaText: null, ctaTab: null, active: false, startsAt: null, endsAt: null })!;
    expect(u).toMatchObject({ name: 'Renamed', altText: 'Alt', ctaText: null, active: false, imageKey: b.imageKey, imageKeySmall: b.imageKeySmall, version: 2 });
  });

  it('replaces the image keys and sizes when new ones are given', () => {
    const b = repo.createBanner(tid, input());
    const u = repo.updateBanner(b.id, {
      name: b.name, altText: b.altText, ctaText: b.ctaText, ctaTab: b.ctaTab, active: true, startsAt: null, endsAt: null,
      image: { key: 'banners/1/new.webp', width: 1600, height: 900, keySmall: 'banners/1/new-1280.webp', widthSmall: 1280 },
    })!;
    expect(u).toMatchObject({ imageKey: 'banners/1/new.webp', imageWidth: 1600, imageHeight: 900, imageKeySmall: 'banners/1/new-1280.webp', imageWidthSmall: 1280 });
  });

  it('toggles active and bumps the version', () => {
    const b = repo.createBanner(tid, input());
    expect(repo.setBannerActive(b.id, false)).toMatchObject({ active: false, version: 2 });
    expect(repo.setBannerActive(b.id, true)).toMatchObject({ active: true, version: 3 });
  });

  it('returns undefined when updating a banner that is gone', () => {
    expect(repo.setBannerActive(999, true)).toBeUndefined();
  });

  it('deletes a banner', () => {
    const b = repo.createBanner(tid, input());
    repo.deleteBanner(b.id);
    expect(repo.getBanner(b.id)).toBeUndefined();
  });

  it('is removed with its tournament (cascade)', () => {
    const b = repo.createBanner(tid, input());
    db.prepare('DELETE FROM tournaments WHERE id = ?').run(tid);
    expect(repo.getBanner(b.id)).toBeUndefined();
  });
});

describe('findShowingBanner', () => {
  const now = new Date('2026-10-17T12:00:00Z');

  it('returns the active banner whose window contains now', () => {
    const b = repo.createBanner(tid, input({ startsAt: '2026-10-17T00:00:00Z', endsAt: '2026-10-18T00:00:00Z' }));
    expect(repo.findShowingBanner(tid, now)?.id).toBe(b.id);
  });

  it('returns a banner with no dates while it is active', () => {
    const b = repo.createBanner(tid, input());
    expect(repo.findShowingBanner(tid, now)?.id).toBe(b.id);
  });

  it('ignores scheduled, ended and inactive banners', () => {
    repo.createBanner(tid, input({ startsAt: '2026-10-18T00:00:00Z', endsAt: null }));
    repo.createBanner(tid, input({ startsAt: null, endsAt: '2026-10-17T12:00:00Z' }));
    repo.createBanner(tid, input({ active: false }));
    expect(repo.findShowingBanner(tid, now)).toBeUndefined();
  });

  it('ignores the banners of other tournaments', () => {
    const other = repo.createTournament({ name: 'Other', slug: 'other' }).id;
    repo.createBanner(other, input());
    expect(repo.findShowingBanner(tid, now)).toBeUndefined();
  });
});
