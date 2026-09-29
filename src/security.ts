import type { Context, MiddlewareHandler } from 'hono';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

/**
 * CSRF defence for state-changing requests: the Origin (or, if absent, the
 * Referer) must point at this same host. Missing both is rejected.
 */
export function sameOriginGuard(options: { trustProxy: boolean }): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    const source = hostOf(c.req.header('origin')) ?? hostOf(c.req.header('referer'));
    const allowed = new Set([new URL(c.req.url).host]);
    const forwarded = c.req.header('x-forwarded-host');
    if (options.trustProxy && forwarded) for (const h of forwarded.split(',')) allowed.add(h.trim());
    if (source === null || !allowed.has(source)) {
      return c.text('Solicitud rechazada: origen no permitido.', 403);
    }
    return next();
  };
}

/**
 * Client address used to key the login rate limiter.
 * Behind a trusted proxy the right-most X-Forwarded-For entry is the one the
 * proxy itself appended; anything to its left is client-controlled.
 */
export function clientKey(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const hops = c.req.header('x-forwarded-for')?.split(',');
    const last = hops?.[hops.length - 1]?.trim();
    if (last) return last;
  }
  return c.env?.incoming?.socket?.remoteAddress ?? 'unknown';
}
