export interface AppConfig {
  /** Set the Secure flag on the session cookie (behind HTTPS). */
  secureCookies: boolean;
  /** Trust X-Forwarded-* headers from a reverse proxy. */
  trustProxy: boolean;
  /** Interval between SSE heartbeats (ms). Defaults to 25 s, under typical proxy idle timeouts. */
  heartbeatMs?: number;
  /** Caps on concurrent SSE connections: in total and per client address. */
  sseLimits?: { global: number; perIp: number };
  /** Ancestor hosts Twitch embeds must name (STREAM_PARENT_HOSTS). Empty: request host + sites.google.com. */
  streamParentHosts?: string[];
  /** Code required by /admin/setup while no admin exists (from ADMIN_SETUP_TOKEN or generated at startup). */
  setupToken?: string;
  /** Public origin for absolute share URLs (PUBLIC_BASE_URL), e.g. https://torneo-dota.jpsolutions.app. Unset: the request origin. */
  publicBaseUrl?: string;
  /** Clock override for tests. */
  now?: () => Date;
}

const flag = (value: string | undefined) => value === '1' || value?.toLowerCase() === 'true';

/** An http(s) origin without trailing slash, or undefined when the value is missing or not such a URL. */
export function parseBaseUrl(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return `${url.origin}${url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')}`;
  } catch {
    return undefined;
  }
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    secureCookies: flag(env.COOKIE_SECURE),
    trustProxy: flag(env.TRUST_PROXY),
    publicBaseUrl: parseBaseUrl(env.PUBLIC_BASE_URL),
    streamParentHosts: (env.STREAM_PARENT_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean),
  };
}
