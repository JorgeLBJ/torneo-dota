import { Hono } from 'hono';
import { generateObserverToken } from '../../auth/observer-token.js';
import { GSI_CFG_FILENAME, buildGsiCfg } from '../../gsi/cfg.js';
import { buildInstallerBat, installerFilename } from '../../gsi/installer.js';
import { publicOrigin } from '../../security.js';
import type { AdminEnv, Deps } from '../context.js';
import { readBody, str } from '../form.js';
import { setFlash } from '../flash.js';
import { ObserverRevealStore } from '../observer-reveals.js';
import { adminTimeZone, renderPage } from '../render.js';
import { ObserversView, type CreatedObserver } from '../views/observers.js';

export const MAX_OBSERVER_NAME = 60;

export function observerRoutes(deps: Deps) {
  const app = new Hono<AdminEnv>();
  const { repo } = deps;

  // One-time reveal (post/redirect/get): the POST creates the observer and parks the plaintext token in this
  // process's memory (see ObserverRevealStore: <= 10 minutes, only for the creating admin, never in the DB, a
  // cookie, a flash, the URL or a log), then redirects to a GET that renders it. A refresh therefore re-shows the
  // panel instead of re-submitting the form and creating a duplicate. The .cfg and the .bat installer downloads are
  // client-side Blobs built from the text on the page. A server restart loses the reveal by design.
  const reveals = new ObserverRevealStore(deps.now);

  app.get('/observadores', (c) => {
    const revealId = c.req.query('revelar');
    let created: CreatedObserver | undefined;
    let notice: string | undefined;
    if (revealId !== undefined) {
      const found = reveals.get(revealId, c.get('admin').id);
      if (found) {
        const cfg = buildGsiCfg(publicOrigin(c, deps.config), found.token);
        created = { name: found.name, token: found.token, cfg, filename: GSI_CFG_FILENAME, installer: buildInstallerBat(cfg), installerFilename: installerFilename(found.name) };
        c.header('Cache-Control', 'no-store');
      } else {
        notice = 'Ese token ya no se puede mostrar. Si se perdió, revócalo y crea otro.';
      }
    }
    return renderPage(
      c,
      deps,
      { title: 'Observadores', active: 'observadores' },
      <ObserversView observers={repo.listObserverTokens()} captureCounts={repo.countGsiCapturesByObserver()} created={created} notice={notice} timeZone={adminTimeZone(deps)} />,
    );
  });

  app.post('/observadores', async (c) => {
    const name = str(await readBody(c), 'name');
    if (!name || name.length > MAX_OBSERVER_NAME) {
      setFlash(c, 'error', `Escribe un nombre para el observador (máximo ${MAX_OBSERVER_NAME} caracteres).`);
      return c.redirect('/admin/observadores', 303);
    }
    const { token, hash, prefix } = generateObserverToken();
    const observer = repo.createObserverToken(name, hash, prefix);
    const revealId = reveals.put(c.get('admin').id, observer.id, name, token);
    return c.redirect(`/admin/observadores?revelar=${revealId}`, 303);
  });

  app.post('/observadores/:id/revocar', (c) => {
    const id = Number(c.req.param('id'));
    const target = Number.isInteger(id) ? repo.getObserverToken(id) : undefined;
    if (!target) {
      setFlash(c, 'error', 'El observador no existe.');
    } else {
      repo.revokeObserverToken(target.id);
      reveals.dropObserver(target.id);
      setFlash(c, 'ok', `Token de «${target.name}» revocado.`);
    }
    return c.redirect('/admin/observadores', 303);
  });

  return app;
}
