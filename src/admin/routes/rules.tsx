import { Hono } from 'hono';
import type { TiebreakerKey } from '../../db/repository.js';
import type { AdminEnv, Deps } from '../context.js';
import { intOrNull, rawStr, readBody, str } from '../form.js';
import { setFlash } from '../flash.js';
import { renderPage } from '../render.js';
import { RulesView } from '../views/rules.js';

const KNOWN: TiebreakerKey[] = ['kd', 'kills'];
const MAX_RULES_LENGTH = 20000;

/** The submitted order must be a permutation of the known criteria. */
function parseOrder(csv: string): TiebreakerKey[] | null {
  const keys = csv.split(',').map((k) => k.trim());
  const valid = keys.length === KNOWN.length && KNOWN.every((k) => keys.includes(k as TiebreakerKey));
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
    const moveMatch = /^(up|down):(\w+)$/.exec(action);
    if (moveMatch && KNOWN.includes(moveMatch[2] as TiebreakerKey)) {
      tiebreakers = move(tiebreakers, moveMatch[2] as TiebreakerKey, moveMatch[1] === 'up' ? -1 : 1);
    }

    const rulesText = rawStr(body, 'rules_text');
    if (rulesText.length > MAX_RULES_LENGTH) return error('El reglamento es demasiado largo (máximo 20 000 caracteres).');

    const groupLegs = Number(legs) as 1 | 2;
    const formatChanged = groupLegs !== tournament.groupLegs && repo.listMatches(tournament.id, 'group').length > 0;
    repo.updateTournament(tournament.id, { pointsWin, pointsLoss, tiebreakers, groupLegs, rulesText });
    deps.events.tournamentChanged(tournament.id);
    if (formatChanged) setFlash(c, 'warn', 'Reglas guardadas. Regenera el fixture para aplicar el nuevo formato.');
    else setFlash(c, 'ok', 'Reglas guardadas.');
    return c.redirect(`/admin/t/${tournament.id}/reglas`, 303);
  });

  return app;
}
