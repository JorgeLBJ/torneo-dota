import type { Clock } from '../clock.js';
import type { LoginRateLimiter } from '../auth/rate-limit.js';
import type { AppConfig } from '../config.js';
import type { Admin, Repository, Tournament } from '../db/repository.js';
import type { Events } from '../events.js';

export interface Deps {
  repo: Repository;
  events: Events;
  config: AppConfig;
  limiter: LoginRateLimiter;
  now: Clock;
}

/** `tournament` is only set on routes under /t/:tid (see tournamentScope). */
export type AdminEnv = { Variables: { admin: Admin; tournament: Tournament } };
