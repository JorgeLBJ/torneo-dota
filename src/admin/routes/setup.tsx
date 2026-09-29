import { Hono } from 'hono';
import { hashPassword } from '../../auth/password.js';
import { tokensMatch } from '../../auth/setup-token.js';
import { clientKey } from '../../security.js';
import type { AdminEnv, Deps } from '../context.js';
import { setFlash, takeFlash } from '../flash.js';
import { readBody, str } from '../form.js';
import { checkNewPassword, checkUsername } from '../validate.js';
import { SetupPage, TooManyAttemptsPage } from '../views/auth.js';
import { startSession } from './auth.js';

/** First-run setup: exists only while there is no admin (404 afterwards). */
export function setupRoutes(deps: Deps) {
  const app = new Hono<AdminEnv>();
  const { repo } = deps;
  const closed = () => repo.countAdmins() > 0;

  app.get('/setup', (c) => (closed() ? c.text('No encontrado.', 404) : c.html(<SetupPage flash={takeFlash(c)} />)));

  app.post('/setup', async (c) => {
    if (closed()) return c.text('No encontrado.', 404);
    const key = clientKey(c, deps.config.trustProxy);
    // Counted before anything else, like the login: guesses at the code are rate-limited too.
    if (!deps.limiter.consume(key)) return c.html(<TooManyAttemptsPage />, 429);

    const body = await readBody(c);
    const fail = (message: string) => {
      setFlash(c, 'error', message);
      return c.redirect('/admin/setup', 303);
    };
    if (!deps.config.setupToken || !tokensMatch(str(body, 'code'), deps.config.setupToken)) {
      return fail('Código de setup incorrecto.');
    }
    const username = checkUsername(str(body, 'username'));
    if (!username.ok) return fail(username.error);
    const password = typeof body.password === 'string' ? body.password : '';
    const checked = checkNewPassword(password);
    if (!checked.ok) return fail(checked.error);
    if (password !== (typeof body.confirm === 'string' ? body.confirm : '')) return fail('Las contraseñas no coinciden.');

    const admin = repo.createFirstAdmin(username.value, await hashPassword(password));
    // Lost a race with another setup that finished first: nothing was created, no session is given.
    if (!admin) return c.text('No encontrado.', 404);

    deps.limiter.reset(key);
    startSession(c, deps, admin.id);
    return c.redirect('/admin/torneos', 303);
  });

  return app;
}
