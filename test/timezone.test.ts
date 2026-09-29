import { describe, expect, it } from 'vitest';
import { TIMEZONE_CHOICES, isValidTimeZone, utcToZoned, zonedToUtc } from '../src/format/timezone.js';
import { formatDateTime } from '../src/format/datetime.js';

describe('isValidTimeZone', () => {
  it('accepts IANA names and rejects everything else', () => {
    expect(isValidTimeZone('America/Lima')).toBe(true);
    expect(isValidTimeZone('Europe/Madrid')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('lima')).toBe(false);
  });

  it('offers only valid zones, with Lima first', () => {
    expect(TIMEZONE_CHOICES[0]).toBe('America/Lima');
    expect(TIMEZONE_CHOICES).toContain('Europe/Madrid');
    expect(TIMEZONE_CHOICES.every(isValidTimeZone)).toBe(true);
  });
});

describe('zonedToUtc', () => {
  it('converts a Lima wall-clock time (UTC-5, no DST)', () => {
    expect(zonedToUtc('2026-10-03', '14:00', 'America/Lima')).toBe('2026-10-03T19:00:00Z');
    expect(zonedToUtc('2026-10-03', '23:30', 'America/Lima')).toBe('2026-10-04T04:30:00Z');
  });

  it('follows daylight saving time', () => {
    // Madrid: UTC+2 in summer, UTC+1 in winter.
    expect(zonedToUtc('2026-07-01', '12:00', 'Europe/Madrid')).toBe('2026-07-01T10:00:00Z');
    expect(zonedToUtc('2026-12-01', '12:00', 'Europe/Madrid')).toBe('2026-12-01T11:00:00Z');
    // New York: the day before and after the spring change (2026-03-08).
    expect(zonedToUtc('2026-03-07', '12:00', 'America/New_York')).toBe('2026-03-07T17:00:00Z');
    expect(zonedToUtc('2026-03-09', '12:00', 'America/New_York')).toBe('2026-03-09T16:00:00Z');
  });

  it('resolves the DST gap forward and the repeated hour to its first occurrence', () => {
    // 02:30 does not exist on 2026-03-29 in Madrid (02:00 jumps to 03:00): read as 03:30 local.
    expect(zonedToUtc('2026-03-29', '02:30', 'Europe/Madrid')).toBe('2026-03-29T01:30:00Z');
    // 02:30 happens twice on 2026-10-25 in Madrid: the first (still summer time, UTC+2).
    expect(zonedToUtc('2026-10-25', '02:30', 'Europe/Madrid')).toBe('2026-10-25T00:30:00Z');
  });

  it('is the identity in UTC', () => {
    expect(zonedToUtc('2026-10-03', '14:00', 'UTC')).toBe('2026-10-03T14:00:00Z');
  });
});

describe('utcToZoned', () => {
  it('gives the local date and HH:MM in the zone', () => {
    expect(utcToZoned('2026-10-03T19:00:00Z', 'America/Lima')).toEqual({ date: '2026-10-03', time: '14:00' });
    // The same instant is already the next day in Madrid.
    expect(utcToZoned('2026-10-03T19:00:00Z', 'Europe/Madrid')).toEqual({ date: '2026-10-03', time: '21:00' });
    expect(utcToZoned('2026-10-03T23:00:00Z', 'Europe/Madrid')).toEqual({ date: '2026-10-04', time: '01:00' });
  });

  it('round-trips with zonedToUtc', () => {
    for (const tz of ['America/Lima', 'Europe/Madrid', 'Asia/Kolkata', 'America/New_York']) {
      const iso = zonedToUtc('2026-11-15', '18:45', tz);
      expect(utcToZoned(iso, tz)).toEqual({ date: '2026-11-15', time: '18:45' });
    }
  });
});

describe('formatDateTime with a tournament zone', () => {
  it('renders a stored UTC instant in the tournament zone', () => {
    expect(formatDateTime('2026-10-03T19:00:00Z', { timeZone: 'America/Lima' })).toBe('03/10/2026 14:00:00');
  });
});
