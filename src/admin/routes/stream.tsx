import { Hono } from 'hono';
import { parseStream } from '../../domain/stream.js';
import type { AdminEnv, Deps } from '../context.js';
import { readBody, str } from '../form.js';
import { setFlash } from '../flash.js';

export function streamRoutes(deps: Deps) {
  const app = new Hono<AdminEnv>();

  app.post('/stream', async (c) => {
    const tournament = c.get('tournament');
    const back = `/admin/t/${tournament.id}/config`;
    const body = await readBody(c);

    if (str(body, 'action') === 'clear') {
      deps.repo.updateTournament(tournament.id, { streamUrl: null });
      deps.events.tournamentChanged(tournament.id);
      setFlash(c, 'ok', 'Transmisión quitada.');
      return c.redirect(back, 303);
    }

    const input = str(body, 'stream_url');
    const parsed = parseStream(input);
    if (!parsed.ok) {
      setFlash(c, 'error', parsed.error);
      return c.redirect(back, 303);
    }
    // The link is stored as typed (it is validated); the embed is always rebuilt from its parsed parts.
    deps.repo.updateTournament(tournament.id, { streamUrl: input });
    deps.events.tournamentChanged(tournament.id);
    setFlash(c, 'ok', `Transmisión guardada (${parsed.value.label}).`);
    return c.redirect(back, 303);
  });

  return app;
}
