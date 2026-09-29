import { createHash, randomBytes } from 'node:crypto';
import type { Admin, Repository } from '../db/repository.js';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Only a SHA-256 of the cookie token is stored, so a DB leak does not leak live sessions. */
const sessionId = (token: string) => createHash('sha256').update(token).digest('hex');

/** Returns the cookie token for a new 7-day session. */
export function createSession(repo: Repository, adminId: number, now: Date = new Date()): string {
  const token = randomBytes(32).toString('hex');
  repo.deleteExpiredSessions(now.toISOString());
  repo.createSession(sessionId(token), adminId, new Date(now.getTime() + SESSION_TTL_MS).toISOString());
  return token;
}

export function resolveSession(repo: Repository, token: string, now: Date = new Date()): Admin | undefined {
  const session = repo.getValidSession(sessionId(token), now.toISOString());
  return session ? repo.getAdminById(session.adminId) : undefined;
}

export function destroySession(repo: Repository, token: string): void {
  repo.deleteSession(sessionId(token));
}
