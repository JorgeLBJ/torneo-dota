import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, flashCookie, flashText, makeApp, type TestApp } from './helpers/app.js';

let t: TestApp;
beforeEach(async () => {
  t = await makeApp();
});
afterEach(() => t.db.close());

describe('login', () => {
  it('serves the login page in Spanish', async () => {
    const res = await t.get('/admin/login');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Contraseña');
    expect(html).toContain('Entrar');
    expect(html).not.toContain('MOCKUP');
  });

  it('redirects unauthenticated admin pages to the login', async () => {
    for (const path of ['/admin', '/admin/torneos', '/admin/usuarios']) {
      const res = await t.get(path);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/admin/login');
    }
  });

  it('sets an HttpOnly SameSite=Lax 7-day cookie on success', async () => {
    const res = await t.post('/admin/login', { username: 'admin', password: PASSWORD });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin');
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('sid='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Max-Age=604800/);
    expect(cookie).not.toMatch(/Secure/i);
  });

  it('marks the cookie Secure when configured', async () => {
    const secure = await makeApp({ secureCookies: true });
    const res = await secure.post('/admin/login', { username: 'admin', password: PASSWORD });
    expect(res.headers.getSetCookie().find((c) => c.startsWith('sid='))).toMatch(/Secure/);
    secure.db.close();
  });

  it('rejects wrong credentials with a Spanish error and no session cookie', async () => {
    const res = await t.post('/admin/login', { username: 'admin', password: 'nope' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/login');
    expect(res.headers.getSetCookie().some((c) => c.startsWith('sid='))).toBe(false);
    const page = await t.get('/admin/login', flashCookie(res));
    expect(await page.text()).toContain('Usuario o contraseña incorrectos');
  });

  it('rejects unknown users the same way', async () => {
    const res = await t.post('/admin/login', { username: 'ghost', password: 'whatever' });
    expect(res.headers.getSetCookie().some((c) => c.startsWith('sid='))).toBe(false);
  });

  it('rate-limits after 5 failures', async () => {
    for (let i = 0; i < 5; i++) await t.post('/admin/login', { username: 'admin', password: 'bad' });
    const res = await t.post('/admin/login', { username: 'admin', password: PASSWORD });
    expect(res.status).toBe(429);
    expect(await res.text()).toContain('Demasiados intentos');
  });

  it('lets an authenticated admin in and out', async () => {
    const cookie = await t.login();
    expect((await t.get('/admin', cookie)).headers.get('location')).toBe('/admin/torneos');
    const tournament = t.repo.createTournament({ name: 'Cup', slug: 'cup' });
    t.repo.setActiveTournament(tournament.id);
    expect((await t.get('/admin', cookie)).headers.get('location')).toBe(`/admin/t/${tournament.id}/resultados`);
    expect((await t.get('/admin/torneos', cookie)).status).toBe(200);
    const out = await t.post('/admin/logout', {}, cookie);
    expect(out.status).toBe(303);
    expect((await t.get('/admin/torneos', cookie)).status).toBe(303);
  });

  it('ignores an expired session', async () => {
    const cookie = await t.login();
    t.db.exec("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'");
    expect((await t.get('/admin/torneos', cookie)).status).toBe(303);
  });
});

describe('same-origin protection', () => {
  const form = { username: 'admin', password: PASSWORD };

  it('rejects POSTs without Origin or Referer', async () => {
    const res = await t.send('POST', '/admin/login', { form, headers: { origin: '' } });
    expect(res.status).toBe(403);
  });

  it('rejects a foreign Origin and a foreign Referer', async () => {
    const foreign = await t.send('POST', '/admin/login', { form, headers: { origin: 'https://evil.example' } });
    expect(foreign.status).toBe(403);
    const referer = await t.send('POST', '/admin/login', {
      form,
      headers: { origin: '', referer: 'https://evil.example/x' },
    });
    expect(referer.status).toBe(403);
  });

  it('accepts a same-origin Referer when Origin is absent', async () => {
    const res = await t.send('POST', '/admin/login', {
      form,
      headers: { origin: '', referer: 'http://localhost/admin/login' },
    });
    expect(res.status).toBe(303);
  });

  it('blocks logout from another origin', async () => {
    const cookie = await t.login();
    const res = await t.send('POST', '/admin/logout', { cookie, headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect((await t.get('/admin/torneos', cookie)).status).toBe(200);
  });
});

describe('users screen', () => {
  it('lists admins and adds a new one who can log in', async () => {
    const cookie = await t.login();
    const page = await (await t.get('/admin/usuarios', cookie)).text();
    expect(page).toContain('Usuarios');
    expect(page).toContain('admin');
    const add = await t.post('/admin/usuarios', { username: 'Second', password: 'another-pass-1' }, cookie);
    expect(add.status).toBe(303);
    expect(t.repo.getAdminByUsername('second')).toBeDefined();
    expect(await t.login('second', 'another-pass-1')).toContain('sid=');
  });

  it('validates username and password on creation', async () => {
    const cookie = await t.login();
    const cases: [Record<string, string>, string][] = [
      [{ username: 'a', password: 'long-enough-1' }, 'usuario'],
      [{ username: 'bad name!', password: 'long-enough-1' }, 'usuario'],
      [{ username: 'valid', password: 'short' }, 'contraseña'],
      [{ username: 'admin', password: 'long-enough-1' }, 'Ya existe'],
    ];
    for (const [form, message] of cases) {
      const res = await t.post('/admin/usuarios', form, cookie);
      expect(res.status).toBe(303);
      expect(await flashText(t, res, cookie)).toContain(message);
    }
    expect(t.repo.countAdmins()).toBe(1);
  });

  it('cannot delete yourself or the last admin, but can delete another admin', async () => {
    const cookie = await t.login();
    const me = t.repo.getAdminByUsername('admin')!;
    const self = await t.post(`/admin/usuarios/${me.id}/eliminar`, {}, cookie);
    expect(await flashText(t, self, cookie)).toContain('No puedes eliminar tu propio usuario');
    expect(t.repo.countAdmins()).toBe(1);
    await t.post('/admin/usuarios', { username: 'other', password: 'another-pass-1' }, cookie);
    const other = t.repo.getAdminByUsername('other')!;
    await t.post(`/admin/usuarios/${other.id}/eliminar`, {}, cookie);
    expect(t.repo.countAdmins()).toBe(1);
  });

  it('never deletes the last admin', async () => {
    const cookie = await t.login();
    await t.post('/admin/usuarios', { username: 'other', password: 'another-pass-1' }, cookie);
    const otherCookie = await t.login('other', 'another-pass-1');
    const me = t.repo.getAdminByUsername('admin')!;
    const other = t.repo.getAdminByUsername('other')!;
    await t.post(`/admin/usuarios/${me.id}/eliminar`, {}, otherCookie);
    expect(t.repo.countAdmins()).toBe(1);
    const res = await t.post(`/admin/usuarios/${other.id}/eliminar`, {}, otherCookie);
    expect(await flashText(t, res, otherCookie)).toContain('No puedes eliminar tu propio usuario');
    expect(t.repo.countAdmins()).toBe(1);
  });
});

describe('login rate-limit key', () => {
  const attempt = (app: TestApp, forwardedFor?: string) =>
    app.send('POST', '/admin/login', {
      form: { username: 'admin', password: 'bad' },
      headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
    });

  it('ignores X-Forwarded-For unless the proxy is trusted', async () => {
    for (let i = 0; i < 5; i++) await attempt(t, `10.0.0.${i}, 9.9.9.9`);
    expect((await attempt(t, '10.0.0.99, 8.8.8.8')).status).toBe(429);
  });

  it('keys on the right-most (proxy-appended) hop when TRUST_PROXY is on', async () => {
    const proxied = await makeApp({ trustProxy: true });
    // Rotating the client-controlled left-most entries must not evade the limit.
    for (let i = 0; i < 5; i++) await attempt(proxied, `10.0.0.${i}, 9.9.9.9`);
    expect((await attempt(proxied, '10.0.0.99, 9.9.9.9')).status).toBe(429);
    // A different real client (different proxy-appended hop) is unaffected.
    expect((await attempt(proxied, '10.0.0.1, 7.7.7.7')).status).not.toBe(429);
    proxied.db.close();
  });
});

describe('request body cap', () => {
  it('answers 413 in Spanish when the body exceeds the cap', async () => {
    const res = await t.app.request('/admin/login', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/x-www-form-urlencoded' },
      body: `username=admin&password=${'x'.repeat(70 * 1024)}`,
    });
    expect(res.status).toBe(413);
    expect(await res.text()).toContain('demasiado grande');
  });

  it('accepts ordinary forms', async () => {
    const res = await t.post('/admin/login', { username: 'admin', password: 'bad' });
    expect(res.status).toBe(303);
  });
});
