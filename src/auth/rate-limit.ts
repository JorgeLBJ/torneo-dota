export interface RateLimiterOptions {
  maxFailures?: number;
  windowMs?: number;
  /** Upper bound on tracked keys, so a flood of distinct clients cannot grow memory without limit. */
  maxKeys?: number;
  now?: () => number;
}

/**
 * In-memory login-attempt limiter per key (typically the client IP).
 * `consume` checks and counts in one synchronous step, so concurrent requests
 * cannot all pass the check before any of them is recorded.
 */
export class LoginRateLimiter {
  private readonly attempts = new Map<string, number[]>();
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: RateLimiterOptions = {}) {
    this.maxFailures = options.maxFailures ?? 5;
    this.windowMs = options.windowMs ?? 60_000;
    this.maxKeys = options.maxKeys ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.attempts.size;
  }

  /** Counts an attempt; returns false (without counting) when the key is over the limit. */
  consume(key: string): boolean {
    const now = this.now();
    const cutoff = now - this.windowMs;
    const recent = (this.attempts.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.maxFailures) {
      this.attempts.set(key, recent);
      return false;
    }
    recent.push(now);
    // Re-insert so Map order tracks recency of use (oldest key first).
    this.attempts.delete(key);
    this.attempts.set(key, recent);
    this.evict(cutoff, key);
    return true;
  }

  /** A successful login gives the key a fresh budget. */
  reset(key: string): void {
    this.attempts.delete(key);
  }

  /**
   * Keeps the map within `maxKeys`. Drops, in order: keys with no attempt left in the window, then the
   * oldest keys that are not blocked, and only when every key is blocked the oldest of those. A blocked
   * key is the one that must not be forgotten, and the key just used is never the victim.
   */
  private evict(cutoff: number, current: string): void {
    if (this.attempts.size <= this.maxKeys) return;
    for (const [key, times] of this.attempts) {
      if (key !== current && times.every((t) => t <= cutoff)) this.attempts.delete(key);
    }
    const dropOldest = (shouldDrop: (times: number[]) => boolean) => {
      for (const [key, times] of this.attempts) {
        if (this.attempts.size <= this.maxKeys) return;
        if (key !== current && shouldDrop(times)) this.attempts.delete(key);
      }
    };
    dropOldest((times) => times.filter((t) => t > cutoff).length < this.maxFailures);
    dropOldest(() => true);
  }
}
