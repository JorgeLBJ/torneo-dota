import { randomBytes } from 'node:crypto';
import type { Clock } from '../clock.js';

/** How long a freshly created observer token can be shown again (for example after an accidental refresh). */
export const REVEAL_TTL_MS = 10 * 60_000;

interface Reveal {
  adminId: number;
  observerId: number;
  name: string;
  token: string;
  expiresAt: number;
}

export interface RevealedToken {
  observerId: number;
  name: string;
  token: string;
}

/**
 * Where a just-created observer token waits between the POST and the redirected GET.
 *
 * The guarantee: the plaintext lives only in this process's memory, for at most REVEAL_TTL_MS, and is handed only
 * to the admin who created it. It is never written to the database, a cookie, a flash, the URL (only the opaque
 * random id travels there) or a log. A server restart drops every entry on purpose: the admin revokes the
 * observer and creates another.
 */
export class ObserverRevealStore {
  private readonly entries = new Map<string, Reveal>();

  constructor(private readonly now: Clock) {}

  /** Stores the token and returns the opaque, unguessable id for the redirect. */
  put(adminId: number, observerId: number, name: string, token: string): string {
    this.sweep();
    const id = randomBytes(24).toString('base64url');
    this.entries.set(id, { adminId, observerId, name, token, expiresAt: this.now().getTime() + REVEAL_TTL_MS });
    return id;
  }

  /** The token for this id, only while it has not expired and only for the admin who created it. */
  get(id: string, adminId: number): RevealedToken | undefined {
    this.sweep();
    const entry = this.entries.get(id);
    if (!entry || entry.adminId !== adminId) return undefined;
    return { observerId: entry.observerId, name: entry.name, token: entry.token };
  }

  /** Forgets every reveal of this observer (it was revoked). */
  dropObserver(observerId: number): void {
    for (const [id, entry] of this.entries) if (entry.observerId === observerId) this.entries.delete(id);
  }

  private sweep(): void {
    const now = this.now().getTime();
    for (const [id, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(id);
  }
}
