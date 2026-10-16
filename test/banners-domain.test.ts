import { describe, expect, it } from 'vitest';
import { BANNER_TABS, bannerState, findBannerConflict, windowsOverlap, type WindowedBanner } from '../src/domain/banners.js';

const banner = (over: Partial<WindowedBanner> & { id: number }): WindowedBanner => ({
  active: true,
  startsAt: null,
  endsAt: null,
  ...over,
});

describe('windowsOverlap (half-open [start, end))', () => {
  it('two open-ended windows overlap', () => {
    expect(windowsOverlap({ startsAt: null, endsAt: null }, { startsAt: null, endsAt: null })).toBe(true);
  });

  it('an open window overlaps any bounded one', () => {
    expect(windowsOverlap({ startsAt: null, endsAt: null }, { startsAt: '2026-10-18T05:00:00Z', endsAt: '2026-10-19T05:00:00Z' })).toBe(true);
  });

  it('null start is -infinity and null end is +infinity', () => {
    const early = { startsAt: null, endsAt: '2026-10-18T05:00:00Z' };
    const late = { startsAt: '2026-10-20T05:00:00Z', endsAt: null };
    expect(windowsOverlap(early, late)).toBe(false);
    expect(windowsOverlap(early, { startsAt: '2026-10-17T05:00:00Z', endsAt: null })).toBe(true);
  });

  it('windows that intersect overlap', () => {
    const a = { startsAt: '2026-10-16T05:00:00Z', endsAt: '2026-10-18T05:00:00Z' };
    const b = { startsAt: '2026-10-17T05:00:00Z', endsAt: '2026-10-19T05:00:00Z' };
    expect(windowsOverlap(a, b)).toBe(true);
    expect(windowsOverlap(b, a)).toBe(true);
  });

  it('a window inside another overlaps', () => {
    const outer = { startsAt: '2026-10-16T05:00:00Z', endsAt: '2026-10-25T05:00:00Z' };
    const inner = { startsAt: '2026-10-18T05:00:00Z', endsAt: '2026-10-19T05:00:00Z' };
    expect(windowsOverlap(outer, inner)).toBe(true);
  });

  it('touching edges do not overlap: the end instant belongs to the next window', () => {
    const a = { startsAt: '2026-10-16T05:00:00Z', endsAt: '2026-10-18T05:00:00Z' };
    const b = { startsAt: '2026-10-18T05:00:00Z', endsAt: '2026-10-20T05:00:00Z' };
    expect(windowsOverlap(a, b)).toBe(false);
    expect(windowsOverlap(b, a)).toBe(false);
  });

  it('disjoint windows do not overlap', () => {
    const a = { startsAt: '2026-10-10T05:00:00Z', endsAt: '2026-10-11T05:00:00Z' };
    const b = { startsAt: '2026-10-18T05:00:00Z', endsAt: '2026-10-19T05:00:00Z' };
    expect(windowsOverlap(a, b)).toBe(false);
  });
});

describe('findBannerConflict', () => {
  const others = [
    banner({ id: 1, startsAt: '2026-10-16T05:00:00Z', endsAt: '2026-10-18T05:00:00Z' }),
    banner({ id: 2, startsAt: '2026-10-18T05:00:00Z', endsAt: '2026-10-25T05:00:00Z' }),
  ];

  it('returns the active banner whose window intersects the candidate', () => {
    const candidate = banner({ id: 9, startsAt: '2026-10-17T05:00:00Z', endsAt: '2026-10-17T07:00:00Z' });
    expect(findBannerConflict(others, candidate)?.id).toBe(1);
  });

  it('returns undefined when the candidate fits in a gap or touches an edge', () => {
    const touching = banner({ id: 9, startsAt: '2026-10-25T05:00:00Z', endsAt: null });
    expect(findBannerConflict(others, touching)).toBeUndefined();
  });

  it('the banner being edited never conflicts with itself', () => {
    const editing = banner({ id: 1, startsAt: '2026-10-16T05:00:00Z', endsAt: '2026-10-18T05:00:00Z' });
    expect(findBannerConflict(others, editing)).toBeUndefined();
  });

  it('an inactive candidate never conflicts', () => {
    const off = banner({ id: 9, active: false });
    expect(findBannerConflict(others, off)).toBeUndefined();
  });

  it('inactive banners never conflict with an active candidate', () => {
    const list = [banner({ id: 1, active: false })];
    expect(findBannerConflict(list, banner({ id: 9 }))).toBeUndefined();
  });

  it('a new banner (no id) is checked against everything', () => {
    const candidate = { active: true, startsAt: null, endsAt: null };
    expect(findBannerConflict(others, candidate)?.id).toBe(1);
  });
});

describe('bannerState', () => {
  const now = new Date('2026-10-17T12:00:00Z');

  it('inactive wins over any window', () => {
    expect(bannerState(banner({ id: 1, active: false, startsAt: '2026-10-16T00:00:00Z' }), now)).toBe('inactive');
  });

  it('showing: active and inside the window', () => {
    expect(bannerState(banner({ id: 1, startsAt: '2026-10-16T00:00:00Z', endsAt: '2026-10-18T00:00:00Z' }), now)).toBe('showing');
  });

  it('showing with no dates at all', () => {
    expect(bannerState(banner({ id: 1 }), now)).toBe('showing');
  });

  it('scheduled: starts later', () => {
    expect(bannerState(banner({ id: 1, startsAt: '2026-10-18T00:00:00Z' }), now)).toBe('scheduled');
  });

  it('ended: its end has passed, and the end instant itself is already over', () => {
    expect(bannerState(banner({ id: 1, endsAt: '2026-10-17T00:00:00Z' }), now)).toBe('ended');
    expect(bannerState(banner({ id: 1, endsAt: '2026-10-17T12:00:00Z' }), now)).toBe('ended');
  });

  it('the start instant itself is already showing', () => {
    expect(bannerState(banner({ id: 1, startsAt: '2026-10-17T12:00:00Z' }), now)).toBe('showing');
  });
});

describe('tabs', () => {
  it('uses the identifiers of the public page tabs', () => {
    expect(BANNER_TABS.map((t) => t.key)).toEqual(['partidos', 'envivo', 'posiciones', 'playoffs', 'reglas']);
  });
});
