// Time zone arithmetic on top of Intl only (no dependencies). Instants are stored as ISO UTC
// ("2026-10-03T19:00:00Z"); wall-clock inputs are interpreted in a tournament's IANA zone.

const DAY_MS = 86_400_000;

/** Zones offered in the admin, default first. Any valid IANA name is accepted by the backend. */
export const TIMEZONE_CHOICES: readonly string[] = [
  'America/Lima',
  'America/Bogota',
  'America/Mexico_City',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/Sao_Paulo',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/Madrid',
  'Europe/London',
  'Europe/Paris',
  'UTC',
];

export function isValidTimeZone(timeZone: string): boolean {
  // Canonical spelling only ("America/Lima" or "UTC"): Intl alone would also take "america/lima".
  if (timeZone !== 'UTC' && !/^[A-Z][A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return true;
  } catch {
    return false;
  }
}

interface Fields {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function fieldsIn(instant: number, timeZone: string): Fields {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

/** Milliseconds the zone's wall clock is ahead of UTC at this instant. */
function offsetMs(instant: number, timeZone: string): number {
  const f = fieldsIn(instant, timeZone);
  return Date.UTC(f.y, f.mo - 1, f.d, f.h, f.mi, f.s) - Math.floor(instant / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * "2026-10-03" + "14:00" read in `timeZone` -> "2026-10-03T19:00:00Z".
 * A wall-clock time that does not exist (spring-forward gap) moves forward; one that happens twice
 * (fall-back) resolves to its first occurrence.
 */
export function zonedToUtc(date: string, time: string, timeZone: string): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi, s = 0] = time.split(':').map(Number) as [number, number, number?];
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offBefore = offsetMs(guess - DAY_MS, timeZone);
  const offAfter = offsetMs(guess + DAY_MS, timeZone);
  const candidates = [...new Set([guess - offBefore, guess - offAfter])].filter(
    (c) => offsetMs(c, timeZone) === guess - c,
  );
  const instant = candidates.length > 0 ? Math.min(...candidates) : guess - offBefore;
  return new Date(instant).toISOString().replace('.000Z', 'Z');
}

/** An ISO UTC instant as the zone's local calendar date and HH:MM. */
export function utcToZoned(iso: string, timeZone: string): { date: string; time: string } {
  const f = fieldsIn(new Date(iso).getTime(), timeZone);
  return { date: `${f.y}-${pad(f.mo)}-${pad(f.d)}`, time: `${pad(f.h)}:${pad(f.mi)}` };
}
