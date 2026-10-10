import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateObserverToken } from '../src/auth/observer-token.js';
import { makeApp, type TestApp } from './helpers/app.js';

const IN_PROGRESS = 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS';
const POST_GAME = 'DOTA_GAMERULES_STATE_POST_GAME';

let t: TestApp;
let cookie: string;
let token: string;
let hits: number;
beforeEach(async () => {
  t = await makeApp({ heartbeatMs: 60_000 });
  cookie = await t.login();
  const gen = generateObserverToken();
  token = gen.token;
  t.repo.createObserverToken('Juan', gen.hash, gen.prefix);
  hits = 0;
  t.events.onCapturesChanged(() => hits++);
});
afterEach(() => t.db.close());

const post = (matchid: unknown, state: string) =>
  t.app.request('/gsi', {
    method: 'POST',
    body: JSON.stringify({ auth: { token }, map: { matchid, game_state: state } }),
    headers: { 'content-type': 'application/json' },
  });

describe('captures-changed bus', () => {
  it('unsubscribes', () => {
    let n = 0;
    const off = t.events.onCapturesChanged(() => n++);
    t.events.capturesChanged();
    off();
    t.events.capturesChanged();
    expect(n).toBe(1);
  });
});

describe('POST /gsi emits', () => {
  it('on a stored and on an updated capture', async () => {
    await post('100', IN_PROGRESS);
    await post('100', IN_PROGRESS);
    expect(hits).toBe(2);
  });

  it('not for ignored posts, bad tokens or a protected final capture', async () => {
    await post('0', IN_PROGRESS);
    await post(undefined, IN_PROGRESS);
    expect(hits).toBe(0);
    await post('100', POST_GAME);
    expect(hits).toBe(1);
    await post('100', IN_PROGRESS);
    expect(hits).toBe(1);
    await t.app.request('/gsi', {
      method: 'POST',
      body: JSON.stringify({ auth: { token: 'nope' }, map: { matchid: '5' } }),
      headers: { 'content-type': 'application/json' },
    });
    expect(hits).toBe(1);
  });
});

describe('admin changes emit', () => {
  it('on deleting a capture, not when it does not exist', async () => {
    await post('100', IN_PROGRESS);
    hits = 0;
    await t.post('/admin/capturas/999/borrar', {}, cookie);
    expect(hits).toBe(0);
    await t.post('/admin/capturas/100/borrar', {}, cookie);
    expect(hits).toBe(1);
  });

  it('on saving and clearing a game', async () => {
    const tournament = t.repo.createTournament({ name: 'Copa', slug: 'copa' });
    const a = t.repo.createTeam(tournament.id, { code: 'A', name: 'Equipo A' });
    const b = t.repo.createTeam(tournament.id, { code: 'B', name: 'Equipo B' });
    const m = t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: 1, matchNumber: 1, team1Id: a.id, team2Id: b.id });
    const url = `/admin/t/${tournament.id}/resultados/${m.id}/juego/1`;
    const form = { winner: String(a.id), t1_kills: '30', t1_deaths: '20', t2_kills: '20', t2_deaths: '30' };
    expect((await t.post(url, form, cookie)).status).toBe(303);
    expect(hits).toBe(1);
    await t.post(url, { action: 'clear' }, cookie);
    expect(hits).toBe(2);
  });
});

const decoder = new TextDecoder();
async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string, ms = 1000): Promise<string> {
  let text = '';
  const deadline = Date.now() + ms;
  while (!text.includes(needle) && Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), 100))]);
    if (chunk && chunk.value) text += decoder.decode(chunk.value);
  }
  return text;
}

describe('GET /admin/capturas/eventos', () => {
  it('requires a login', async () => {
    const res = await t.get('/admin/capturas/eventos');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/login');
  });

  it('says hello, streams a change and unsubscribes on disconnect', async () => {
    const base = t.events.emitter.listenerCount('captures:changed');
    const res = await t.get('/admin/capturas/eventos', cookie);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    expect(await readUntil(reader, 'retry: 3000')).toContain('event: hello');
    expect(t.events.emitter.listenerCount('captures:changed')).toBe(base + 1);
    await post('300', IN_PROGRESS);
    expect(await readUntil(reader, 'event: change')).toContain('event: change');
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 50));
    expect(t.events.emitter.listenerCount('captures:changed')).toBe(base);
  });
});

describe('pages carry the hooks the client needs', () => {
  it('list: live region, row keys and nav badge hook', async () => {
    await post('100', POST_GAME);
    const html = await (await t.get('/admin/capturas', cookie)).text();
    expect(html).toContain('data-live-page="capturas-list"');
    expect(html).toContain('data-live-region');
    expect(html).toContain('data-capture-key="100"');
    expect(html).toContain('data-live-nav="capturas"');
  });

  it('detail has the live region; other pages only the nav hook', async () => {
    await post('100', POST_GAME);
    const html = await (await t.get('/admin/capturas/100', cookie)).text();
    expect(html).toContain('data-live-page="capturas-detail"');
    const other = await (await t.get('/admin/observadores', cookie)).text();
    expect(other).not.toContain('data-live-page');
    expect(other).toContain('data-live-nav="capturas"');
  });

  it('a deleted capture renders the not-found page without a live region', async () => {
    const res = await t.get('/admin/capturas/12345', cookie);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('data-live-page');
  });
});
