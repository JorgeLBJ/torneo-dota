import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { hashPassword, verifyPassword } from '../../auth/password.js';
import { destroyOtherSessions } from '../../auth/session.js';
import { clientKey } from '../../security.js';
import type { AdminEnv, Deps } from '../context.js';
import { setFlash } from '../flash.js';
import { readBody } from '../form.js';
import { renderPage } from '../render.js';
import { checkNewPassword } from '../validate.js';
import { AccountView, TooManyAttemptsPage } from '../views/auth.js';
import { SESSION_COOKIE } from './auth.js';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The signed-in admin changes their own password. */
export function accountRoutes(deps: Deps) {
  const app = new Hono<AdminEnv>();
  const { repo } = deps;

  app.get('/cuenta', (c) =>
    renderPage(c, deps, { title: 'Cambiar contraseña', active: 'cuenta', tournament: repo.getActiveTournament() }, <AccountView />),
  );

  app.post('/cuenta', async (c) => {
    const admin = c.get('admin');
    const key = clientKey(c, deps.config.trustProxy);
    // Every attempt is counted up front; only a success gives the budget back.
    if (!deps.limiter.consume(key)) return c.html(<TooManyAttemptsPage />, 429);

    const body = await readBody(c);
    const fail = (message: string) => {
      setFlash(c, 'error', message);
      return c.redirect('/admin/cuenta', 303);
    };
    const current = text(body.current);
    if (!(await verifyPassword(current, admin.passwordHash))) return fail('La contraseña actual no es correcta.');
    const next = text(body.next);
    const checked = checkNewPassword(next);
    if (!checked.ok) return fail(checked.error);
    if (next !== text(body.confirm)) return fail('Las contraseñas nuevas no coinciden.');
    if (next === current) return fail('La nueva contraseña debe ser distinta de la actual.');

    repo.setAdminPassword(admin.id, await hashPassword(next));
    destroyOtherSessions(repo, admin.id, getCookie(c, SESSION_COOKIE) ?? '');
    deps.limiter.reset(key);
    setFlash(c, 'ok', 'Contraseña actualizada. Se cerraron tus otras sesiones.');
    return c.redirect('/admin/cuenta', 303);
  });

  return app;
}
