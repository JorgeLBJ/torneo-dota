import type { Clock } from '../clock.js';
import type { LoginRateLimiter } from '../auth/rate-limit.js';
import type { AppConfig } from '../config.js';
import type { Admin, Repository, Tournament } from '../db/repository.js';
import type { Events } from '../events.js';
import type { DotaMatchSource } from '../dota/source.js';
import type { ImageStore } from '../storage/image-store.js';

export interface Deps {
  repo: Repository;
  events: Events;
  config: AppConfig;
  /** Login and first-run setup attempts, keyed by client address. */
  limiter: LoginRateLimiter;
  /** Change-password attempts, keyed by admin id, so they cannot lock anyone out of logging in. */
  accountLimiter: LoginRateLimiter;
  now: Clock;
  /** Where custom team images live, or null when they are switched off. */
  images: ImageStore | null;
  /** Looks up Dota matches (server side only, so the browser never talks to the data provider). */
  dota: DotaMatchSource;
  /** Image uploads, keyed by admin id. */
  uploadLimiter: LoginRateLimiter;
}

/** `tournament` is only set on routes under /t/:tid (see tournamentScope). */
export type AdminEnv = { Variables: { admin: Admin; tournament: Tournament } };
