import { Hono } from 'hono';
import type { Match } from '../../db/repository.js';
import { loadState } from '../../services/state.js';
import { validateResult } from '../../services/results.js';
import type { AdminEnv, Deps } from '../context.js';
import { isDate, readBody, str } from '../form.js';
import { setFlash } from '../flash.js';
import { renderPage } from '../render.js';
import { ResultsView } from '../views/results.js';

/** Accepts only a real date, "sin-fecha" or "todos"; anything else means "no explicit filter". */
const parseFilter = (value: string | undefined): string | undefined =>
  value && (value === 'todos' || value === 'sin-fecha' || isDate(value)) ? value : undefined;

export function resultRoutes(deps: Deps) {
  const app = new Hono<AdminEnv>();
  const { repo } = deps;

  app.get('/resultados', (c) => {
    const tournament = c.get('tournament');
    const state = loadState(repo, tournament);
    const dates = [...new Set(state.groupMatches.map((m) => m.scheduledDate).filter((d): d is string => d !== null))].sort();
    const hasUndated = state.groupMatches.some((m) => m.scheduledDate === null);

    // Default: the first day that still has a playable pending match, otherwise everything.
    const pendingDay = dates.find((d) =>
      state.groupMatches.some((m) => m.scheduledDate === d && m.winnerId === null && m.team1Id !== null && m.team2Id !== null),
    );
    const filter = parseFilter(c.req.query('fecha')) ?? pendingDay ?? 'todos';
    const shown = state.groupMatches.filter((m) =>
      filter === 'todos' ? true : filter === 'sin-fecha' ? m.scheduledDate === null : m.scheduledDate === filter,
    );

    return renderPage(
      c,
      deps,
      { title: 'Resultados', active: 'resultados', tournament },
      <ResultsView
        tournament={tournament}
        cards={shown.map((match) => ({
          match,
          team1: match.team1Id === null ? null : (state.teamsById.get(match.team1Id) ?? null),
          team2: match.team2Id === null ? null : (state.teamsById.get(match.team2Id) ?? null),
        }))}
        dates={dates}
        hasUndated={hasUndated}
        filter={filter}
        standings={state.standings}
      />,
    );
  });

  app.post('/resultados/:mid', async (c) => {
    const tournament = c.get('tournament');
    const id = Number(c.req.param('mid'));
    const match: Match | undefined = Number.isInteger(id) ? repo.getMatch(id) : undefined;
    if (!match || match.tournamentId !== tournament.id || match.phase !== 'group') {
      return c.text('Partido no encontrado.', 404);
    }
    const body = await readBody(c);
    const filter = parseFilter(str(body, 'fecha'));
    const back = `/admin/t/${tournament.id}/resultados${filter ? `?fecha=${filter}` : ''}`;

    if (str(body, 'action') === 'clear') {
      repo.clearResult(match.id);
      deps.events.tournamentChanged(tournament.id);
      setFlash(c, 'ok', 'Resultado borrado.');
      return c.redirect(back, 303);
    }

    const checked = validateResult([match.team1Id, match.team2Id], {
      winner: str(body, 'winner'),
      t1Kills: str(body, 't1_kills'),
      t1Deaths: str(body, 't1_deaths'),
      t2Kills: str(body, 't2_kills'),
      t2Deaths: str(body, 't2_deaths'),
    });
    if (!checked.ok) {
      setFlash(c, 'error', checked.error);
      return c.redirect(back, 303);
    }
    repo.recordResult(match.id, checked.value);
    deps.events.tournamentChanged(tournament.id);
    setFlash(c, 'ok', `Resultado del partido ${match.matchNumber} guardado.`);
    return c.redirect(back, 303);
  });

  return app;
}
