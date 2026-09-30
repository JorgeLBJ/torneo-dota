import { Hono } from 'hono';
import { TIEBREAKER_KEYS, type TiebreakerKey } from '../../db/repository.js';
import type { AdminEnv, Deps } from '../context.js';
import { intOrNull, rawStr, readBody, str } from '../form.js';
import { isSeriesLength, type SeriesLength } from '../../domain/series.js';
import { setFlash } from '../flash.js';
import { renderPage } from '../render.js';
import { RulesView } from '../views/rules.js';

const KNOWN: readonly TiebreakerKey[] = TIEBREAKER_KEYS;

const PHASES = [
  { field: 'group_games', key: 'groupGames', phase: 'group', label: 'la fase de grupos' },
  { field: 'semifinal_games', key: 'semifinalGames', phase: 'semifinal', label: 'las semifinales' },
  { field: 'final_games', key: 'finalGames', phase: 'final', label: 'la final' },
] as const;
const MAX_RULES_LENGTH = 20000;

/** The submitted order: any list (even empty) of known criteria, none repeated. */
function parseOrder(csv: string): TiebreakerKey[] | null {
  const keys = csv.split(',').map((k) => k.trim()).filter((k) => k !== '');
  const valid = new Set(keys).size === keys.length && keys.every((k) => KNOWN.includes(k as TiebreakerKey));
  return valid ? (keys as TiebreakerKey[]) : null;
}

function move(order: TiebreakerKey[], key: TiebreakerKey, delta: -1 | 1): TiebreakerKey[] {
  const from = order.indexOf(key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return order;
  const next = [...order];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

export function rulesRoutes(deps: Deps) {
  const app = new Hono<AdminEnv>();
  const { repo } = deps;

  app.get('/reglas', (c) => {
    const tournament = c.get('tournament');
    return renderPage(c, deps, { title: 'Reglas', active: 'reglas', tournament }, <RulesView tournament={tournament} />);
  });

  app.post('/reglas', async (c) => {
    const tournament = c.get('tournament');
    const body = await readBody(c);
    const error = (message: string) => {
      setFlash(c, 'error', message);
      return c.redirect(`/admin/t/${tournament.id}/reglas`, 303);
    };

    const pointsWin = intOrNull(str(body, 'points_win'));
    const pointsLoss = intOrNull(str(body, 'points_loss'));
    if (pointsWin === null || pointsLoss === null || pointsWin < 0 || pointsLoss < 0 || pointsWin > 99 || pointsLoss > 99) {
      return error('Los puntos deben ser números enteros entre 0 y 99.');
    }
    if (pointsWin < pointsLoss) return error('Los puntos por victoria deben ser mayores o iguales a los de derrota.');

    const legs = str(body, 'group_legs');
    if (legs !== '1' && legs !== '2') return error('Elige un formato de fase de grupos válido.');

    let tiebreakers = parseOrder(str(body, 'tiebreakers'));
    if (!tiebreakers) return error('El orden de desempate no es válido.');
    const action = str(body, 'action');
    const editMatch = /^(up|down|remove):(\w+)$/.exec(action);
    if (editMatch && KNOWN.includes(editMatch[2] as TiebreakerKey)) {
      const key = editMatch[2] as TiebreakerKey;
      tiebreakers = editMatch[1] === 'remove' ? tiebreakers.filter((k) => k !== key) : move(tiebreakers, key, editMatch[1] === 'up' ? -1 : 1);
    }
    if (action === 'add') {
      const chosen = str(body, 'new_tiebreaker') as TiebreakerKey;
      if (!KNOWN.includes(chosen) || tiebreakers.includes(chosen)) return error('Elige un criterio de desempate para agregar.');
      tiebreakers = [...tiebreakers, chosen];
    }

    // Games per match in each phase. A missing field keeps the current value.
    const lengths: Partial<Record<'groupGames' | 'semifinalGames' | 'finalGames', SeriesLength>> = {};
    const games = repo.listTournamentGames(tournament.id);
    const matches = repo.listMatches(tournament.id);
    for (const { field, key, phase, label } of PHASES) {
      const raw = str(body, field);
      if (raw === '') continue;
      const value = Number(raw);
      if (!isSeriesLength(value)) return error('Elige 1, 3 o 5 partidas por partido.');
      const inPhase = new Set(matches.filter((m) => m.phase === phase && !m.isTiebreak).map((m) => m.id));
      const highest = Math.max(0, ...games.filter((g) => inPhase.has(g.matchId)).map((g) => g.gameNumber));
      if (value < highest) return error(`Hay juegos cargados hasta el juego ${highest} en ${label}: bórralos antes de reducir las partidas por partido.`);
      lengths[key] = value;
    }

    const rulesText = rawStr(body, 'rules_text');
    if (rulesText.length > MAX_RULES_LENGTH) return error('El reglamento es demasiado largo (máximo 20 000 caracteres).');

    const groupLegs = Number(legs) as 1 | 2;
    const formatChanged = groupLegs !== tournament.groupLegs && repo.listMatches(tournament.id, 'group').length > 0;
    repo.updateTournament(tournament.id, { pointsWin, pointsLoss, tiebreakers, groupLegs, rulesText, ...lengths });
    deps.events.tournamentChanged(tournament.id);
    if (formatChanged) setFlash(c, 'warn', 'Reglas guardadas. Regenera el fixture para aplicar el nuevo formato.');
    else setFlash(c, 'ok', 'Reglas guardadas.');
    return c.redirect(`/admin/t/${tournament.id}/reglas`, 303);
  });

  return app;
}
