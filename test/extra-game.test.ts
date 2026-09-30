import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Team, Tournament } from '../src/db/repository.js';
import { buildPublicModel } from '../src/public/model.js';
import { buildShare } from '../src/public/share.js';
import { addBlankMatch, addRound, regenerateFixture } from '../src/services/fixture.js';
import { loadState } from '../src/services/state.js';
import { flashText, makeApp, type TestApp } from './helpers/app.js';

let t: TestApp;
let cookie: string;
let tournament: Tournament;
let teams: Team[];

const BEFORE = new Date('2026-09-30T12:00:00Z');
const current = () => t.repo.getTournamentById(tournament.id)!;
const model = () => buildPublicModel(loadState(t.repo, current()), t.repo.listScheduleDays(tournament.id), { now: BEFORE });
const fixtureUrl = () => `/admin/t/${tournament.id}/fixture`;

const win = (id: number, winnerId: number) =>
  t.repo.recordResult(id, { winnerId, team1Kills: 10, team1Deaths: 5, team2Kills: 5, team2Deaths: 10 });

/** Three teams, every regular match played in a cycle: everyone has 1 point. */
async function cycle(tiebreakers: ('kd' | 'kills' | 'h2h' | 'extra')[]) {
  t.repo.updateTournament(tournament.id, { tiebreakers, qualifiers: 2 });
  const [a, b, c] = teams as [Team, Team, Team];
  const mk = (n: number, x: Team, y: Team) => t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: n, matchNumber: n, team1Id: x.id, team2Id: y.id });
  win(mk(1, a, b).id, a.id);
  win(mk(2, b, c).id, b.id);
  win(mk(3, c, a).id, c.id);
}

beforeEach(async () => {
  t = await makeApp();
  cookie = await t.login();
  tournament = t.repo.createTournament({ name: 'Copa', slug: 'copa' });
  t.repo.setActiveTournament(tournament.id);
  teams = ['A', 'B', 'C'].map((code) => t.repo.createTeam(tournament.id, { code, name: `Equipo ${code}` }));
  t.repo.replaceScheduleDays(tournament.id, [{ date: '2026-10-03', phase: 'group', startTimes: ['14:00', '15:00', '16:00'], slotMinutes: 60 }]);
});
afterEach(() => t.db.close());

describe('repository', () => {
  it('stores and returns the extra-game flag, false by default', () => {
    const regular = t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: 1, matchNumber: 1 });
    const extra = t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: 2, matchNumber: 2, isTiebreak: true });
    expect(regular.isTiebreak).toBe(false);
    expect(extra.isTiebreak).toBe(true);
    expect(t.repo.listMatches(tournament.id, 'group').map((m) => m.isTiebreak)).toEqual([false, true]);
  });

  it('keeps the flag when a match is edited or scheduled', () => {
    const extra = t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: 1, matchNumber: 1, isTiebreak: true });
    expect(t.repo.updateMatchSchedule(extra.id, { scheduledDate: '2026-10-03', startTime: '14:00', endTime: '15:00' }).isTiebreak).toBe(true);
    expect(t.repo.updateMatch(extra.id, { round: 1, team1Id: null, team2Id: null, scheduledDate: null, startTime: null, endTime: null }).isTiebreak).toBe(true);
  });
});

describe('state and services', () => {
  it('keeps extra games out of the regular match lists and counters', async () => {
    await cycle(['extra']);
    addBlankMatch(t.repo, tournament.id, 4, { isTiebreak: true });
    const state = loadState(t.repo, current());
    expect(state.groupMatches).toHaveLength(3);
    expect(state.tiebreakMatches).toHaveLength(1);
    expect(state.allGroupMatches).toHaveLength(4);
    expect(state.pendingGroup).toBe(0);
    expect(state.groupComplete).toBe(true);
  });

  it('addBlankMatch / addRound create regular matches unless asked otherwise', () => {
    regenerateFixture(t.repo, tournament);
    expect(addRound(t.repo, tournament.id).isTiebreak).toBe(false);
    expect(addRound(t.repo, tournament.id, { isTiebreak: true }).isTiebreak).toBe(true);
  });
});

describe('admin Fixture', () => {
  it('"+ Agregar partida de desempate" creates an extra game, pre-filled with the tied teams', async () => {
    await cycle(['kd', 'extra']);
    const res = await t.post(`${fixtureUrl()}/desempate`, {}, cookie);
    const created = t.repo.getMatch(Number(res.headers.get('location')!.split('/').pop()))!;
    expect(created.isTiebreak).toBe(true);
    expect(created.phase).toBe('group');
    expect(created.team1Id).not.toBeNull();
    expect(created.team2Id).not.toBeNull();
    expect(created.team1Id).not.toBe(created.team2Id);
  });

  it('"+ Agregar ronda" and "+ partido" still create regular matches', async () => {
    regenerateFixture(t.repo, tournament);
    const res = await t.post(`${fixtureUrl()}/rondas`, {}, cookie);
    expect(t.repo.getMatch(Number(res.headers.get('location')!.split('/').pop()))!.isTiebreak).toBe(false);
  });

  it('tags the extra game in the rounds list', async () => {
    await cycle(['extra']);
    await t.post(`${fixtureUrl()}/desempate`, {}, cookie);
    const html = await (await t.get(fixtureUrl(), cookie)).text();
    expect(html.match(/Juego adicional/g)!.length).toBeGreaterThanOrEqual(1);
    expect(html).toContain('Agregar partida de desempate');
  });
});

