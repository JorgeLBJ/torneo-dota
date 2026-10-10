import { Hono } from 'hono';
import { generateObserverToken } from '../../auth/observer-token.js';
import { GSI_CFG_FILENAME, buildGsiCfg } from '../../gsi/cfg.js';
import { publicOrigin } from '../../security.js';
import type { AdminEnv, Deps } from '../context.js';
import { readBody, str } from '../form.js';
import { setFlash } from '../flash.js';
import { renderPage } from '../render.js';
import { ObserversView } from '../views/observers.js';

export const MAX_OBSERVER_NAME = 60;

export function observerRoutes(deps: Deps) {
  const app = new Hono<AdminEnv>();
  const { repo } = deps;

  app.get('/observadores', (c) =>
    renderPage(c, deps, { title: 'Observadores', active: 'observadores' }, <ObserversView observers={repo.listObserverTokens()} captureCounts={repo.countGsiCapturesByObserver()} />),
  );

  app.post('/observadores', async (c) => {
    const name = str(await readBody(c), 'name');
    if (!name || name.length > MAX_OBSERVER_NAME) {
      setFlash(c, 'error', `Escribe un nombre para el observador (máximo ${MAX_OBSERVER_NAME} caracteres).`);
      return c.redirect('/admin/observadores', 303);
    }
    const { token, hash, prefix } = generateObserverToken();
    repo.createObserverToken(name, hash, prefix);
    // One-time reveal: the plaintext token exists only in this response. It is rendered straight from the POST
    // (no redirect, no flash cookie, no session or DB copy) and the .cfg download is a client-side Blob built from
    // the text on the page, so nothing on the server can serve it again. Leaving the page loses it by design.
    const cfg = buildGsiCfg(publicOrigin(c, deps.config), token);
    c.header('Cache-Control', 'no-store');
    return renderPage(
      c,
      deps,
      { title: 'Observadores', active: 'observadores' },
      <ObserversView observers={repo.listObserverTokens()} captureCounts={repo.countGsiCapturesByObserver()} created={{ name, token, cfg, filename: GSI_CFG_FILENAME }} />,
    );
  });

  app.post('/observadores/:id/revocar', (c) => {
    const id = Number(c.req.param('id'));
    const target = Number.isInteger(id) ? repo.getObserverToken(id) : undefined;
    if (!target) {
      setFlash(c, 'error', 'El observador no existe.');
    } else {
      repo.revokeObserverToken(target.id);
      setFlash(c, 'ok', `Token de «${target.name}» revocado.`);
    }
    return c.redirect('/admin/observadores', 303);
  });

  return app;
}
