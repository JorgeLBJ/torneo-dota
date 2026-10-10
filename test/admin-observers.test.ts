import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateObserverToken, hashObserverToken } from '../src/auth/observer-token.js';
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
    const created = await t.post('/admin/observadores', { name: ' Juan ' }, cookie);
    expect(created.status).toBe(303);
    expect(created.headers.get('location')).toMatch(/^\/admin\/observadores\?revelar=[A-Za-z0-9_-]{20,}$/);
    const res = await t.get(created.headers.get('location')!, cookie);
    expect(res.status).toBe(200);
    const html = await res.text();
    const token = /data-token="([0-9a-f]{64})"/.exec(html)?.[1];
    expect(token).toBeTruthy();
    expect(html).toContain('&quot;uri&quot;       &quot;https://torneo.example.com/gsi&quot;');
    expect(html).toContain(token!);
    expect(html).toContain('gamestate_integration_torneo.cfg');
    expect(html).toContain('…\\steamapps\\common\\dota 2 beta\\game\\dota\\cfg\\gamestate_integration\\');
    expect(html).toContain('-gamestateintegration');
    expect(html).toContain('Descargar .cfg');
    expect(html).toContain('Descargar instalador (.bat)');
    expect(html).toMatch(/data-installer-download="instalar-observador-torneo-juan\.bat"/);
    expect(html).toContain('id="installerText"');
    expect(html).toContain('-applaunch 570 -gamestateintegration');
    expect(html).toContain('Instalación manual');
    expect(html).toContain('Ejecutar de todas formas');
    expect(html).toContain('Dota 2 (Torneo)');
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

describe('one-time reveal (post/redirect/get)', () => {
  let clock: Date;
  let r: TestApp;
  let rcookie: string;
  beforeEach(async () => {
    clock = new Date('2026-10-09T22:00:00Z');
    r = await makeApp({ now: () => clock });
    rcookie = await r.login();
  });
  afterEach(() => r.db.close());

  const create = async (name = 'Juan') => {
    const res = await r.post('/admin/observadores', { name }, rcookie);
    return res.headers.get('location')!;
  };
  const tokenOf = (html: string) => /data-token="([0-9a-f]{64})"/.exec(html)?.[1];

  it('redirects and keeps the plaintext out of the URL', async () => {
    const location = await create();
    const token = tokenOf(await (await r.get(location, rcookie)).text())!;
    expect(token).toBeTruthy();
    expect(location).not.toContain(token);
  });

  it('shows the token again on a refresh within the TTL, never creating a second observer', async () => {
    const location = await create();
    const first = await r.get(location, rcookie);
    expect(first.headers.get('cache-control')).toBe('no-store');
    const token = tokenOf(await first.text())!;
    clock = new Date(clock.getTime() + 9 * 60_000);
    const again = await r.get(location, rcookie);
    expect(tokenOf(await again.text())).toBe(token);
    expect(again.headers.get('cache-control')).toBe('no-store');
    expect(r.repo.listObserverTokens()).toHaveLength(1);
  });

  it('stops showing the token after the TTL and says so', async () => {
    const location = await create();
    const token = tokenOf(await (await r.get(location, rcookie)).text())!;
    clock = new Date(clock.getTime() + 10 * 60_000 + 1);
    const html = await (await r.get(location, rcookie)).text();
    expect(html).not.toContain(token);
    expect(html).toContain('Ese token ya no se puede mostrar');
  });

  it('answers an unknown id with the notice', async () => {
    const html = await (await r.get('/admin/observadores?revelar=nope', rcookie)).text();
    expect(html).toContain('Ese token ya no se puede mostrar');
    expect(html).not.toContain('id="cfgText"');
  });

  it('does not reveal the token to another admin', async () => {
    await r.post('/admin/usuarios', { username: 'otro', password: 'otra-clave-123', confirm: 'otra-clave-123' }, rcookie);
    const other = await r.login('otro', 'otra-clave-123');
    const location = await create();
    const mine = tokenOf(await (await r.get(location, rcookie)).text())!;
    const html = await (await r.get(location, other)).text();
    expect(html).not.toContain(mine);
    expect(html).toContain('Ese token ya no se puede mostrar');
    // The creator still can.
    expect(tokenOf(await (await r.get(location, rcookie)).text())).toBe(mine);
  });

  it('drops the reveal when the observer is revoked', async () => {
    const location = await create();
    const token = tokenOf(await (await r.get(location, rcookie)).text())!;
    await r.post(`/admin/observadores/${r.repo.listObserverTokens()[0]!.id}/revocar`, {}, rcookie);
    const html = await (await r.get(location, rcookie)).text();
    expect(html).not.toContain(token);
    expect(html).toContain('Ese token ya no se puede mostrar');
  });
});

describe('admin time zone on global screens', () => {
  const pin = (observerId: number) =>
    t.db.prepare("UPDATE observer_tokens SET created_at = '2026-10-10 03:01:34' WHERE id = ?").run(observerId);

  it('falls back to America/Lima with no tournaments', async () => {
    await t.post('/admin/observadores', { name: 'Juan' }, cookie);
    pin(t.repo.listObserverTokens()[0]!.id);
    expect(await (await t.get('/admin/observadores', cookie)).text()).toContain('09/10/2026 22:01:34');
  });

  it('uses the active tournament time zone', async () => {
    const tour = t.repo.createTournament({ name: 'Copa', slug: 'copa' });
    t.repo.updateTournament(tour.id, { timezone: 'Asia/Tokyo' });
    t.repo.setActiveTournament(tour.id);
    await t.post('/admin/observadores', { name: 'Juan' }, cookie);
    pin(t.repo.listObserverTokens()[0]!.id);
    expect(await (await t.get('/admin/observadores', cookie)).text()).toContain('10/10/2026 12:01:34');
  });

  it('applies to Usuarios', async () => {
    t.db.prepare("UPDATE admins SET created_at = '2026-10-10 03:01:34'").run();
    expect(await (await t.get('/admin/usuarios', cookie)).text()).toContain('09/10/2026 22:01:34');
  });

  it('applies to Capturas GSI', async () => {
    const gen = generateObserverToken();
    const id = t.repo.createObserverToken('Mati', gen.hash, gen.prefix).id;
    t.repo.upsertGsiCapture(555, id, 'DOTA_GAMERULES_STATE_POST_GAME', true, '{}');
    t.db.prepare("UPDATE gsi_captures SET first_received_at = '2026-10-10 03:01:34', updated_at = '2026-10-10 03:01:34'").run();
    const html = await (await t.get('/admin/capturas', cookie)).text();
    expect(html).toContain('09/10/2026 22:01:34');
    const detail = await (await t.get('/admin/capturas/555', cookie)).text();
    expect(detail).toContain('09/10/2026 22:01:34');
  });
});
