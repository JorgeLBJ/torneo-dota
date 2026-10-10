import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashObserverToken } from '../src/auth/observer-token.js';
import { flashText, makeApp, type TestApp } from './helpers/app.js';

let t: TestApp;
let cookie: string;
beforeEach(async () => {
  t = await makeApp({ publicBaseUrl: 'https://torneo.example.com' });
  cookie = await t.login();
});
afterEach(() => t.db.close());

describe('Observadores screen', () => {
  it('requires a login', async () => {
    const res = await t.get('/admin/observadores');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/login');
  });

  it('is linked from the navigation and starts empty', async () => {
    const html = await (await t.get('/admin/observadores', cookie)).text();
    expect(html).toContain('href="/admin/observadores"');
    expect(html).toContain('Observadores');
    expect(html).toContain('Nombre del observador');
  });

  it('creates a token and shows the plaintext once, with the cfg', async () => {
    const res = await t.post('/admin/observadores', { name: ' Juan ' }, cookie);
    expect(res.status).toBe(200);
    const html = await res.text();
    const token = /data-token="([0-9a-f]{64})"/.exec(html)?.[1];
    expect(token).toBeTruthy();
    expect(html).toContain('&quot;uri&quot;       &quot;https://torneo.example.com/gsi&quot;');
    expect(html).toContain(token!);
    expect(html).toContain('gamestate_integration_torneo.cfg');
    expect(html).toContain('-gamestateintegration');
    expect(html).toContain('Descargar .cfg');
    expect(res.headers.get('cache-control')).toBe('no-store');

    // Stored hashed, never in plaintext.
    const stored = t.repo.listObserverTokens();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.name).toBe('Juan');
    expect(t.repo.findActiveObserverByHash(hashObserverToken(token!))?.id).toBe(stored[0]!.id);
    const dump = JSON.stringify(t.db.prepare('SELECT * FROM observer_tokens').all());
    expect(dump).not.toContain(token!);

    // Gone after leaving the page.
    const later = await (await t.get('/admin/observadores', cookie)).text();
    expect(later).not.toContain(token!);
    expect(later).toContain('Juan');
    expect(later).toContain(stored[0]!.tokenPrefix);
    expect(later).toContain('Activo');
  });

  it('rejects an empty name', async () => {
    const res = await t.post('/admin/observadores', { name: '   ' }, cookie);
    expect(res.status).toBe(303);
    expect(await flashText(t, res, cookie)).toContain('nombre');
    expect(t.repo.listObserverTokens()).toHaveLength(0);
  });

  it('rejects a name that is too long', async () => {
    const res = await t.post('/admin/observadores', { name: 'x'.repeat(61) }, cookie);
    expect(res.status).toBe(303);
    expect(t.repo.listObserverTokens()).toHaveLength(0);
  });

  it('revokes a token', async () => {
    await t.post('/admin/observadores', { name: 'Juan' }, cookie);
    const id = t.repo.listObserverTokens()[0]!.id;
    const res = await t.post(`/admin/observadores/${id}/revocar`, {}, cookie);
    expect(res.status).toBe(303);
    expect(await flashText(t, res, cookie)).toContain('Juan');
    expect(t.repo.listObserverTokens()[0]!.revokedAt).toBeTruthy();
    const html = await (await t.get('/admin/observadores', cookie)).text();
    expect(html).toContain('Revocado');
  });

  it('answers an unknown id with an error flash', async () => {
    const res = await t.post('/admin/observadores/999/revocar', {}, cookie);
    expect(res.status).toBe(303);
    expect(await flashText(t, res, cookie)).toContain('no existe');
  });
});
