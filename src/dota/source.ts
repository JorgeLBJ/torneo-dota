import type { DotaSnapshot } from './snapshot.js';

export type DotaLookupCode = 'not_found' | 'rate_limited' | 'unavailable' | 'incomplete';

/** A lookup that failed in a way the admin should be told about (the message is Spanish, ready to show). */
export class DotaLookupError extends Error {
  constructor(
    readonly code: DotaLookupCode,
    message: string,
  ) {
    super(message);
  }
}

/** Port: where Dota match data comes from. The application never talks to a concrete service. */
export interface DotaMatchSource {
  fetch(matchId: number): Promise<DotaSnapshot>;
}

const TTL_MS = 10 * 60_000;

/** Remembers successful lookups in memory for 10 minutes (errors are never cached). */
export class CachedDotaSource implements DotaMatchSource {
  private readonly entries = new Map<number, { at: number; snapshot: DotaSnapshot }>();

  constructor(
    private readonly inner: DotaMatchSource,
    private readonly now: () => number = Date.now,
    private readonly options: { maxEntries?: number } = {},
  ) {}

  async fetch(matchId: number): Promise<DotaSnapshot> {
    const hit = this.entries.get(matchId);
    if (hit && this.now() - hit.at < TTL_MS) return hit.snapshot;
    const snapshot = await this.inner.fetch(matchId);
    this.entries.delete(matchId);
    this.entries.set(matchId, { at: this.now(), snapshot });
    const max = this.options.maxEntries ?? 50;
    while (this.entries.size > max) this.entries.delete(this.entries.keys().next().value as number);
    return snapshot;
  }
}
