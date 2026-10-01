import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Match, Team, Tournament } from '../src/db/repository.js';
import { flashText, makeApp, type TestApp } from './helpers/app.js';

let t: TestApp;
let cookie: string;
let tournament: Tournament;
let a: Team;
let b: Team;
let c: Team;
let d: Team;
const NOW = new Date('2026-10-03T19:23:00.000Z');

beforeEach(async () => {
  t = await makeApp({ now: () => NOW });
  cookie = await t.login();
  tournament = t.repo.createTournament({ name: 'Copa', slug: 'copa' });
  t.repo.setActiveTournament(tournament.id);
  [a, b, c, d] = ['A', 'B', 'C', 'D'].map((code) => t.repo.createTeam(tournament.id, { code, name: `Equipo ${code}` })) as [Team, Team, Team, Team];
});
afterEach(() => t.db.close());

const base = () => `/admin/t/${tournament.id}`;
const fresh = () => t.repo.getTournamentById(tournament.id)!;
const lives = () => t.repo.listLive(tournament.id);
const live = () => lives()[0] ?? null;
const groupMatch = (n = 1, t1: Team | null = a, t2: Team | null = b): Match =>
  t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: n, matchNumber: n, team1Id: t1?.id ?? null, team2Id: t2?.id ?? null });
const page = async (path = '/resultados?fecha=todos') => (await t.get(`${base()}${path}`, cookie)).text();
const mark = (m: Match, n = 1, action = 'mark') => t.post(`${base()}/resultados/${m.id}/juego/${n}/en-vivo`, { action, fecha: 'todos' }, cookie);
const result = (winner: Team) => ({ winner: String(winner.id), t1_kills: '20', t1_deaths: '10', t2_kills: '10', t2_deaths: '20' });

