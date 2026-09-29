import type { Context } from 'hono';

export type Body = Record<string, string | File | (string | File)[]>;

export async function readBody(c: Context): Promise<Body> {
  return (await c.req.parseBody({ all: true })) as Body;
}

/** Trimmed single string value ('' when missing). */
export function str(body: Body, key: string): string {
  const value = body[key];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first.trim() : '';
}

/** Raw (untrimmed) single string value, for multi-line text. */
export function rawStr(body: Body, key: string): string {
  const value = body[key];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first.replace(/\r\n/g, '\n') : '';
}

/** All string values for a repeated field, in order. */
export function strList(body: Body, key: string): string[] {
  const value = body[key];
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string');
}

/** Parses a non-negative-or-negative integer written in plain digits; null when invalid or empty. */
export function intOrNull(value: string): number | null {
  return /^-?\d{1,9}$/.test(value) ? Number(value) : null;
}

export function positiveInt(value: string): number | null {
  const n = intOrNull(value);
  return n !== null && n > 0 ? n : null;
}

export const isDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
};
