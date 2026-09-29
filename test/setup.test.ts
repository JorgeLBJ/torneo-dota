import { afterEach, describe, expect, it } from 'vitest';
import { generateSetupToken, resolveSetupToken, tokensMatch } from '../src/auth/setup-token.js';
import { verifyPassword } from '../src/auth/password.js';
import { PASSWORD, flashText, makeApp, type TestApp } from './helpers/app.js';

const TOKEN = 'test-setup-code-123';
const apps: TestApp[] = [];
const fresh = async (config = {}) => {
  const app = await makeApp({ setupToken: TOKEN, ...config }, { withAdmin: false });
  apps.push(app);
  return app;
};
afterEach(() => {
  for (const app of apps.splice(0)) app.db.close();
});

const good = { username: 'Owner', password: 'a-good-password', confirm: 'a-good-password', code: TOKEN };

describe('setup token', () => {
  it('generates url-safe tokens with at least 128 bits, different every time', () => {
    const a = generateSetupToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(a, 'base64url').length).toBeGreaterThanOrEqual(16);
    expect(generateSetupToken()).not.toBe(a);
  });

  it('prefers ADMIN_SETUP_TOKEN and reports whether it was generated', () => {
    expect(resolveSetupToken('  my-own-code  ')).toEqual({ token: 'my-own-code', generated: false });
    for (const empty of [undefined, '', '   ']) expect(resolveSetupToken(empty).generated).toBe(true);
  });

  it('compares without caring about length or content leaks', () => {
    expect(tokensMatch('abc', 'abc')).toBe(true);
    for (const [a, b] of [['abc', 'abd'], ['abc', 'abcd'], ['', 'abc'], ['abc', '']] as const) expect(tokensMatch(a, b)).toBe(false);
  });
});

describe('gating', () => {
  it('sends every /admin page to /admin/setup while there is no admin', async () => {
    const t = await fresh();
    for (const path of ['/admin', '/admin/login', '/admin/torneos', '/admin/usuarios', '/admin/t/1/config', '/admin/cuenta']) {
      const res = await t.get(path);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/admin/setup');
    }
    const post = await t.post('/admin/login', { username: 'admin', password: 'x' });
    expect(post.headers.get('location')).toBe('/admin/setup');
  });

  it('shows the setup form in the login style', async () => {
    const t = await fresh();
    const res = await t.get('/admin/setup');
    expect(res.status).toBe(200);
    const html = await res.text();
    for (const text of ['Usuario', 'Contraseña', 'Confirmar contraseña', 'Código de setup']) expect(html).toContain(text);
    expect(html).toContain('action="/admin/setup"');
    expect(html).toContain('class="login"');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('does not exist once an admin does: 404 for GET and POST, login works as usual', async () => {
    const t = await makeApp({ setupToken: TOKEN });
    apps.push(t);
    expect((await t.get('/admin/setup')).status).toBe(404);
    expect((await t.post('/admin/setup', good)).status).toBe(404);
    expect(t.repo.countAdmins()).toBe(1);
    expect((await t.get('/admin/login')).status).toBe(200);
  });

  it('keeps the public site working while setup is pending', async () => {
    const t = await fresh();
    expect((await t.get('/')).status).toBe(200);
  });
});

describe('creating the first admin', () => {
  it('creates it, signs in and goes to the tournaments list', async () => {
    const t = await fresh();
    const res = await t.post('/admin/setup', good);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/torneos');
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('sid='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    const admin = t.repo.getAdminByUsername('owner')!;
    expect(admin).toBeDefined();
    expect(await verifyPassword('a-good-password', admin.passwordHash)).toBe(true);
    expect((await t.get('/admin/torneos', cookie.split(';')[0]!)).status).toBe(200);
    expect((await t.get('/admin/setup')).status).toBe(404);
  });

  it('rejects a wrong or missing code without creating anything', async () => {
    const t = await fresh();
    for (const code of ['', 'nope', `${TOKEN}x`, TOKEN.slice(1)]) {
      const res = await t.post('/admin/setup', { ...good, code });
      expect(await flashText(t, res, '')).toContain('Código de setup incorrecto');
    }
    expect(t.repo.countAdmins()).toBe(0);
  });

  it('validates username, password length and confirmation in Spanish', async () => {
    const t = await fresh();
    const cases: [Record<string, string>, string][] = [
      [{ username: 'a b' }, 'usuario'],
      [{ password: 'short', confirm: 'short' }, 'entre 8 y 200 caracteres'],
      [{ confirm: 'different-password' }, 'no coinciden'],
    ];
    for (const [override, message] of cases) {
      const res = await t.post('/admin/setup', { ...good, ...override });
      expect(await flashText(t, res, '')).toContain(message);
    }
    expect(t.repo.countAdmins()).toBe(0);
  });

  it('rate-limits attempts with the login limiter', async () => {
    const t = await fresh();
    for (let i = 0; i < 5; i++) await t.post('/admin/setup', { ...good, code: 'wrong' });
    const blocked = await t.post('/admin/setup', good);
    expect(blocked.status).toBe(429);
    expect(t.repo.countAdmins()).toBe(0);
  });

  it('needs a same-origin request', async () => {
    const t = await fresh();
    const res = await t.send('POST', '/admin/setup', { form: good, headers: { origin: 'http://evil.example' } });
    expect(res.status).toBe(403);
    expect(t.repo.countAdmins()).toBe(0);
  });

  it('is race-safe: two simultaneous setups produce exactly one admin', async () => {
    const t = await fresh();
    const [a, b] = await Promise.all([
      t.post('/admin/setup', { ...good, username: 'first' }),
      t.post('/admin/setup', { ...good, username: 'second' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([303, 404]);
    expect(t.repo.countAdmins()).toBe(1);
    // The loser got no session.
    const loser = a.status === 404 ? a : b;
    expect(loser.headers.getSetCookie().some((c) => c.startsWith('sid='))).toBe(false);
  });
});

describe('ADMIN_PASSWORD path', () => {
  it('is unchanged: makeApp creates "admin" from it and setup never opens', async () => {
    const t = await makeApp({ setupToken: TOKEN });
    apps.push(t);
    expect(t.repo.getAdminByUsername('admin')).toBeDefined();
    expect(await t.login('admin', PASSWORD)).toContain('sid=');
    expect((await t.get('/admin/setup')).status).toBe(404);
  });
});