describe('admin Resultados', () => {
  it('lists the extra game with its tag, and its result can be entered', async () => {
    await cycle(['extra']);
    const [a, b] = teams as [Team, Team];
    const extra = t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: 4, matchNumber: 4, team1Id: a.id, team2Id: b.id, isTiebreak: true, scheduledDate: '2026-10-03', startTime: '17:00', endTime: '18:00' });
    const page = await (await t.get(`/admin/t/${tournament.id}/resultados?fecha=todos`, cookie)).text();
    expect(page).toContain('Juego adicional');
    const res = await t.post(`/admin/t/${tournament.id}/resultados/${extra.id}`, { winner: String(b.id), t1_kills: '10', t1_deaths: '12', t2_kills: '12', t2_deaths: '10' }, cookie);
    expect(res.status).toBe(303);
    expect(t.repo.getMatch(extra.id)!.winnerId).toBe(b.id);
  });
});

describe('Reglas', () => {
  it('offers "Juego adicional" among the unused criteria, and h2h explains itself', async () => {
    const html = await (await t.get(`/admin/t/${tournament.id}/reglas`, cookie)).text();
    expect(html).toMatch(/<option value="extra">Juego adicional<\/option>/);
    expect(html).toContain('Resultado directo');
    expect(html).toContain('partido jugado entre los empatados');
  });

  it('can add, reorder and save it', async () => {
    const url = `/admin/t/${tournament.id}/reglas`;
    const base = { action: 'save', points_win: '1', points_loss: '0', group_legs: '1', tiebreakers: 'kd,h2h', rules_text: '' };
    await t.post(url, { ...base, action: 'add', new_tiebreaker: 'extra' }, cookie);
    expect(current().tiebreakers).toEqual(['kd', 'h2h', 'extra']);
    const res = await t.post(url, { ...base, tiebreakers: 'kd,h2h,extra', action: 'up:extra' }, cookie);
    expect(await flashText(t, res, cookie)).toContain('Reglas guardadas');
    expect(current().tiebreakers).toEqual(['kd', 'extra', 'h2h']);
  });
});

describe('public page', () => {
  it('shows the extra game as a tagged card but does not count it as a played match', async () => {
    await cycle(['extra']);
    const [a, b] = teams as [Team, Team];
    const extra = t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: 4, matchNumber: 4, team1Id: a.id, team2Id: b.id, isTiebreak: true, scheduledDate: '2026-10-03', startTime: '17:00', endTime: '18:00' });
    let html = await (await t.get('/')).text();
    expect(html).toContain('<span class="tag extra">Juego adicional</span>');
    expect(html).toContain('3 de 3 partidos jugados');
    expect(model().progress).toEqual({ played: 3, total: 3, percent: 100 });
    win(extra.id, b.id);
    html = await (await t.get('/')).text();
    expect(html).toContain('3 de 3 partidos jugados');
    expect(html).toContain('Juego adicional');
  });

  it('the round of an extra game never shows a "Descansa"', async () => {
    await cycle(['extra']);
    const [a, b] = teams as [Team, Team];
    t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: 4, matchNumber: 4, team1Id: a.id, team2Id: b.id, isTiebreak: true });
    const round = model().days.flatMap((d) => d.rounds).find((r) => r.number === 4)!;
    expect(round.bye).toBeNull();
    expect(round.matches[0]!.isTiebreak).toBe(true);
  });

  it('labels a pending tie "Pendiente de juego adicional", and a plain one "Empate sin resolver"', async () => {
    await cycle(['kd', 'h2h', 'extra']);
    let body = await (await t.get('/')).text();
    expect(body.match(/>Pendiente de juego adicional</g)?.length).toBe(3);
    expect(body).not.toContain('>Empate sin resolver<');
    t.repo.updateTournament(tournament.id, { tiebreakers: ['kd', 'h2h'] });
    body = await (await t.get('/')).text();
    expect(body.match(/>Empate sin resolver</g)?.length).toBe(3);
    expect(body).not.toContain('>Pendiente de juego adicional<');
  });

  it('the extra game decides the table once played', async () => {
    await cycle(['extra']);
    const [a, b, c] = teams as [Team, Team, Team];
    const mk = (n: number, x: Team, y: Team, w: Team) => win(t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: n, matchNumber: n, team1Id: x.id, team2Id: y.id, isTiebreak: true }).id, w.id);
    mk(4, a, b, b);
    mk(5, a, c, c);
    mk(6, b, c, b);
    const rows = model().standings.map((r) => r.team.code).join('');
    expect(rows).toBe('BCA');
  });

  it('lists the wording of the two new texts in the legend and the Reglas tab', async () => {
    t.repo.updateTournament(tournament.id, { tiebreakers: ['kd', 'h2h', 'extra'] });
    const body = await (await t.get('/')).text();
    expect(body).toContain('<b>Desempate:</b> K−D, luego resultado jugado entre los empatados, luego juego adicional');
    expect(body).toContain('Resultado jugado entre los equipos empatados');
    expect(body).toContain('Juego adicional entre los equipos empatados');
    expect(body).not.toContain('Resultado directo entre los equipos empatados');
  });
});

describe('share text', () => {
  it('does not count extra games as played or total matches', async () => {
    regenerateFixture(t.repo, tournament);
    const regular = t.repo.listMatches(tournament.id, 'group');
    const [x, y] = teams as [Team, Team];
    t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: 99, matchNumber: 99, team1Id: x.id, team2Id: y.id, isTiebreak: true });
    expect(buildShare(model()).description).toContain(`0/${regular.length} partidos`);
    const first = t.repo.listMatches(tournament.id, 'group').find((m) => !m.isTiebreak)!;
    win(first.id, first.team1Id!);
    expect(buildShare(model()).description).toContain(`1/${regular.length} partidos`);
  });
});
