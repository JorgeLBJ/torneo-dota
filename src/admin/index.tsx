import { Hono } from 'hono';
import { sameOriginGuard } from '../security.js';
import type { AdminEnv, Deps } from './context.js';
import { loginRoutes, logoutRoutes, requireAdmin } from './routes/auth.js';
import { configRoutes } from './routes/config.js';
import { fixtureRoutes } from './routes/fixture.js';
import { playoffRoutes } from './routes/playoffs.js';
import { resultRoutes } from './routes/results.js';
import { rulesRoutes } from './routes/rules.js';
import { tournamentScope } from './routes/scope.js';
import { streamRoutes } from './routes/stream.js';
import { teamRoutes } from './routes/teams.js';
import { tournamentListRoutes } from './routes/tournaments.js';
import { userRoutes } from './routes/users.js';

/** Everything mounted under /admin. */
export function adminApp(deps: Deps) {
  const app = new Hono<AdminEnv>();
  // The backoffice must never be framed (clickjacking); the public site, embedded in Google Sites, may be.
  app.use('*', async (c, next) => {
    await next();
    c.res.headers.set('X-Frame-Options', 'DENY');
    c.res.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
  });
  app.use('*', sameOriginGuard({ trustProxy: deps.config.trustProxy }));
  app.route('/', loginRoutes(deps));
  app.use('*', requireAdmin(deps));
  app.route('/', logoutRoutes(deps));
  app.use('/t/:tid/*', tournamentScope(deps));
  app.route('/', userRoutes(deps));
  app.route('/', tournamentListRoutes(deps));
  for (const routes of [configRoutes, streamRoutes, rulesRoutes, teamRoutes, fixtureRoutes, resultRoutes, playoffRoutes]) app.route('/t/:tid', routes(deps));
  return app;
}
