import { Hono } from 'hono';
import { hashObserverToken } from '../auth/observer-token.js';
import { LoginRateLimiter } from '../auth/rate-limit.js';
import type { Repository } from '../db/repository.js';

/** A full spectator payload with every data block enabled is tens of KB; 1 MB leaves a wide margin. */
export const GSI_MAX_BODY_BYTES = 1024 * 1024;
/** Per token and minute. GSI posts about once a second plus heartbeats, so this is several times the real rate. */
export const GSI_RATE_LIMIT = 300;
export const GSI_FINAL_STATE = 'DOTA_GAMERULES_STATE_POST_GAME';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A Dota match id is a positive integer (sent as a digit string, "0" while no match exists). */
export function parseMatchId(value: unknown): number | null {
  const n = typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Public endpoint the Dota client posts to; authenticated only by the observer token inside the body. */
export function gsiRoutes({ repo }: { repo: Repository }) {
  const app = new Hono();
  const limiter = new LoginRateLimiter({ maxFailures: GSI_RATE_LIMIT, windowMs: 60_000 });

  // The 1 MB body cap is applied in createApp, next to the global 64 KB one it replaces for this path.
  app.post(
    '/gsi',
    async (c) => {
      let body: unknown;
      try {
        body = JSON.parse(await c.req.text());
      } catch {
        return c.json({ error: 'invalid_json' }, 400);
      }
      if (!isObject(body)) return c.json({ error: 'invalid_json' }, 400);

      // Hash first, then look up the hash: the plaintext never reaches SQL or logs.
      const { auth, ...state } = body;
      const token = isObject(auth) && typeof auth.token === 'string' ? auth.token : '';
      const observer = token ? repo.findActiveObserverByHash(hashObserverToken(token)) : undefined;
      if (!observer) return c.json({ error: 'unauthorized' }, 401);
      if (!limiter.consume(String(observer.id))) return c.json({ error: 'rate_limited' }, 429);

      repo.touchObserverLastSeen(observer.id);
      const map = isObject(state.map) ? state.map : {};
      const matchId = parseMatchId(map.matchid);
      if (matchId !== null) {
        const gameState = typeof map.game_state === 'string' ? map.game_state : null;
        repo.upsertGsiCapture(matchId, observer.id, gameState, gameState === GSI_FINAL_STATE, JSON.stringify(state));
      }
      return c.json({ ok: true });
    },
  );

  return app;
}
