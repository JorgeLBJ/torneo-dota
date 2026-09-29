import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

interface Core {
  dayKey(iso: string | null, tz: string): string | null;
  formatTime(iso: string, tz: string): string | null;
  formatShort(iso: string, tz: string): string | null;
  dayLabel(key: string | null): string;
  groupDays(isos: (string | null)[], tz: string): { index: number; key: string | null; label: string }[];
  isInstant(value: unknown): boolean;
  msUntilNextBoundary(isos: (string | null)[], nowMs: number): number | null;
}

/** Loads the browser file the way a browser would: as a plain script with no module system. */
function load(file: string): Record<string, unknown> {
  const sandbox: Record<string, unknown> = {};
  runInNewContext(readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8'), sandbox);
  return sandbox;
}
const core = load('site-core.js').SiteCore as Core;

const LIMA_1900 = '2026-10-03T19:00:00Z'; // 14:00 in Lima

describe('formatting in the viewer zone', () => {
  it('shows 24-hour HH:mm in the given zone', () => {
    expect(core.formatTime(LIMA_1900, 'America/Lima')).toBe('14:00');
    expect(core.formatTime(LIMA_1900, 'Europe/Madrid')).toBe('21:00');
    expect(core.formatTime('2026-10-03T23:00:00Z', 'Europe/Madrid')).toBe('01:00');
    expect(core.formatTime('2026-10-03T05:00:00Z', 'America/Lima')).toBe('00:00');
  });

  it('formats short date and time for the bracket', () => {
    expect(core.formatShort('2026-10-11T19:00:00Z', 'America/Lima')).toBe('11 Oct · 14:00');
    expect(core.formatShort('2026-10-11T23:30:00Z', 'Europe/Madrid')).toBe('12 Oct · 01:30');
  });

  it('labels a day in Spanish', () => {
    expect(core.dayLabel('2026-10-03')).toMatch(/^sábado,? 0?3 de octubre$/);
    expect(core.dayLabel(null)).toBe('Sin fecha');
  });
});

describe('grouping by the viewer calendar day', () => {
  // Lima evening matches: 14:00, 17:00 and 20:00 local.
  const isos = ['2026-10-03T19:00:00Z', '2026-10-03T22:00:00Z', '2026-10-04T01:00:00Z'];

  it('keeps one day for a viewer in the tournament zone', () => {
    // The 20:00 Lima match (01:00Z on the 4th) is still the 3rd in Lima.
    const groups = core.groupDays(isos, 'America/Lima');
    expect(groups.map((g) => [g.index, g.key])).toEqual([[0, '2026-10-03']]);
  });

  it('moves a late match to the next day for a viewer in Madrid', () => {
    // Madrid is UTC+2 in October: 21:00, 00:00 (next day) and 03:00 (next day).
    const groups = core.groupDays(isos, 'Europe/Madrid');
    expect(groups.map((g) => [g.index, g.key])).toEqual([
      [0, '2026-10-03'],
      [1, '2026-10-04'],
    ]);
    expect(groups[1]!.label).toMatch(/^domingo,? 0?4 de octubre$/);
  });

  it('puts unscheduled items under "Sin fecha" at the end', () => {
    const groups = core.groupDays([LIMA_1900, null], 'America/Lima');
    expect(groups.map((g) => g.label)).toEqual([groups[0]!.label, 'Sin fecha']);
    expect(groups[1]).toMatchObject({ index: 1, key: null });
  });

  it('returns nothing for an empty list', () => {
    expect(core.groupDays([], 'UTC')).toEqual([]);
  });
});

describe('bad input never throws: the server text stays', () => {
  it('recognises real instants only', () => {
    expect(core.isInstant('2026-10-03T19:00:00Z')).toBe(true);
    for (const bad of ['', 'garbage', null, undefined, 42, '2026-13-45T99:00:00Z']) expect(core.isInstant(bad)).toBe(false);
  });

  it('returns null instead of throwing for an invalid instant or zone', () => {
    expect(core.formatTime('garbage', 'UTC')).toBeNull();
    expect(core.formatShort('garbage', 'UTC')).toBeNull();
    expect(core.formatTime(LIMA_1900, 'Not/AZone')).toBeNull();
    expect(core.dayKey('garbage', 'UTC')).toBeNull();
  });
});

describe('msUntilNextBoundary', () => {
  const now = Date.parse('2026-10-03T19:30:00Z');
  it('is the time to the next start or end that is still ahead', () => {
    const isos = ['2026-10-03T19:00:00Z', '2026-10-03T20:00:00Z', '2026-10-03T21:00:00Z'];
    expect(core.msUntilNextBoundary(isos, now)).toBe(30 * 60_000);
    expect(core.msUntilNextBoundary(isos, Date.parse('2026-10-03T20:00:00Z'))).toBe(60 * 60_000);
  });
  it('ignores the past, nulls and garbage, and is null when nothing is ahead', () => {
    expect(core.msUntilNextBoundary(['2026-10-03T19:00:00Z', null, 'garbage'], now)).toBeNull();
    expect(core.msUntilNextBoundary([], now)).toBeNull();
  });
});
