import type { Context } from 'hono';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createSession, destroySession, resolveSession, SESSION_TTL_MS } from '../../auth/session.js';
import { hashPassword, verifyPassword } from '../../auth/password.js';
import { clientKey } from '../../security.js';
import type { AdminEnv, Deps } from '../context.js';
import { readBody, str } from '../form.js';
import { setFlash, takeFlash } from '../flash.js';
import { LoginPage, TooManyAttemptsPage } from '../views/auth.js';

export const SESSION_COOKIE = 'sid';

// Verified against when the username is unknown, so both failure paths cost the same.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword('not-a-real-password'));

/** Signs the admin in: creates a session and sets its cookie. */
export function startSession(c: Context, deps: Deps, adminId: number): void {
  const token = createSession(deps.repo, adminId, deps.now());
  setCookie(c, SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: deps.config.secureCookies,
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function loginRoutes(deps: Deps) {
  const app = new Hono<AdminEnv>();

  app.get('/login', (c) => c.html(<LoginPage flash={takeFlash(c)} />));

  app.post('/login', async (c) => {
    const key = clientKey(c, deps.config.trustProxy);
    // Counted up front (before the slow hash check) so parallel guesses cannot all slip past the limit.
    if (!deps.limiter.consume(key)) return c.html(<TooManyAttemptsPage />, 429);

    const body = await readBody(c);
    const username = str(body, 'username').toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const admin = deps.repo.getAdminByUsername(username);
    const valid = await verifyPassword(password, admin?.passwordHash ?? (await getDummyHash()));
    if (!admin || !valid) {
      setFlash(c, 'error', 'Usuario o contraseña incorrectos.');
      return c.redirect('/admin/login', 303);
    }

    deps.limiter.reset(key);
    startSession(c, deps, admin.id);
    return c.redirect('/admin', 303);
  });

  return app;
}

/** Middleware: requires a valid session cookie, otherwise redirects to the login. */
export function requireAdmin(deps: Deps) {
  return createMiddleware<AdminEnv>(async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const admin = token ? resolveSession(deps.repo, token, deps.now()) : undefined;
    if (!admin) return c.redirect('/admin/login', 303);
    c.set('admin', admin);
    return next();
  });
}

export function logoutRoutes(deps: Deps) {
  const app = new Hono<AdminEnv>();
  app.post('/logout', (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) destroySession(deps.repo, token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.redirect('/admin/login', 303);
  });
  return app;
}
