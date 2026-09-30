import { Hono, type Context } from 'hono';
import { seriesLengthFor } from '../../domain/series.js';
import { clearLive } from '../../services/live.js';
import { assignSemifinalTeams, deletePlayoffGame, markPlayoffLive, phaseSlots, recordPlayoffResult, resetPlayoffs } from '../../services/playoffs.js';
import { parseGameNumber, readGameForm } from '../game-form.js';
import { loadState } from '../../services/state.js';
import type { AdminEnv, Deps } from '../context.js';
import { readBody, str } from '../form.js';
import { setFlash } from '../flash.js';
import { renderPage } from '../render.js';
import { PlayoffsView } from '../views/playoffs.js';

export function playoffRoutes(deps: Deps) {
  const app = new Hono<AdminEnv>();
  const { repo } = deps;

  app.get('/playoffs', (c) => {
    const tournament = c.get('tournament');
    return renderPage(
      c,
      deps,
      { title: 'Playoffs', active: 'playoffs', tournament },
      <PlayoffsView
        tournament={tournament}
        state={loadState(repo, tournament)}
        now={deps.now()}
        slots={{
          semifinal: phaseSlots(repo, tournament.id, 'semifinal'),
          final: phaseSlots(repo, tournament.id, 'final'),
        }}
      />,
    );
  });

  app.post('/playoffs/cruces', async (c) => {
    const tournament = c.get('tournament');
    const back = `/admin/t/${tournament.id}/playoffs`;
    const body = await readBody(c);
    const raw = ['sf1_a', 'sf1_b', 'sf2_a', 'sf2_b'].map((key) => str(body, key));
    // Undo: the "Quitar cruces manuales" button, or the form sent with all four selects empty.
    const allEmpty = raw.every((value) => value === '');
    const hasResults = repo.listMatches(tournament.id).some((m) => m.phase !== 'group' && m.winnerId !== null);
    // An empty form is a reset only while no playoff result would be lost; deleting results needs the confirm dialog.
    if (allEmpty && hasResults && str(body, 'action') !== 'reset') {
      setFlash(c, 'error', 'Hay resultados de playoffs cargados: usa «Quitar cruces manuales» para confirmar el borrado.');
      return c.redirect(back, 303);
    }
    if (str(body, 'action') === 'reset' || allEmpty) {
      resetPlayoffs(repo, tournament);
      deps.events.tournamentChanged(tournament.id);
      setFlash(c, 'ok', 'Cruces manuales quitados: los cruces se calculan desde la tabla.');
      return c.redirect(back, 303);
    }
    const ids = raw.map((value) => Number(value || Number.NaN));
    if (!ids.every((id) => Number.isInteger(id))) {
      setFlash(c, 'error', 'Elige los cuatro equipos o deja los cuatro vacíos para volver al cálculo automático.');
      return c.redirect(back, 303);
    }
    const checked = assignSemifinalTeams(repo, tournament, ids as [number, number, number, number]);
    if (!checked.ok) setFlash(c, 'error', checked.error);
    else {
      deps.events.tournamentChanged(tournament.id);
      setFlash(c, 'ok', 'Cruces de semifinales guardados.');
    }
    return c.redirect(back, 303);
  });

  /** Saves or clears one game of a semifinal/final series. `/playoffs/:phase/:number` (no game) is game 1. */
  const playoffGame = async (c: Context<AdminEnv>, gameParam: string | undefined) => {
    const tournament = c.get('tournament');
    const phase = c.req.param('phase');
    const number = Number(c.req.param('number'));
    const valid =
      (phase === 'semifinal' && (number === 1 || number === 2)) || (phase === 'final' && number === 1);
    if (!valid) return c.text('Partido de playoffs no encontrado.', 404);
    const kind = phase as 'semifinal' | 'final';
    const back = `/admin/t/${tournament.id}/playoffs`;
    const body = await readBody(c);
    const gameNumber = parseGameNumber(gameParam ?? (str(body, 'game') || '1'));
    const refuse = (message: string) => {
      setFlash(c, 'error', message);
      return c.redirect(back, 303);
    };
    if (gameNumber === null) return refuse('Ese juego no existe.');
    const multi = seriesLengthFor(tournament, kind, false) > 1;

    if (str(body, 'action') === 'clear') {
      const removed = deletePlayoffGame(repo, tournament, kind, number, gameNumber);
      if (!removed.ok) return refuse(removed.error);
      deps.events.tournamentChanged(tournament.id);
      setFlash(c, 'ok', multi ? `Juego ${gameNumber} borrado.` : 'Resultado borrado.');
      return c.redirect(back, 303);
    }

    const state = loadState(repo, tournament);
    const slot = kind === 'final' ? state.bracket.final : state.bracket.semifinals[number - 1]!;
    const existingMatch = state.playoffMatches.find((m) => m.id === slot.matchId);
    const existing = existingMatch ? repo.listGames(existingMatch.id).find((g) => g.gameNumber === gameNumber) : undefined;
    const input = await readGameForm(deps.dota, [slot.team1Id, slot.team2Id], body, existing);
    if (!input.ok) return refuse(input.error);
    const checked = recordPlayoffResult(repo, tournament, state, kind, number, input.value.raw, { gameNumber, imported: input.value.imported });
    if (!checked.ok) return refuse(checked.error);
    deps.events.tournamentChanged(tournament.id);
    setFlash(c, 'ok', multi ? `Juego ${gameNumber} guardado.` : 'Resultado guardado.');
    return c.redirect(back, 303);
  };

  /** Marks (or unmarks) a game of a semifinal/final as the one being played right now. */
  app.post('/playoffs/:phase/:number/juego/:n/en-vivo', async (c) => {
    const tournament = c.get('tournament');
    const phase = c.req.param('phase');
    const number = Number(c.req.param('number'));
    const valid = (phase === 'semifinal' && (number === 1 || number === 2)) || (phase === 'final' && number === 1);
    if (!valid) return c.text('Partido de playoffs no encontrado.', 404);
    const back = `/admin/t/${tournament.id}/playoffs`;
    const body = await readBody(c);
    const gameNumber = parseGameNumber(c.req.param('n'));
    if (gameNumber === null) {
      setFlash(c, 'error', 'Ese juego no existe.');
      return c.redirect(back, 303);
    }
    if (str(body, 'action') === 'clear') {
      clearLive(repo, tournament);
      setFlash(c, 'ok', 'Partida en vivo quitada.');
    } else {
      const marked = markPlayoffLive(repo, tournament, loadState(repo, tournament), phase as 'semifinal' | 'final', number, gameNumber, deps.now());
      if (!marked.ok) setFlash(c, 'error', marked.error);
      else setFlash(c, 'ok', 'Partida marcada en vivo.');
    }
    deps.events.tournamentChanged(tournament.id);
    return c.redirect(back, 303);
  });

  app.post('/playoffs/:phase/:number/juego/:n', (c) => playoffGame(c, c.req.param('n')));
  app.post('/playoffs/:phase/:number', (c) => playoffGame(c, undefined));

  return app;
}
