import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

export type FlashKind = 'ok' | 'error' | 'warn';

export interface Flash {
  kind: FlashKind;
  message: string;
}

const COOKIE = 'flash';
const KINDS: FlashKind[] = ['ok', 'error', 'warn'];

/** One-shot message shown on the next rendered page (post/redirect/get). */
export function setFlash(c: Context, kind: FlashKind, message: string): void {
  setCookie(c, COOKIE, JSON.stringify({ kind, message }), {
    path: '/admin',
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 60,
  });
}

export function takeFlash(c: Context): Flash | undefined {
  const raw = getCookie(c, COOKIE);
  if (!raw) return undefined;
  deleteCookie(c, COOKIE, { path: '/admin' });
  try {
    const parsed = JSON.parse(raw) as Partial<Flash>;
    if (typeof parsed.message === 'string' && KINDS.includes(parsed.kind as FlashKind)) {
      return { kind: parsed.kind as FlashKind, message: parsed.message.slice(0, 500) };
    }
  } catch {
    // Ignore a tampered cookie.
  }
  return undefined;
}