describe('Resultados: marcar en vivo', () => {
  it('a pending game offers "Marcar en vivo"; nothing is live yet', async () => {
    groupMatch();
    const html = await page();
    expect(html).toContain('▶ Marcar en vivo');
    expect(html).not.toContain('EN VIVO ·');
    expect(html).toContain('Se pueden marcar varios a la vez.');
  });

  it('marking sets the live game, tells the public page and shows the badge with the minutes', async () => {
    const m = groupMatch();
    let changes = 0;
    t.events.onTournamentChanged(tournament.id, () => changes++);
    const res = await mark(m);
    expect(res.status).toBe(303);
    expect(live()).toEqual({ matchId: m.id, gameNumber: 1, startedAt: NOW.toISOString() });
    expect(changes).toBe(1);
    const html = await page();
    expect(html).toContain('● EN VIVO · 0 min');
    expect(html).toContain('■ Quitar en vivo');
    expect(html).toContain('Al guardar el resultado de este juego, el «en vivo» se apaga solo.');
    expect(html).toMatch(/class="rc series open on"/);
  });

  it('the badge counts the minutes since it was marked', async () => {
    const m = groupMatch();
    t.repo.setLive(m.id, { gameNumber: 1, startedAt: '2026-10-03T19:00:00.000Z' });
    expect(await page()).toContain('● EN VIVO · 23 min');
  });

  it('marking another match keeps the first one live: several games at once', async () => {
    const m1 = groupMatch(1);
    const m2 = groupMatch(2, c, d);
    await mark(m1);
    await mark(m2);
    expect(lives().map((l) => l.matchId)).toEqual([m1.id, m2.id]);
    const html = await page();
    expect(html.match(/● EN VIVO · /g)).toHaveLength(2);
  });

  it('"Pasar al stream" puts a live match on the stream, only one at a time, and toggles off', async () => {
    const m1 = groupMatch(1);
    const m2 = groupMatch(2, c, d);
    await mark(m1);
    await mark(m2);
    const res = await mark(m1, 1, 'stream');
    expect(res.status).toBe(303);
    expect(fresh().streamMatchId).toBe(m1.id);
    let html = await page();
    expect(html).toContain('📺 EN TRANSMISIÓN · 0 min');
    expect(html).toContain('📺 En el stream');
    expect(html).toContain('📺 Pasar al stream');
    expect(html).toMatch(/class="rc series open tv"/);
    await mark(m2, 1, 'stream');
    expect(fresh().streamMatchId).toBe(m2.id);
    await mark(m2, 1, 'unstream');
    expect(fresh().streamMatchId).toBeNull();
    expect(lives()).toHaveLength(2);
    html = await page();
    expect(html).not.toContain('EN TRANSMISIÓN');
  });

  it('the stream button only exists on a live match, and the server refuses a match that is not live', async () => {
    const m = groupMatch();
    expect(await page()).not.toContain('Pasar al stream');
    const res = await mark(m, 1, 'stream');
    expect(await flashText(t, res, cookie)).toContain('Solo se puede pasar al stream una partida en vivo.');
    expect(fresh().streamMatchId).toBeNull();
  });

  it('clearing the live mark of the stream match takes it off the stream', async () => {
    const m = groupMatch();
    await mark(m);
    await mark(m, 1, 'stream');
    await mark(m, 1, 'clear');
    expect(fresh().streamMatchId).toBeNull();
  });

  it('a stale "unstream" for another match leaves the stream alone', async () => {
    const m1 = groupMatch(1);
    const m2 = groupMatch(2, c, d);
    await mark(m1);
    await mark(m2);
    await mark(m1, 1, 'stream');
    await mark(m2, 1, 'unstream');
    expect(fresh().streamMatchId).toBe(m1.id);
  });

  it('"Quitar en vivo" clears it, and clearing nothing is harmless', async () => {
    const m = groupMatch();
    await mark(m);
    await mark(m, 1, 'clear');
    expect(live()).toBeNull();
    expect((await mark(m, 1, 'clear')).status).toBe(303);
  });

  it('a stale "Quitar en vivo" from another match or game leaves the current live game alone', async () => {
    t.repo.updateTournament(tournament.id, { groupGames: 3 });
    const m1 = groupMatch(1);
    const m2 = groupMatch(2, c, d);
    await mark(m2);
    const res = await mark(m1, 1, 'clear');
    expect(await flashText(t, res, cookie)).toContain('Ese partido ya no estaba en vivo.');
    expect(live()).toMatchObject({ matchId: m2.id, gameNumber: 1 });
    await mark(m2, 2, 'clear');
    expect(live()).toMatchObject({ matchId: m2.id, gameNumber: 1 });
    await mark(m2, 1, 'clear');
    expect(live()).toBeNull();
  });

  it('saving the live game of an open series advances the badge to the next game, keeping the stream', async () => {
    t.repo.updateTournament(tournament.id, { groupGames: 3 });
    const m = groupMatch();
    await mark(m);
    await mark(m, 1, 'stream');
    let changes = 0;
    t.events.onTournamentChanged(tournament.id, () => changes++);
    await t.post(`${base()}/resultados/${m.id}/juego/1`, result(a), cookie);
    expect(live()).toMatchObject({ matchId: m.id, gameNumber: 2, startedAt: NOW.toISOString() });
    expect(fresh().streamMatchId).toBe(m.id);
    expect(changes).toBeGreaterThan(0);
    const html = await page();
    expect(html).toContain('📺 EN TRANSMISIÓN · 0 min');
    await t.post(`${base()}/resultados/${m.id}/juego/2`, result(a), cookie);
    expect(live()).toBeNull();
    expect(fresh().streamMatchId).toBeNull();
  });

  it('saving the result of the live game turns it off by itself', async () => {
    const m = groupMatch();
    await mark(m);
    await t.post(`${base()}/resultados/${m.id}/juego/1`, result(a), cookie);
    expect(live()).toBeNull();
    expect(await page()).not.toContain('EN VIVO ·');
  });

  it('a match without both teams shows the button disabled with its hint, and the server refuses it', async () => {
    const open = groupMatch(1, a, null);
    const html = await page();
    expect(html).toMatch(/<button class="btn sm live" type="button" disabled=""[^>]*>\s*▶ Marcar en vivo/);
    expect(html).toContain('Se habilita cuando están los dos equipos.');
    const res = await mark(open);
    expect(await flashText(t, res, cookie)).toContain('El partido todavía no tiene los dos equipos definidos.');
    expect(live()).toBeNull();
  });

  it('an already played game has no live button and the server refuses it', async () => {
    const m = groupMatch();
    await t.post(`${base()}/resultados/${m.id}/juego/1`, result(a), cookie);
    expect(await page()).not.toContain('▶ Marcar en vivo');
    const res = await mark(m);
    expect(await flashText(t, res, cookie)).toContain('Ese juego ya tiene resultado.');
  });

  it('in a series only the next game can be live', async () => {
    t.repo.updateTournament(tournament.id, { groupGames: 3 });
    const m = groupMatch();
    expect(await flashText(t, await mark(m, 2), cookie)).toContain('Marca primero el juego 1');
    await t.post(`${base()}/resultados/${m.id}/juego/1`, result(a), cookie);
    await mark(m, 2);
    expect(live()).toMatchObject({ matchId: m.id, gameNumber: 2 });
    const html = await page();
    expect(html).toContain('● EN VIVO');
    await t.post(`${base()}/resultados/${m.id}/juego/2`, result(a), cookie);
    expect(live()).toBeNull();
    expect(await flashText(t, await mark(m, 3), cookie)).toContain('La serie ya está decidida.');
  });

  it('needs a login and a same-origin request; other tournaments cannot be touched; bad game numbers are refused', async () => {
    const m = groupMatch();
    const anon = await t.send('POST', `${base()}/resultados/${m.id}/juego/1/en-vivo`, { form: { action: 'mark' } });
    expect(anon.status).toBe(303);
    expect(anon.headers.get('location')).toBe('/admin/login');
    const foreign = await t.send('POST', `${base()}/resultados/${m.id}/juego/1/en-vivo`, { form: { action: 'mark' }, cookie, headers: { origin: 'http://evil.example' } });
    expect(foreign.status).toBe(403);
    const other = t.repo.createTournament({ name: 'Otra', slug: 'otra' });
    expect((await t.post(`/admin/t/${other.id}/resultados/${m.id}/juego/1/en-vivo`, { action: 'mark' }, cookie)).status).toBe(404);
    expect(await flashText(t, await mark(m, 9), cookie)).toContain('Ese juego no existe.');
    expect(live()).toBeNull();
  });
});

