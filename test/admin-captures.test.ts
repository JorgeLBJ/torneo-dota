import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateObserverToken } from '../src/auth/observer-token.js';
import { INCOMPLETE_AFTER_MS, captureStateOf } from '../src/gsi/state.js';
import { flashText, makeApp, type TestApp } from './helpers/app.js';

const POST_GAME = 'DOTA_GAMERULES_STATE_POST_GAME';
const IN_PROGRESS = 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS';
const sample = () => JSON.parse(readFileSync(new URL('./fixtures/gsi-spectator-sample.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-10-09T22:00:00Z');

let t: TestApp;
let cookie: string;
let observerId: number;
beforeEach(async () => {
  t = await makeApp({ now: () => NOW });
  cookie = await t.login();
  const gen = generateObserverToken();
  observerId = t.repo.createObserverToken('Mati', gen.hash, gen.prefix).id;
});
afterEach(() => t.db.close());

/** Stores a capture and pins its timestamps (SQLite UTC) so the state depends only on the injected clock. */
function capture(matchId: number, opts: { final?: boolean; updated?: string; state?: unknown } = {}) {
  const final = opts.final ?? false;
  t.repo.upsertGsiCapture(matchId, observerId, final ? POST_GAME : IN_PROGRESS, final, JSON.stringify(opts.state ?? sample()));
  const updated = opts.updated ?? '2026-10-09 21:59:50';
  t.db.prepare('UPDATE gsi_captures SET first_received_at = ?, updated_at = ? WHERE dota_match_id = ?').run('2026-10-09 21:00:00', updated, matchId);
}

/** A saved game that used the capture's Dota match id. */
function linkGame(matchId: number) {
  const tournament = t.repo.createTournament({ name: 'Copa Octubre', slug: 'copa' });
  const a = t.repo.createTeam(tournament.id, { code: 'A', name: 'Equipo A' });
  const b = t.repo.createTeam(tournament.id, { code: 'B', name: 'Equipo B' });
  const m = t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: 3, matchNumber: 7, team1Id: a.id, team2Id: b.id });
  t.repo.saveGame(m.id, { gameNumber: 1, winnerId: a.id, team1Kills: 42, team1Deaths: 37, team2Kills: 37, team2Deaths: 42, radiantTeamId: a.id, dotaMatchId: matchId, dotaSnapshot: null });
  return { tournament, match: m, a, b };
}

describe('captureStateOf', () => {
  const at = (ms: number) => new Date(NOW.getTime() - ms);
  const stamp = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
  it('is final once the final state arrived, whatever the age', () => {
    expect(captureStateOf({ isFinal: true, updatedAt: stamp(at(10 * INCOMPLETE_AFTER_MS)) }, NOW)).toBe('final');
  });
  it('is live while updates keep coming and incomplete after the threshold', () => {
    expect(INCOMPLETE_AFTER_MS).toBe(5 * 60 * 1000);
    expect(captureStateOf({ isFinal: false, updatedAt: stamp(at(INCOMPLETE_AFTER_MS)) }, NOW)).toBe('live');
    expect(captureStateOf({ isFinal: false, updatedAt: stamp(at(INCOMPLETE_AFTER_MS + 1000)) }, NOW)).toBe('incomplete');
    expect(captureStateOf({ isFinal: false, updatedAt: 'garbage' }, NOW)).toBe('incomplete');
  });
});

