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
    this.evict(cutoff);
    return true;
  }

  /** A successful login gives the key a fresh budget. */
  reset(key: string): void {
    this.attempts.delete(key);
  }

  private evict(cutoff: number): void {
    if (this.attempts.size <= this.maxKeys) return;
    for (const [key, times] of this.attempts) {
      if (times.every((t) => t <= cutoff)) this.attempts.delete(key);
    }
    for (const key of this.attempts.keys()) {
      if (this.attempts.size <= this.maxKeys) break;
      this.attempts.delete(key);
    }
  }
}
