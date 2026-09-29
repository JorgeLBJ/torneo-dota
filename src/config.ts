export interface AppConfig {
  /** Set the Secure flag on the session cookie (behind HTTPS). */
  secureCookies: boolean;
  /** Trust X-Forwarded-* headers from a reverse proxy. */
  trustProxy: boolean;
  /** Clock override for tests. */
  now?: () => Date;
}

const flag = (value: string | undefined) => value === '1' || value?.toLowerCase() === 'true';

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    secureCookies: flag(env.COOKIE_SECURE),
    trustProxy: flag(env.TRUST_PROXY),
  };
}