describe('Capturas GSI list', () => {
  it('requires a login', async () => {
    const res = await t.get('/admin/capturas');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/login');
  });

  it('starts empty and is linked from the navigation', async () => {
    const html = await (await t.get('/admin/capturas', cookie)).text();
    expect(html).toContain('href="/admin/capturas"');
    expect(html).toContain('Aún no hay capturas');
    expect(html).not.toContain('sin vincular</span>');
  });

  it('shows state, score with the winner side, duration, observer and last update', async () => {
    capture(9028047526, { final: true, updated: '2026-10-09 21:30:00' });
    capture(9031277410, { updated: '2026-10-09 21:59:50' });
    capture(9027990012, { updated: '2026-10-09 21:50:00' });
    const html = await (await t.get('/admin/capturas', cookie)).text();
    expect(html).toContain('9028047526');
    expect(html).toContain('Finalizada');
    expect(html).toContain('42');
    expect(html).toContain('37');
    expect(html).toContain('Radiant');
    expect(html).toContain('35:12'); // 2112 s
    expect(html).toContain('Mati');
    expect(html).toContain('En curso');
    expect(html).toContain('Incompleta');
    expect(html).toContain('09/10/2026 21:30:00');
    expect(html).toContain('href="/admin/capturas/9028047526"');
  });

  it('shows what it can for a state the mapper cannot read', async () => {
    capture(555, { state: { map: { matchid: '555', radiant_score: 3 } } });
    capture(556, { state: 'not-an-object' });
    const res = await t.get('/admin/capturas', cookie);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('555');
  });

  it('badges the final captures that no saved game uses', async () => {
    capture(1, { final: true });
    capture(2, { final: true });
    capture(3, { final: false });
    linkGame(2);
    const html = await (await t.get('/admin/capturas', cookie)).text();
    expect(html).toMatch(/1 sin vincular/);
  });

  it('shows what a capture is linked to', async () => {
    const { tournament } = linkGame(77);
    capture(77, { final: true });
    const html = await (await t.get('/admin/capturas', cookie)).text();
    expect(html).toContain('Copa Octubre');
    expect(html).toContain('Fecha 3');
    expect(html).toContain('Equipo A vs Equipo B');
    expect(html).toContain(`/admin/t/${tournament.id}/resultados`);
  });

  it('filters by state with counts and searches by Match ID', async () => {
    capture(101, { final: true }); // sin vincular
    capture(102, { final: true }); // vinculada
    capture(103, { updated: '2026-10-09 21:59:55' }); // en curso
    linkGame(102);
    const all = await (await t.get('/admin/capturas', cookie)).text();
    expect(all).toContain('Todas · 3');
    expect(all).toContain('En curso · 1');
    expect(all).toContain('Sin vincular · 1');
    expect(all).toContain('Vinculadas · 1');

    const live = await (await t.get('/admin/capturas?estado=en-curso', cookie)).text();
    expect(live).toContain('/admin/capturas/103"');
    expect(live).not.toContain('/admin/capturas/101"');
    const unlinked = await (await t.get('/admin/capturas?estado=sin-vincular', cookie)).text();
    expect(unlinked).toContain('/admin/capturas/101"');
    expect(unlinked).not.toContain('/admin/capturas/102"');
    const linked = await (await t.get('/admin/capturas?estado=vinculadas', cookie)).text();
    expect(linked).toContain('/admin/capturas/102"');
    expect(linked).not.toContain('/admin/capturas/101"');
    const found = await (await t.get('/admin/capturas?q=102', cookie)).text();
    expect(found).toContain('/admin/capturas/102"');
    expect(found).not.toContain('/admin/capturas/103"');
  });

  it('paginates', async () => {
    for (let i = 1; i <= 60; i++) capture(5000 + i, { final: true });
    const first = await (await t.get('/admin/capturas', cookie)).text();
    expect((first.match(/href="\/admin\/capturas\/5\d{3}"/g) ?? []).length).toBe(50);
    expect(first).toContain('pagina=2');
    const second = await (await t.get('/admin/capturas?pagina=2', cookie)).text();
    expect((second.match(/href="\/admin\/capturas\/5\d{3}"/g) ?? []).length).toBe(10);
  });
});

describe('Capture detail', () => {
  it('answers 404 for an unknown or malformed id', async () => {
    expect((await t.get('/admin/capturas/12345', cookie)).status).toBe(404);
    expect((await t.get('/admin/capturas/abc', cookie)).status).toBe(404);
  });

  it('shows the header, score and ten players', async () => {
    capture(9028047526, { final: true });
    const res = await t.get('/admin/capturas/9028047526', cookie);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('9028047526');
    expect(html).toContain('Mati');
    expect(html).toContain('Finalizada');
    expect(html).toContain('35:12');
    expect(html).toContain('Radiant');
    expect(html).toContain('Dire');
    for (const nick of ['Juan', 'Ana', 'Luis', 'Beto']) expect(html).toContain(nick);
    expect(html).toContain('3 / 5 / 7');
    expect(html).toContain('150 / 5');
    expect(html).toContain('15.0k');
  });

  it('keeps the raw JSON collapsed and escaped', async () => {
    const state = sample();
    state.player.team2.player0.name = '<script>alert(1)</script>';
    capture(31, { final: true, state });
    const html = await (await t.get('/admin/capturas/31', cookie)).text();
    expect(html).toMatch(/<details[^>]*>\s*<summary>[^<]*JSON/);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('renders an unfinished capture with whatever players it has', async () => {
    capture(32, { state: { map: { matchid: '32', radiant_score: 4, dire_score: 2, clock_time: 300 } } });
    const res = await t.get('/admin/capturas/32', cookie);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('5:00');
  });
});

describe('Deleting a capture', () => {
  it('removes it so a correct observer can send the match again', async () => {
    capture(40, { final: true });
    const res = await t.post('/admin/capturas/40/borrar', {}, cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/capturas');
    expect(await flashText(t, res, cookie)).toContain('40');
    expect(t.repo.getGsiCapture(40)).toBeUndefined();
    expect(t.repo.upsertGsiCapture(40, observerId, IN_PROGRESS, false, '{}')).toBe(true);
  });

  it('leaves a saved game that used the capture untouched, and says so in the confirmation', async () => {
    const { match } = linkGame(41);
    capture(41, { final: true });
    const html = await (await t.get('/admin/capturas/41', cookie)).text();
    expect(html).toContain('Borrar captura');
    expect(html).toContain('no modifica');
    await t.post('/admin/capturas/41/borrar', {}, cookie);
    expect(t.repo.getGsiCapture(41)).toBeUndefined();
    expect(t.repo.listGames(match.id)).toHaveLength(1);
    expect(t.repo.listGames(match.id)[0]!.dotaMatchId).toBe(41);
  });

  it('answers an unknown id with an error flash', async () => {
    const res = await t.post('/admin/capturas/999/borrar', {}, cookie);
    expect(res.status).toBe(303);
    expect(await flashText(t, res, cookie)).toContain('no existe');
  });
});

describe('Observadores screen after the move', () => {
  it('no longer lists recent captures and shows a capture count per observer', async () => {
    capture(1);
    capture(2, { final: true });
    const html = await (await t.get('/admin/observadores', cookie)).text();
    expect(html).not.toContain('Capturas recientes');
    expect(html).toContain('<th>Capturas</th>');
    expect(html).toMatch(/data-label="Capturas">2</);
  });
});
