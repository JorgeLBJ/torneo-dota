import { Hono } from 'hono';
import { assignSemifinalTeams, clearPlayoffResult, phaseSlots, recordPlayoffResult, resetPlayoffs } from '../../services/playoffs.js';
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
    if (str(body, 'action') === 'reset' || raw.every((value) => value === '')) {
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

  app.post('/playoffs/:phase/:number', async (c) => {
    const tournament = c.get('tournament');
    const phase = c.req.param('phase');
    const number = Number(c.req.param('number'));
    const valid =
      (phase === 'semifinal' && (number === 1 || number === 2)) || (phase === 'final' && number === 1);
    if (!valid) return c.text('Partido de playoffs no encontrado.', 404);
    const kind = phase as 'semifinal' | 'final';
    const back = `/admin/t/${tournament.id}/playoffs`;
    const body = await readBody(c);

    if (str(body, 'action') === 'clear') {
      clearPlayoffResult(repo, tournament, kind, number);
      deps.events.tournamentChanged(tournament.id);
      setFlash(c, 'ok', 'Resultado borrado.');
      return c.redirect(back, 303);
    }

    const checked = recordPlayoffResult(repo, tournament, loadState(repo, tournament), kind, number, {
      winner: str(body, 'winner'),
      t1Kills: str(body, 't1_kills'),
      t1Deaths: str(body, 't1_deaths'),
      t2Kills: str(body, 't2_kills'),
      t2Deaths: str(body, 't2_deaths'),
    });
    if (!checked.ok) setFlash(c, 'error', checked.error);
    else {
      deps.events.tournamentChanged(tournament.id);
      setFlash(c, 'ok', 'Resultado guardado.');
    }
    return c.redirect(back, 303);
  });

  return app;
}
