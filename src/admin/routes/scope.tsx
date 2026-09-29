import { createMiddleware } from 'hono/factory';
import type { AdminEnv, Deps } from '../context.js';
import { renderPage } from '../render.js';

/** Resolves `/t/:tid/...` to a tournament (404 page when it does not exist). */
export function tournamentScope(deps: Deps) {
  return createMiddleware<AdminEnv>(async (c, next) => {
    const id = Number(c.req.param('tid'));
    const tournament = Number.isInteger(id) ? deps.repo.getTournamentById(id) : undefined;
    if (!tournament) {
      return renderPage(
        c,
        deps,
        { title: 'No encontrado', active: 'torneos', tournament: deps.repo.getActiveTournament(), status: 404 },
        <div class="card">
          <h1>Torneo no encontrado</h1>
          <p class="sub">
            <a href="/admin/torneos">Volver a Torneos</a>
          </p>
        </div>,
      );
    }
    c.set('tournament', tournament);
    return next();
  });
}
