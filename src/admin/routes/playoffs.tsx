import { Hono, type Context } from 'hono';
import type { Checked } from '../../checked.js';
import { deSlotForKey } from '../../domain/double-elimination.js';
import { seriesLengthFor } from '../../domain/series.js';
import { isValidTime } from '../../domain/fixture.js';
import {
  assignPositions,
  deleteBracketGame,
  isDeSlotKey,
  markBracketLive,
  recordBracketResult,
  resetBracket,
  scheduleBracketSeries,
} from '../../services/double-elimination.js';
import { clearLive, setStream, unstreamMatch } from '../../services/live.js';
import { assignSemifinalTeams, deletePlayoffGame, markPlayoffLive, phaseSlots, recordPlayoffResult, resetPlayoffs } from '../../services/playoffs.js';
import { parseGameNumber, readGameForm } from '../game-form.js';
import { loadState } from '../../services/state.js';
import type { AdminEnv, Deps } from '../context.js';
import { isDate, readBody, str } from '../form.js';
import { setFlash } from '../flash.js';
import { renderPage } from '../render.js';
import { DoubleEliminationView, PlayoffsView } from '../views/playoffs.js';

const POSITION_FIELDS = ['pos_a', 'pos_b', 'pos_c', 'pos_d', 'pos_e', 'pos_f'] as const;
const isDoubleElimination = (c: Context<AdminEnv>): boolean => c.get('tournament').format === 'double_elimination';

