import { Hono, type Context } from 'hono';
import type { Match } from '../../db/repository.js';
import { loadState } from '../../services/state.js';
import { seriesLengthFor } from '../../domain/series.js';
import { deleteGameResult, saveGameResult } from '../../services/games.js';
import { clearLive, markLive, setStream, unstreamMatch } from '../../services/live.js';
import { parseGameNumber, readGameForm } from '../game-form.js';
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
    const dates = [...new Set(state.allGroupMatches.map((m) => m.scheduledDate).filter((d): d is string => d !== null))].sort();
    const hasUndated = state.allGroupMatches.some((m) => m.scheduledDate === null);

    // Default: the first day that still has a playable pending match, otherwise everything.
    const pendingDay = dates.find((d) =>
      state.allGroupMatches.some((m) => m.scheduledDate === d && m.winnerId === null && m.team1Id !== null && m.team2Id !== null),
    );
    const filter = parseFilter(c.req.query('fecha')) ?? pendingDay ?? 'todos';
    const shown = state.allGroupMatches.filter((m) =>
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
        gamesByMatch={state.gamesByMatch}
        liveMarks={state.liveMarks}
        now={deps.now()}
      />,
    );
  });

  /** Saves or clears one game of a group match. `/resultados/:mid` (no game) is game 1, as it always was. */
  const saveGame = async (c: Context<AdminEnv>, gameParam: string | undefined) => {
    const tournament = c.get('tournament');
    const id = Number(c.req.param('mid'));
    const match: Match | undefined = Number.isInteger(id) ? repo.getMatch(id) : undefined;
    if (!match || match.tournamentId !== tournament.id || match.phase !== 'group') {
      return c.text('Partido no encontrado.', 404);
    }
    const body = await readBody(c);
    const gameNumber = parseGameNumber(gameParam ?? (str(body, 'game') || '1'));
    const filter = parseFilter(str(body, 'fecha'));
    const back = `/admin/t/${tournament.id}/resultados${filter ? `?fecha=${filter}` : ''}`;
    const refuse = (message: string) => {
      setFlash(c, 'error', message);
      return c.redirect(back, 303);
    };
    if (gameNumber === null) return refuse('Ese juego no existe.');
    const multi = seriesLengthFor(tournament, match.phase, match.isTiebreak) > 1;

    if (str(body, 'action') === 'clear') {
      const removed = deleteGameResult(repo, tournament, match, gameNumber);
      if (!removed.ok) return refuse(removed.error);
      deps.events.tournamentChanged(tournament.id);
      setFlash(c, 'ok', multi ? `Juego ${gameNumber} borrado.` : 'Resultado borrado.');
      return c.redirect(back, 303);
    }

    const input = await readGameForm(deps.dota, [match.team1Id, match.team2Id], body, repo.listGames(match.id).find((g) => g.gameNumber === gameNumber));
    if (!input.ok) return refuse(input.error);
    const saved = saveGameResult(repo, tournament, match, gameNumber, input.value.raw, input.value.imported);
    if (!saved.ok) return refuse(saved.error);
    deps.events.tournamentChanged(tournament.id);
    setFlash(c, 'ok', multi ? `Juego ${gameNumber} del partido ${match.matchNumber} guardado.` : `Resultado del partido ${match.matchNumber} guardado.`);
    return c.redirect(back, 303);
  };

  /** Marks (or unmarks) a game of a group match as the one being played right now. */
  app.post('/resultados/:mid/juego/:n/en-vivo', async (c) => {
    const tournament = c.get('tournament');
    const id = Number(c.req.param('mid'));
    const match: Match | undefined = Number.isInteger(id) ? repo.getMatch(id) : undefined;
    if (!match || match.tournamentId !== tournament.id || match.phase !== 'group') return c.text('Partido no encontrado.', 404);
    const body = await readBody(c);
    const filter = parseFilter(str(body, 'fecha'));
    const back = `/admin/t/${tournament.id}/resultados${filter ? `?fecha=${filter}` : ''}`;
    const gameNumber = parseGameNumber(c.req.param('n'));
    if (gameNumber === null) {
      setFlash(c, 'error', 'Ese juego no existe.');
      return c.redirect(back, 303);
    }
    const verb = str(body, 'action');
    if (verb === 'clear') {
      if (clearLive(repo, tournament, match.id, gameNumber)) setFlash(c, 'ok', 'Partida en vivo quitada.');
      else setFlash(c, 'warn', 'Ese partido ya no estaba en vivo.');
    } else if (verb === 'stream') {
      const done = setStream(repo, tournament, match.id);
      if (!done.ok) setFlash(c, 'error', done.error);
      else setFlash(c, 'ok', `Partido ${match.matchNumber} pasado al stream.`);
    } else if (verb === 'unstream') {
      if (unstreamMatch(repo, tournament, match.id)) setFlash(c, 'ok', 'Partida quitada del stream.');
      else setFlash(c, 'warn', 'Ese partido ya no estaba en el stream.');
    } else {
      const marked = markLive(repo, tournament, match, gameNumber, deps.now());
      if (!marked.ok) setFlash(c, 'error', marked.error);
      else setFlash(c, 'ok', `Partido ${match.matchNumber} marcado en vivo.`);
    }
    deps.events.tournamentChanged(tournament.id);
    return c.redirect(back, 303);
  });

  app.post('/resultados/:mid/juego/:n', (c) => saveGame(c, c.req.param('n')));
  app.post('/resultados/:mid', (c) => saveGame(c, undefined));

  return app;
}
