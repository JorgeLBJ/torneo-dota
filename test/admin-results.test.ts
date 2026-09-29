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
  base = `/admin/t/${tournament.id}/resultados`;
  teams = Array.from({ length: 5 }, (_, i) =>
    t.repo.createTeam(tournament.id, { code: String.fromCharCode(65 + i), name: `Team ${String.fromCharCode(65 + i)}` }),
  );
  t.repo.replaceScheduleDays(tournament.id, [
    { date: '2026-10-03', phase: 'group', startTimes: ['14:00', '15:00', '16:00'], slotMinutes: 60 },
    { date: '2026-10-10', phase: 'group', startTimes: ['14:00', '15:00'], slotMinutes: 60 },
  ]);
  regenerateFixture(t.repo, tournament);
});
afterEach(() => t.db.close());

const firstMatch = () => t.repo.listMatches(tournament.id, 'group')[0]!;
const win = (m: { team1Id: number | null }, extra: Record<string, string> = {}) => ({
  action: 'save',
  winner: String(m.team1Id),
  t1_kills: '22',
  t1_deaths: '10',
  t2_kills: '10',
  t2_deaths: '22',
  ...extra,
});

describe('results screen', () => {
  it('shows a card per match of the selected date and a date filter', async () => {
    const html = await (await t.get(`${base}?fecha=2026-10-03`, cookie)).text();
    expect(html).toContain('Resultados');
    expect(html).toContain('Pendiente');
    expect(html).toContain('Tabla en vivo');
    expect(html).toContain('type="radio"');
    expect(html).toContain('Sáb 03 oct');
    expect(html).toContain('Sáb 10 oct');
    // 5 teams -> 2 matches per round, 3 rounds on Oct 3.
    expect(html.match(/class="rc /g)).toHaveLength(6);
    const all = await (await t.get(`${base}?fecha=todos`, cookie)).text();
    expect(all.match(/class="rc /g)).toHaveLength(10);
  });

  it('defaults to the first date that still has pending matches', async () => {
    for (const m of t.repo.listMatches(tournament.id, 'group').filter((x) => x.scheduledDate === '2026-10-03')) {
      t.repo.recordResult(m.id, { winnerId: m.team1Id!, team1Kills: 1, team1Deaths: 1, team2Kills: 1, team2Deaths: 1 });
    }
    const html = await (await t.get(base, cookie)).text();
    expect(html.match(/class="rc /g)).toHaveLength(4);
  });

  it('saves a result, redirects to the same filter and emits a change event', async () => {
    let fired = 0;
    t.events.onTournamentChanged(tournament.id, () => fired++);
    const m = firstMatch();
    const res = await t.post(`${base}/${m.id}`, win(m, { fecha: '2026-10-03' }), cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${base}?fecha=2026-10-03`);
    expect(t.repo.getMatch(m.id)).toMatchObject({
      winnerId: m.team1Id, team1Kills: 22, team1Deaths: 10, team2Kills: 10, team2Deaths: 22,
    });
    expect(fired).toBe(1);
    const html = await (await t.get(`${base}?fecha=2026-10-03`, cookie)).text();
    expect(html).toContain('Guardado');
    expect(html).toContain('checked');
  });

  it('updates an existing result', async () => {
    const m = firstMatch();
    await t.post(`${base}/${m.id}`, win(m), cookie);
    await t.post(`${base}/${m.id}`, { ...win(m), winner: String(m.team2Id), t1_kills: '5' }, cookie);
    expect(t.repo.getMatch(m.id)).toMatchObject({ winnerId: m.team2Id, team1Kills: 5 });
  });

  it('rejects invalid results with Spanish messages and stores nothing', async () => {
    const m = firstMatch();
    const cases: [Record<string, string>, string][] = [
      [win(m, { winner: '' }), 'ganador'],
      [win(m, { winner: '99999' }), 'ganador'],
      [win(m, { t1_kills: '' }), 'kills'],
      [win(m, { t2_deaths: 'abc' }), 'kills'],
      [win(m, { t1_kills: '-3' }), 'kills'],
    ];
    for (const [form, message] of cases) {
      const res = await t.post(`${base}/${m.id}`, form, cookie);
      expect(res.status).toBe(303);
      expect(await flashText(t, res, cookie)).toContain(message);
    }
    expect(t.repo.getMatch(m.id)!.winnerId).toBeNull();
  });

  it('refuses results for a match without both teams', async () => {
    const blank = t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: 1, matchNumber: 99 });
    const res = await t.post(`${base}/${blank.id}`, win({ team1Id: teams[0]!.id }), cookie);
    expect(await flashText(t, res, cookie)).toContain('equipos');
  });

  it('clears a result', async () => {
    const m = firstMatch();
    await t.post(`${base}/${m.id}`, win(m), cookie);
    const res = await t.post(`${base}/${m.id}`, { action: 'clear', fecha: 'todos' }, cookie);
    expect(res.status).toBe(303);
    expect(t.repo.getMatch(m.id)).toMatchObject({ winnerId: null, team1Kills: null });
  });

  it('cannot save results for matches of another tournament', async () => {
    const other = t.repo.createTournament({ name: 'Otro', slug: 'otro' });
    const a = t.repo.createTeam(other.id, { code: 'A', name: 'A' });
    const b = t.repo.createTeam(other.id, { code: 'B', name: 'B' });
    const foreign = t.repo.createMatch({ tournamentId: other.id, phase: 'group', round: 1, matchNumber: 1, team1Id: a.id, team2Id: b.id });
    const res = await t.post(`${base}/${foreign.id}`, win({ team1Id: a.id }), cookie);
    expect(res.status).toBe(404);
  });

  it('shows the live standings with a cut line after the qualifiers', async () => {
    const m = firstMatch();
    await t.post(`${base}/${m.id}`, win(m), cookie);
    const html = await (await t.get(base, cookie)).text();
    expect(html).toContain('<tr class="cut">');
    expect(html).toContain('K−D');
    expect(html).toContain('+12');
    expect(html).toContain('La línea dorada marca el corte de clasificación (top 4)');
  });

  it('applies the configured points to the live table', async () => {
    t.repo.updateTournament(tournament.id, { pointsWin: 3 });
    const m = firstMatch();
    await t.post(`${base}/${m.id}`, win(m), cookie);
    const html = await (await t.get(base, cookie)).text();
    expect(html).toContain('<b>3</b>');
  });
});
