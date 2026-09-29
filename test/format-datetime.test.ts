import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatLocalDateTime } from '../src/format/datetime.js';

describe('formatDate', () => {
  it('writes DD/MM/YYYY for a calendar date without touching time zones', () => {
    expect(formatDate('2026-10-03')).toBe('03/10/2026');
    expect(formatDate('2026-01-31', { timeZone: 'Pacific/Kiritimati' })).toBe('31/01/2026');
  });

  it('takes the date part of a timestamp', () => {
    expect(formatDate('2026-09-29 02:13:45')).toBe('29/09/2026');
    expect(formatDate(new Date('2026-12-31T23:30:00Z'))).toBe('31/12/2026');
  });

  it('hands back text it cannot read instead of inventing a date', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate('not a date')).toBe('not a date');
  });
});

describe('formatDateTime', () => {
  it('writes DD/MM/YYYY HH:mm:ss', () => {
    expect(formatDateTime('2026-09-29 02:13:45')).toBe('29/09/2026 02:13:45');
    expect(formatDateTime('2026-10-03T14:00:00Z')).toBe('03/10/2026 14:00:00');
    expect(formatDateTime('2026-10-03T14:00:00.123Z')).toBe('03/10/2026 14:00:00');
    expect(formatDateTime(new Date('2026-10-03T14:05:09Z'))).toBe('03/10/2026 14:05:09');
  });

  it('reads SQLite timestamps (no zone) as UTC', () => {
    expect(formatDateTime('2026-10-03 23:59:59')).toBe('03/10/2026 23:59:59');
  });

  it('applies an IANA time zone when one is given, and only then', () => {
    expect(formatDateTime('2026-10-03 23:30:00', { timeZone: 'America/Lima' })).toBe('03/10/2026 18:30:00');
    expect(formatDateTime('2026-10-03 23:30:00', { timeZone: 'Asia/Tokyo' })).toBe('04/10/2026 08:30:00');
    expect(formatDateTime('2026-10-03 23:30:00', { timeZone: 'UTC' })).toBe('03/10/2026 23:30:00');
  });

  it('renders midnight as 00, not 24', () => {
    expect(formatDateTime('2026-10-03 00:00:00')).toBe('03/10/2026 00:00:00');
  });

  it('hands back text it cannot read', () => {
    expect(formatDateTime('')).toBe('');
    expect(formatDateTime('yesterday')).toBe('yesterday');
  });
});

describe('formatLocalDateTime', () => {
  it('joins a scheduled date and an HH:MM wall-clock time', () => {
    expect(formatLocalDateTime('2026-10-03', '14:00')).toBe('03/10/2026 14:00:00');
    expect(formatLocalDateTime('2026-10-03', '14:00:30')).toBe('03/10/2026 14:00:30');
  });

  it('degrades to the parts that exist', () => {
    expect(formatLocalDateTime('2026-10-03', null)).toBe('03/10/2026');
    expect(formatLocalDateTime(null, '14:00')).toBe('14:00:00');
    expect(formatLocalDateTime(null, null)).toBe('');
  });
});
