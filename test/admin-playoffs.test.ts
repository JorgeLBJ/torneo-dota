import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Team, Tournament } from '../src/db/repository.js';
import { regenerateFixture } from '../src/services/fixture.js';
import { flashText, makeApp, type TestApp } from './helpers/app.js';

let t: TestApp;
let cookie: string;
let tournament: Tournament;
let base: string;
let teams: Team[];

beforeEach(async () => {
  t = await makeApp();
  cookie = await t.login();
  tournament = t.repo.createTournament({ name: 'Torneo Oct', slug: 'torneo-oct' });
  base = `/admin/t/${tournament.id}/playoffs`;
  teams = ['Alpha', 'Bravo', 'Corsarios', 'Delta', 'Eclipse'].map((name, i) =>
    t.repo.createTeam(tournament.id, { code: String.fromCharCode(65 + i), name }),
  );
  t.repo.replaceScheduleDays(tournament.id, [
    { date: '2026-10-03', phase: 'group', startTimes: ['14:00', '15:00', '16:00', '17:00', '18:00'], slotMinutes: 60 },
    { date: '2026-10-11', phase: 'semifinal', startTimes: ['14:00', '15:00'], slotMinutes: 60 },
    { date: '2026-10-17', phase: 'final', startTimes: ['14:00'], slotMinutes: 60 },
  ]);
  regenerateFixture(t.repo, tournament);
});
afterEach(() => t.db.close());

/** The lower team index always wins, so the order is A > B > C > D > E. */
const playGroup = () => {
  for (const m of t.repo.listMatches(tournament.id, 'group')) {
    const i1 = teams.findIndex((x) => x.id === m.team1Id);
    const i2 = teams.findIndex((x) => x.id === m.team2Id);
    const t1Wins = i1 < i2;
    t.repo.recordResult(m.id, {
      winnerId: t1Wins ? m.team1Id! : m.team2Id!,
      team1Kills: t1Wins ? 20 : 10,
      team1Deaths: t1Wins ? 10 : 20,
      team2Kills: t1Wins ? 10 : 20,
      team2Deaths: t1Wins ? 20 : 10,
    });
  }
};

const form = (winner: number, extra: Record<string, string> = {}) => ({
  action: 'save', winner: String(winner), t1_kills: '15', t1_deaths: '8', t2_kills: '8', t2_deaths: '15', ...extra,
});

describe('playoffs screen', () => {
  it('explains how many group matches are missing', async () => {
    const html = await (await t.get(base, cookie)).text();
    expect(html).toContain('Fase de grupos: faltan 10 partidos');
    expect(html).toContain('Semifinal 1');
    expect(html).toContain('Gran final');
    expect(html).toContain('Por definir');
  });

  it('seeds the semifinals from the standings once the group stage is complete', async () => {
    playGroup();
    const html = await (await t.get(base, cookie)).text();
    expect(html).toContain('1.º Alpha');
    expect(html).toContain('4.º Delta');
    expect(html).toContain('2.º Bravo');
    expect(html).toContain('3.º Corsarios');
    expect(html).not.toContain('Fase de grupos: faltan');
  });

  it('records both semifinals and the final and shows the champion', async () => {
    playGroup();
    const [a, b] = [teams[0]!, teams[1]!];
    expect((await t.post(`${base}/semifinal/1`, form(a.id), cookie)).status).toBe(303);
    expect((await t.post(`${base}/semifinal/2`, form(b.id), cookie)).status).toBe(303);
    let html = await (await t.get(base, cookie)).text();
    expect(html).toContain('Gran final');
    await t.post(`${base}/final/1`, form(b.id), cookie);
    html = await (await t.get(base, cookie)).text();
    expect(html).toContain('Campeón');
    expect(html).toContain('Bravo');
    const finals = t.repo.listMatches(tournament.id, 'final');
    expect(finals[0]).toMatchObject({ team1Id: a.id, team2Id: b.id, winnerId: b.id });
  });

  it('schedules playoff matches from the calendar', async () => {
    playGroup();
    await t.post(`${base}/semifinal/1`, form(teams[0]!.id), cookie);
    const sf = t.repo.listMatches(tournament.id, 'semifinal');
    expect(sf.map((m) => `${m.scheduledDate} ${m.startTime}`)).toEqual(['2026-10-11 14:00', '2026-10-11 15:00']);
  });

  it('rejects a winner that is not in the match and results before the teams are known', async () => {
    const early = await t.post(`${base}/semifinal/1`, form(teams[0]!.id), cookie);
    expect(await flashText(t, early, cookie)).toContain('equipos');
    playGroup();
    const wrong = await t.post(`${base}/semifinal/1`, form(teams[1]!.id), cookie);
    expect(await flashText(t, wrong, cookie)).toContain('ganador');
    const final = await t.post(`${base}/final/1`, form(teams[0]!.id), cookie);
    expect(await flashText(t, final, cookie)).toContain('equipos');
    expect(t.repo.listMatches(tournament.id).filter((m) => m.phase !== 'group' && m.winnerId !== null)).toHaveLength(0);
  });

  it('rejects unknown playoff slots', async () => {
    expect((await t.post(`${base}/cuartos/1`, form(1), cookie)).status).toBe(404);
    expect((await t.post(`${base}/semifinal/3`, form(1), cookie)).status).toBe(404);
    expect((await t.post(`${base}/final/2`, form(1), cookie)).status).toBe(404);
  });

  it('clears a semifinal result and the final with it', async () => {
    playGroup();
    await t.post(`${base}/semifinal/1`, form(teams[0]!.id), cookie);
    await t.post(`${base}/semifinal/2`, form(teams[1]!.id), cookie);
    await t.post(`${base}/final/1`, form(teams[0]!.id), cookie);
    await t.post(`${base}/semifinal/1`, { action: 'clear' }, cookie);
    const sf = t.repo.listMatches(tournament.id, 'semifinal');
    expect(sf[0]!.winnerId).toBeNull();
    expect(t.repo.listMatches(tournament.id, 'final')[0]!.winnerId).toBeNull();
  });

  it('lets the admin pick the semifinal teams manually', async () => {
    const ids = teams.slice(0, 4).map((x) => String(x.id));
    const res = await t.post(`${base}/cruces`, { sf1_a: ids[3]!, sf1_b: ids[0]!, sf2_a: ids[1]!, sf2_b: ids[2]! }, cookie);
    expect(res.status).toBe(303);
    const sf = t.repo.listMatches(tournament.id, 'semifinal');
    expect(sf[0]).toMatchObject({ team1Id: teams[3]!.id, team2Id: teams[0]!.id });
    const html = await (await t.get(base, cookie)).text();
    expect(html).toContain('Delta');
  });

  it('validates manual picks', async () => {
    const dup = await t.post(`${base}/cruces`, { sf1_a: String(teams[0]!.id), sf1_b: String(teams[0]!.id), sf2_a: String(teams[1]!.id), sf2_b: String(teams[2]!.id) }, cookie);
    expect(await flashText(t, dup, cookie)).toContain('distintos');
    const partial = await t.post(`${base}/cruces`, { sf1_a: String(teams[0]!.id), sf1_b: '', sf2_a: '', sf2_b: '' }, cookie);
    expect(await flashText(t, partial, cookie)).toContain('Elige los cuatro equipos o deja los cuatro vacíos');
  });

  it('emits a change event after recording a playoff result', async () => {
    playGroup();
    let fired = 0;
    t.events.onTournamentChanged(tournament.id, () => fired++);
    await t.post(`${base}/semifinal/1`, form(teams[0]!.id), cookie);
    expect(fired).toBe(1);
  });
});
