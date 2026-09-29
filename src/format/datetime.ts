// The one place that turns stored dates and timestamps into what people read:
//   date-only  -> DD/MM/YYYY
//   date-time  -> DD/MM/YYYY HH:mm:ss
// Stored values are never changed. A time zone is applied here and nowhere else, via the optional IANA `timeZone`.

export interface FormatOptions {
  /** IANA zone name (for example "America/Lima"). Defaults to UTC, which is how SQLite stores timestamps. */
  timeZone?: string;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

interface Parts {
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
  second: string;
}

function toDate(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const match = TIMESTAMP.exec(value);
  if (!match) return null;
  // A timestamp without a zone (SQLite's datetime('now')) is UTC.
  const iso = match[1] ? value.replace(' ', 'T') : `${value.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function partsOf(date: Date, timeZone: string): Parts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const get = (type: Intl.DateTimeFormatPartTypes) => formatter.formatToParts(date).find((p) => p.type === type)?.value ?? '';
  return {
    day: get('day'),
    month: get('month'),
    year: get('year'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** DD/MM/YYYY. A plain "YYYY-MM-DD" is reformatted as is (a calendar date has no time zone). */
export function formatDate(value: string | Date, options: FormatOptions = {}): string {
  if (typeof value === 'string') {
    const plain = DATE_ONLY.exec(value);
    if (plain) return `${plain[3]}/${plain[2]}/${plain[1]}`;
  }
  const date = toDate(value);
  if (!date) return String(value);
  const p = partsOf(date, options.timeZone ?? 'UTC');
  return `${p.day}/${p.month}/${p.year}`;
}

/** DD/MM/YYYY HH:mm:ss for a point in time (ISO string, SQLite timestamp or Date). */
export function formatDateTime(value: string | Date, options: FormatOptions = {}): string {
  const date = toDate(value);
  if (!date) return String(value);
  const p = partsOf(date, options.timeZone ?? 'UTC');
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

/**
 * A scheduled slot: a calendar date plus an HH:MM (or HH:MM:SS) wall-clock time in the tournament's own
 * time. Nothing is converted; missing parts are simply left out.
 */
export function formatLocalDateTime(date: string | null, time: string | null): string {
  const day = date ? formatDate(date) : '';
  const clock = time ? (time.length === 5 ? `${time}:00` : time) : '';
  return [day, clock].filter(Boolean).join(' ');
}