describe('Playoffs: marcar en vivo', () => {
  const setup = async () => {
    await t.post(`${base()}/playoffs/cruces`, { sf1_a: String(a.id), sf1_b: String(d.id), sf2_a: String(b.id), sf2_b: String(c.id) }, cookie);
  };
  const markPlayoff = (phase: string, number: number, game = 1, action = 'mark') =>
    t.post(`${base()}/playoffs/${phase}/${number}/juego/${game}/en-vivo`, { action }, cookie);

  it('marks a semifinal game; the page shows the badge; saving the game moves it to the next game and deciding the series turns it off', async () => {
    await setup();
    await markPlayoff('semifinal', 2);
    const sf2 = t.repo.listMatches(tournament.id, 'semifinal').find((m) => m.matchNumber === 2)!;
    expect(live()).toMatchObject({ matchId: sf2.id, gameNumber: 1 });
    const html = await (await t.get(`${base()}/playoffs`, cookie)).text();
    expect(html).toContain('● EN VIVO · 0 min');
    expect(html).toContain('■ Quitar en vivo');
    await t.post(`${base()}/playoffs/semifinal/2/juego/1`, result(b), cookie);
    expect(live()).toMatchObject({ matchId: sf2.id, gameNumber: 2 });
    await t.post(`${base()}/playoffs/semifinal/2/juego/2`, result(b), cookie);
    expect(live()).toBeNull();
  });

  it('the final is disabled until both finalists exist', async () => {
    await setup();
    const html = await (await t.get(`${base()}/playoffs`, cookie)).text();
    expect(html).toMatch(/disabled=""[^>]*>\s*▶ Marcar en vivo/);
    const res = await markPlayoff('final', 1);
    expect(await flashText(t, res, cookie)).toContain('El partido todavía no tiene los dos equipos definidos.');
  });

  it('a stale clear from another playoff match leaves the live one alone', async () => {
    await setup();
    await markPlayoff('semifinal', 2);
    await markPlayoff('semifinal', 1, 1, 'clear');
    expect(live()).not.toBeNull();
    await markPlayoff('semifinal', 2, 1, 'clear');
    expect(live()).toBeNull();
  });

  it('two semifinals can be live together and one goes to the stream', async () => {
    await setup();
    await markPlayoff('semifinal', 1);
    await markPlayoff('semifinal', 2);
    expect(lives()).toHaveLength(2);
    await t.post(`${base()}/playoffs/semifinal/2/juego/1/en-vivo`, { action: 'stream' }, cookie);
    const sf2 = t.repo.listMatches(tournament.id, 'semifinal').find((m) => m.matchNumber === 2)!;
    expect(fresh().streamMatchId).toBe(sf2.id);
    expect(lives()[0]!.matchId).toBe(sf2.id);
  });

  it('refuses unknown playoff matches and clears by hand', async () => {
    await setup();
    expect((await markPlayoff('semifinal', 3)).status).toBe(404);
    await markPlayoff('semifinal', 1);
    await markPlayoff('semifinal', 1, 1, 'clear');
    expect(live()).toBeNull();
  });
});
