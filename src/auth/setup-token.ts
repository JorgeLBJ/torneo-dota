import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 24 random bytes = 192 bits, url-safe. */
export const generateSetupToken = (): string => randomBytes(24).toString('base64url');

/** The operator's ADMIN_SETUP_TOKEN when set, otherwise a fresh random one for this run. */
export function resolveSetupToken(fromEnv: string | undefined): { token: string; generated: boolean } {
  const configured = fromEnv?.trim();
  return configured ? { token: configured, generated: false } : { token: generateSetupToken(), generated: true };
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Constant-time comparison (both sides are hashed first, so lengths do not leak either). */
export const tokensMatch = (given: string, expected: string): boolean => timingSafeEqual(digest(given), digest(expected));