export function playoffRoutes(deps: Deps) {
  const app = new Hono<AdminEnv>();
  const { repo } = deps;

  /** The live verbs of a series game, shared by league playoffs and bracket series: clear, stream, unstream or mark. */
  const liveAction = (c: Context<AdminEnv>, verb: string, matchId: number | null, gameNumber: number, mark: () => Checked<void>) => {
    const tournament = c.get('tournament');
    if (verb === 'clear') {
      if (clearLive(repo, tournament, matchId, gameNumber)) setFlash(c, 'ok', 'Partida en vivo quitada.');
      else setFlash(c, 'warn', 'Ese partido ya no estaba en vivo.');
    } else if (verb === 'stream') {
      const done = setStream(repo, tournament, matchId);
      if (!done.ok) setFlash(c, 'error', done.error);
      else setFlash(c, 'ok', 'Partida pasada al stream.');
    } else if (verb === 'unstream') {
      if (unstreamMatch(repo, tournament, matchId)) setFlash(c, 'ok', 'Partida quitada del stream.');
      else setFlash(c, 'warn', 'Ese partido ya no estaba en el stream.');
    } else {
      const marked = mark();
      if (!marked.ok) setFlash(c, 'error', marked.error);
      else setFlash(c, 'ok', 'Partida marcada en vivo.');
    }
  };

  app.get('/playoffs', (c) => {
    const tournament = c.get('tournament');
    if (isDoubleElimination(c)) {
      return renderPage(
        c,
        deps,
        { title: 'Llaves', active: 'playoffs', tournament },
        <DoubleEliminationView tournament={tournament} state={loadState(repo, tournament)} now={deps.now()} />,
      );
    }
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

  // ---- Double elimination: positions A–F and the ten series. Registered before the league routes, whose
  // `/playoffs/:phase/:number/...` patterns also match these paths.

  app.post('/playoffs/posiciones', async (c) => {
    if (!isDoubleElimination(c)) return c.text('Página no encontrada.', 404);
    const tournament = c.get('tournament');
    const back = `/admin/t/${tournament.id}/playoffs`;
    const body = await readBody(c);
    if (str(body, 'action') === 'reset') {
      resetBracket(repo, tournament);
      deps.events.tournamentChanged(tournament.id);
      deps.events.capturesChanged();
      setFlash(c, 'ok', 'Llaves reiniciadas: se borraron las posiciones y los resultados.');
      return c.redirect(back, 303);
    }
    const raw = POSITION_FIELDS.map((key) => str(body, key));
    if (raw.some((value) => !/^\d+$/.test(value))) {
      setFlash(c, 'error', 'Elige los seis equipos de las posiciones A a F.');
      return c.redirect(back, 303);
    }
    const checked = assignPositions(repo, tournament, raw.map(Number));
    if (!checked.ok) setFlash(c, 'error', checked.error);
    else {
      deps.events.tournamentChanged(tournament.id);
      deps.events.capturesChanged();
      setFlash(c, 'ok', 'Posiciones guardadas.');
    }
    return c.redirect(back, 303);
  });

  /** Saves or clears one game of a bracket series. `/playoffs/llave/:key` (no game) is game 1. */
  const bracketGame = async (c: Context<AdminEnv>, gameParam: string | undefined) => {
    const key = c.req.param('key') ?? '';
    if (!isDoubleElimination(c) || !isDeSlotKey(key)) return c.text('Serie de las llaves no encontrada.', 404);
    const tournament = c.get('tournament');
    const back = `/admin/t/${tournament.id}/playoffs`;
    const body = await readBody(c);
    const gameNumber = parseGameNumber(gameParam ?? (str(body, 'game') || '1'));
    const refuse = (message: string) => {
      setFlash(c, 'error', message);
      return c.redirect(back, 303);
    };
    if (gameNumber === null) return refuse('Ese juego no existe.');
    const multi = seriesLengthFor(tournament, deSlotForKey(key).phase, false) > 1;

    if (str(body, 'action') === 'clear') {
      const removed = deleteBracketGame(repo, tournament, key, gameNumber);
      if (!removed.ok) return refuse(removed.error);
      deps.events.tournamentChanged(tournament.id);
      deps.events.capturesChanged();
      setFlash(c, 'ok', multi ? `Juego ${gameNumber} borrado.` : 'Resultado borrado.');
      return c.redirect(back, 303);
    }

    const series = loadState(repo, tournament).doubleElimination!.series.find((s) => s.key === key)!;
    const existing = series.matchId === null ? undefined : repo.listGames(series.matchId).find((g) => g.gameNumber === gameNumber);
    const input = await readGameForm(deps.dota, [series.team1Id, series.team2Id], body, existing);
    if (!input.ok) return refuse(input.error);
    const checked = recordBracketResult(repo, tournament, key, input.value.raw, { gameNumber, imported: input.value.imported });
    if (!checked.ok) return refuse(checked.error);
    deps.events.tournamentChanged(tournament.id);
    deps.events.capturesChanged();
    setFlash(c, 'ok', multi ? `Juego ${gameNumber} guardado.` : 'Resultado guardado.');
    return c.redirect(back, 303);
  };

  /** Marks (or unmarks) a game of a bracket series as the one being played right now. */
  app.post('/playoffs/llave/:key/juego/:n/en-vivo', async (c) => {
    const key = c.req.param('key');
    if (!isDoubleElimination(c) || !isDeSlotKey(key)) return c.text('Serie de las llaves no encontrada.', 404);
    const tournament = c.get('tournament');
    const back = `/admin/t/${tournament.id}/playoffs`;
    const body = await readBody(c);
    const gameNumber = parseGameNumber(c.req.param('n'));
    if (gameNumber === null) {
      setFlash(c, 'error', 'Ese juego no existe.');
      return c.redirect(back, 303);
    }
    const slot = deSlotForKey(key);
    const stored = repo.listMatches(tournament.id, slot.phase).find((m) => m.matchNumber === slot.matchNumber);
    liveAction(c, str(body, 'action'), stored?.id ?? null, gameNumber, () => markBracketLive(repo, tournament, key, gameNumber, deps.now()));
    deps.events.tournamentChanged(tournament.id);
    return c.redirect(back, 303);
  });

  /** Sets when a series is played: a date with its start time, or nothing (the public page shows it only once set). */
  app.post('/playoffs/llave/:key/horario', async (c) => {
    const key = c.req.param('key');
    if (!isDoubleElimination(c) || !isDeSlotKey(key)) return c.text('Serie de las llaves no encontrada.', 404);
    const tournament = c.get('tournament');
    const back = `/admin/t/${tournament.id}/playoffs`;
    const body = await readBody(c);
    const date = str(body, 'date');
    const time = str(body, 'time');
    const error =
      Boolean(date) !== Boolean(time)
        ? 'Indica la fecha y la hora de la serie, o deja ambas vacías para quitar el horario.'
        : date && !isDate(date)
          ? 'La fecha no es válida.'
          : time && !isValidTime(time)
            ? 'La hora no es válida (usa HH:MM).'
            : null;
    if (error) {
      setFlash(c, 'error', error);
      return c.redirect(back, 303);
    }
    const saved = scheduleBracketSeries(repo, tournament, key, { scheduledDate: date || null, startTime: time || null, endTime: null });
    if (!saved.ok) return c.text(saved.error, 404);
    deps.events.tournamentChanged(tournament.id);
    const code = deSlotForKey(key).code;
    setFlash(c, 'ok', date ? `Horario de ${code} guardado.` : `Horario de ${code} quitado.`);
    return c.redirect(back, 303);
  });

  app.post('/playoffs/llave/:key/juego/:n', (c) => bracketGame(c, c.req.param('n')));
  app.post('/playoffs/llave/:key', (c) => bracketGame(c, undefined));

  // ---- League playoffs: two semifinals and the final. A double-elimination tournament has none of them.

  app.post('/playoffs/cruces', async (c) => {
    if (isDoubleElimination(c)) return c.text('Página no encontrada.', 404);
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
    if (isDoubleElimination(c)) return c.text('Partido de playoffs no encontrado.', 404);
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
      deps.events.capturesChanged();
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
    deps.events.capturesChanged();
    setFlash(c, 'ok', multi ? `Juego ${gameNumber} guardado.` : 'Resultado guardado.');
    return c.redirect(back, 303);
  };

  /** Marks (or unmarks) a game of a semifinal/final as the one being played right now. */
  app.post('/playoffs/:phase/:number/juego/:n/en-vivo', async (c) => {
    if (isDoubleElimination(c)) return c.text('Partido de playoffs no encontrado.', 404);
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
    const kind = phase as 'semifinal' | 'final';
    const stored = repo.listMatches(tournament.id, kind).find((m) => m.matchNumber === number);
    liveAction(c, str(body, 'action'), stored?.id ?? null, gameNumber, () =>
      markPlayoffLive(repo, tournament, loadState(repo, tournament), kind, number, gameNumber, deps.now()),
    );
    deps.events.tournamentChanged(tournament.id);
    return c.redirect(back, 303);
  });

  app.post('/playoffs/:phase/:number/juego/:n', (c) => playoffGame(c, c.req.param('n')));
  app.post('/playoffs/:phase/:number', (c) => playoffGame(c, undefined));

  return app;
}
