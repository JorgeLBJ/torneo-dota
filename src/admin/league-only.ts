import type { MiddlewareHandler } from 'hono';
import type { AdminEnv } from './context.js';
import { tournamentHomePath } from './views/layout.js';

/**
 * Guards the group-stage screens (Fixture, Resultados): a double-elimination tournament has none, so its pages
 * redirect to Llaves and its commands are not found (nothing may create group matches for it).
 */
export const leagueOnly: MiddlewareHandler<AdminEnv> = async (c, next) => {
  const tournament = c.get('tournament');
  if (tournament.format !== 'double_elimination') return next();
  if (c.req.method === 'GET') return c.redirect(tournamentHomePath(tournament), 303);
  return c.text('Página no encontrada.', 404);
};
