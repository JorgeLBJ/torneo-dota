import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyPassword } from '../src/auth/password.js';
import { PASSWORD, flashText, makeApp, type TestApp } from './helpers/app.js';

let t: TestApp;
let cookie: string;
beforeEach(async () => {
  t = await makeApp();
  cookie = await t.login();
});
afterEach(() => t.db.close());

const NEW = 'a-brand-new-password';
const form = (over: Record<string, string> = {}) => ({ current: PASSWORD, next: NEW, confirm: NEW, ...over });
const change = (over: Record<string, string> = {}, c = cookie) => t.post('/admin/cuenta', form(over), c);
const hashOf = () => t.repo.getAdminByUsername('admin')!.passwordHash;

describe('the account page', () => {
  it('requires a login', async () => {
    expect((await t.get('/admin/cuenta')).headers.get('location')).toBe('/admin/login');
    expect((await t.post('/admin/cuenta', form())).headers.get('location')).toBe('/admin/login');
  });

  it('shows the three password fields', async () => {
    const html = await (await t.get('/admin/cuenta', cookie)).text();
    for (const text of ['Contraseña actual', 'Nueva contraseña', 'Confirmar contraseña']) expect(html).toContain(text);
    expect(html).toContain('action="/admin/cuenta"');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).toContain('autocomplete="new-password"');
  });

  it('is reachable from the sidebar footer, above "Cerrar sesión"', async () => {
    const html = await (await t.get('/admin/torneos', cookie)).text();
    const foot = html.slice(html.indexOf('<div class="side-foot">'));
    expect(foot).toContain('href="/admin/cuenta"');
    expect(foot).toContain('Cambiar contraseña');
    expect(foot.indexOf('Cambiar contraseña')).toBeLessThan(foot.indexOf('Cerrar sesión'));
    expect(foot).toContain('aria-label="Cambiar contraseña"');
  });

  it('needs a same-origin request', async () => {
    const res = await t.send('POST', '/admin/cuenta', { form: form(), cookie, headers: { origin: 'http://evil.example' } });
    expect(res.status).toBe(403);
  });
});

describe('changing the password', () => {
  it('rehashes, keeps this session and closes the admin\'s other sessions', async () => {
    const other = await t.login();
    const before = hashOf();
    const res = await change();
    expect(res.status).toBe(303);
    expect(await flashText(t, res, cookie)).toContain('Contraseña actualizada. Se cerraron tus otras sesiones.');
    expect(hashOf()).not.toBe(before);
    expect(await verifyPassword(NEW, hashOf())).toBe(true);
    // This session survives; the other one is gone.
    expect((await t.get('/admin/torneos', cookie)).status).toBe(200);
    const stale = await t.get('/admin/torneos', other);
    expect(stale.status).toBe(303);
    expect(stale.headers.get('location')).toBe('/admin/login');
  });

  it('accepts only the new password afterwards', async () => {
    await change();
    await expect(t.login('admin', PASSWORD)).rejects.toThrow();
    expect(await t.login('admin', NEW)).toContain('sid=');
  });

  it('leaves other admins and their sessions alone', async () => {
    t.repo.createAdmin('second', 'x');
    const { hashPassword } = await import('../src/auth/password.js');
    t.db.prepare('UPDATE admins SET password_hash = ? WHERE username = ?').run(await hashPassword('second-password'), 'second');
    const secondCookie = await t.login('second', 'second-password');
    await change();
    expect((await t.get('/admin/torneos', secondCookie)).status).toBe(200);
    expect(await verifyPassword('second-password', t.repo.getAdminByUsername('second')!.passwordHash)).toBe(true);
  });

  it('rejects a wrong current password and changes nothing', async () => {
    const before = hashOf();
    const other = await t.login();
    const res = await change({ current: 'not-my-password' });
    expect(await flashText(t, res, cookie)).toContain('La contraseña actual no es correcta');
    expect(hashOf()).toBe(before);
    expect((await t.get('/admin/torneos', other)).status).toBe(200);
  });

  it('validates the new password in Spanish', async () => {
    const before = hashOf();
    const cases: [Record<string, string>, string][] = [
      [{ next: 'short', confirm: 'short' }, 'entre 8 y 200 caracteres'],
      [{ next: 'x'.repeat(201), confirm: 'x'.repeat(201) }, 'entre 8 y 200 caracteres'],
      [{ confirm: 'something-else-entirely' }, 'no coinciden'],
      [{ next: PASSWORD, confirm: PASSWORD }, 'distinta'],
    ];
    for (const [override, message] of cases) {
      expect(await flashText(t, await change(override), cookie)).toContain(message);
    }
    expect(hashOf()).toBe(before);
  });

  it('counts wrong current passwords against the rate limiter, then blocks even the right one', async () => {
    for (let i = 0; i < 5; i++) await change({ current: 'wrong-password' });
    const blocked = await change();
    expect(blocked.status).toBe(429);
    expect(await verifyPassword(PASSWORD, hashOf())).toBe(true);
  });

  it('uses its own bucket per admin: wrong attempts here never lock the login', async () => {
    for (let i = 0; i < 6; i++) await change({ current: 'wrong-password' });
    expect((await change({ current: 'wrong-password' })).status).toBe(429);
    // Same client address, but the login limiter is untouched.
    const res = await t.post('/admin/login', { username: 'admin', password: PASSWORD });
    expect(res.status).toBe(303);
    expect(res.headers.getSetCookie().some((c) => c.startsWith('sid='))).toBe(true);
  });

  it('and failed logins do not use up the change-password budget', async () => {
    for (let i = 0; i < 4; i++) await t.post('/admin/login', { username: 'admin', password: 'bad' });
    expect((await change()).status).toBe(303);
  });

  it('keeps the buckets of different admins apart', async () => {
    const { hashPassword } = await import('../src/auth/password.js');
    t.repo.createAdmin('second', await hashPassword('second-password'));
    const secondCookie = await t.login('second', 'second-password');
    for (let i = 0; i < 6; i++) await change({ current: 'wrong-password' });
    const res = await t.post('/admin/cuenta', { current: 'second-password', next: 'second-new-password', confirm: 'second-new-password' }, secondCookie);
    expect(res.status).toBe(303);
  });

  it('a success gives the limiter a fresh budget', async () => {
    for (let i = 0; i < 3; i++) await change({ current: 'wrong-password' });
    expect((await change()).status).toBe(303);
    for (let i = 0; i < 4; i++) expect((await change({ current: 'wrong-password', next: 'another-new-pass', confirm: 'another-new-pass' })).status).toBe(303);
  });
});

describe('what stays out of scope', () => {
  it('cannot delete yourself and has no reset for other admins', async () => {
    const me = t.repo.getAdminByUsername('admin')!;
    const res = await t.post(`/admin/usuarios/${me.id}/eliminar`, {}, cookie);
    expect(await flashText(t, res, cookie)).toContain('No puedes eliminar tu propio usuario');
    expect(t.repo.countAdmins()).toBe(1);
    const html = await (await t.get('/admin/usuarios', cookie)).text();
    expect(html).not.toMatch(/Restablecer|reset/i);
    t.repo.createAdmin('second', 'x');
    const second = t.repo.getAdminByUsername('second')!;
    expect((await t.post(`/admin/usuarios/${second.id}/password`, { next: NEW, confirm: NEW }, cookie)).status).toBe(404);
  });
});
