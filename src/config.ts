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
  /** Clock override for tests. */
  now?: () => Date;
}

const flag = (value: string | undefined) => value === '1' || value?.toLowerCase() === 'true';

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    secureCookies: flag(env.COOKIE_SECURE),
    trustProxy: flag(env.TRUST_PROXY),
    streamParentHosts: (env.STREAM_PARENT_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean),
  };
}
