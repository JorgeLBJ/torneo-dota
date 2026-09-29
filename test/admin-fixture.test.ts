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
  base = `/admin/t/${tournament.id}/fixture`;
  teams = Array.from({ length: 7 }, (_, i) =>
    t.repo.createTeam(tournament.id, { code: String.fromCharCode(65 + i), name: `Team ${String.fromCharCode(65 + i)}` }),
  );
  t.repo.replaceScheduleDays(tournament.id, [
    { date: '2026-10-03', phase: 'group', startTimes: ['14:00', '15:00', '16:00', '17:00'], slotMinutes: 60 },
    { date: '2026-10-10', phase: 'group', startTimes: ['14:00', '15:00', '16:00'], slotMinutes: 60 },
  ]);
});
afterEach(() => t.db.close());

const generate = () => regenerateFixture(t.repo, tournament);

describe('fixture screen', () => {
  it('summarizes the team count before a fixture exists', async () => {
    const html = await (await t.get(base, cookie)).text();
    expect(html).toContain('7 equipos → 7 rondas · 21 partidos · 1 descansa por ronda');
    expect(html).toContain('Regenerar');
    expect(html).toContain('Agregar ronda');
    expect(html).toContain('Agregar partida de desempate');
  });

  it('regenerates and schedules from the calendar', async () => {
    const res = await t.post(`${base}/regenerar`, {}, cookie);
    expect(res.status).toBe(303);
    expect(await flashText(t, res, cookie)).toContain('Fixture generado: 7 rondas, 21 partidos');
    const html = await (await t.get(base, cookie)).text();
    expect(html).toContain('Ronda 1');
    expect(html).toContain('Ronda 7');
    expect(html).toContain('Descansa');
    expect(html).toContain('03/10/2026 14:00:00');
    expect(html).not.toMatch(/03 oct/);
    expect(t.repo.listMatches(tournament.id, 'group')).toHaveLength(21);
  });

  it('asks for confirmation before overwriting when results exist', async () => {
    generate();
    const match = t.repo.listMatches(tournament.id, 'group')[0]!;
    t.repo.recordResult(match.id, {
      winnerId: match.team1Id!, team1Kills: 1, team1Deaths: 1, team2Kills: 1, team2Deaths: 1,
    });
    const refused = await t.post(`${base}/regenerar`, {}, cookie);
    expect(await flashText(t, refused, cookie)).toContain('confirma');
    expect(t.repo.hasResults(tournament.id)).toBe(true);
    const page = await (await t.get(base, cookie)).text();
    expect(page).toContain('name="confirm"');
    await t.post(`${base}/regenerar`, { confirm: 'yes' }, cookie);
    expect(t.repo.hasResults(tournament.id)).toBe(false);
  });

  it('reports a Spanish error when the fixture cannot be generated', async () => {
    t.repo.replaceScheduleDays(tournament.id, [
      { date: '2026-10-03', phase: 'group', startTimes: ['14:00'], slotMinutes: 60 },
    ]);
    const res = await t.post(`${base}/regenerar`, {}, cookie);
    expect(res.status).toBe(303);
    expect(await flashText(t, res, cookie)).toContain('No hay suficientes horarios');
    expect(t.repo.listMatches(tournament.id)).toHaveLength(0);
  });

  it('emits a change event when the fixture is regenerated', async () => {
    let fired = 0;
    t.events.onTournamentChanged(tournament.id, () => fired++);
    await t.post(`${base}/regenerar`, {}, cookie);
    expect(fired).toBe(1);
  });
});

describe('match editing', () => {
  it('shows the edit form with the current values', async () => {
    generate();
    const m = t.repo.listMatches(tournament.id, 'group')[0]!;
    const html = await (await t.get(`${base}/partidos/${m.id}`, cookie)).text();
    expect(html).toContain('Editar partido');
    expect(html).toContain('value="2026-10-03"');
    expect(html).toContain('value="14:00"');
  });

  it('updates round, schedule and teams', async () => {
    generate();
    const m = t.repo.listMatches(tournament.id, 'group')[0]!;
    const [a, b] = [teams[5]!, teams[6]!];
    const res = await t.post(
      `${base}/partidos/${m.id}`,
      { round: '2', date: '2026-10-05', start_time: '18:00', end_time: '19:00', team1: String(a.id), team2: String(b.id) },
      cookie,
    );
    expect(res.status).toBe(303);
    expect(t.repo.getMatch(m.id)).toMatchObject({
      round: 2, scheduledDate: '2026-10-05', startTime: '18:00', endTime: '19:00', team1Id: a.id, team2Id: b.id,
    });
  });

  it('defaults the end time to one hour after the start', async () => {
    generate();
    const m = t.repo.listMatches(tournament.id, 'group')[0]!;
    await t.post(`${base}/partidos/${m.id}`, { round: '1', date: '2026-10-05', start_time: '18:30', end_time: '', team1: '', team2: '' }, cookie);
    expect(t.repo.getMatch(m.id)).toMatchObject({ startTime: '18:30', endTime: '19:30', team1Id: null });
  });

  it('validates the form in Spanish', async () => {
    generate();
    const m = t.repo.listMatches(tournament.id, 'group')[0]!;
    const ok = { round: '1', date: '2026-10-05', start_time: '18:00', end_time: '19:00', team1: String(teams[0]!.id), team2: String(teams[1]!.id) };
    const cases: [Record<string, string>, string][] = [
      [{ ...ok, round: '0' }, 'ronda'],
      [{ ...ok, date: '2026-99-99' }, 'fecha'],
      [{ ...ok, start_time: '99:00' }, 'hora'],
      [{ ...ok, round: '1000' }, 'ronda'],
      [{ ...ok, start_time: '', end_time: '' }, 'hora de inicio'],
      [{ ...ok, start_time: '18:00', end_time: '17:00' }, 'posterior'],
      [{ ...ok, start_time: '18:00', end_time: '18:00' }, 'posterior'],
      [{ ...ok, team2: ok.team1 }, 'distintos'],
      [{ ...ok, team1: '99999' }, 'equipo'],
    ];
    for (const [form, message] of cases) {
      const res = await t.post(`${base}/partidos/${m.id}`, form, cookie);
      expect(await flashText(t, res, cookie)).toContain(message);
    }
  });

  it('warns when changing teams discards a result', async () => {
    generate();
    const m = t.repo.listMatches(tournament.id, 'group')[0]!;
    t.repo.recordResult(m.id, { winnerId: m.team1Id!, team1Kills: 1, team1Deaths: 1, team2Kills: 1, team2Deaths: 1 });
    const other = teams.find((x) => x.id !== m.team1Id && x.id !== m.team2Id)!;
    const res = await t.post(
      `${base}/partidos/${m.id}`,
      { round: '1', date: '2026-10-03', start_time: '14:00', end_time: '15:00', team1: String(m.team1Id), team2: String(other.id) },
      cookie,
    );
    expect(await flashText(t, res, cookie)).toContain('resultado');
    expect(t.repo.getMatch(m.id)!.winnerId).toBeNull();
  });

  it('deletes a match without result but refuses one with result', async () => {
    generate();
    const [first, second] = t.repo.listMatches(tournament.id, 'group') as unknown as [{ id: number; team1Id: number }, { id: number }];
    t.repo.recordResult(first.id, { winnerId: first.team1Id, team1Kills: 1, team1Deaths: 1, team2Kills: 1, team2Deaths: 1 });
    const refused = await t.post(`${base}/partidos/${first.id}/eliminar`, {}, cookie);
    expect(await flashText(t, refused, cookie)).toContain('resultado');
    expect(t.repo.getMatch(first.id)).toBeDefined();
    await t.post(`${base}/partidos/${second.id}/eliminar`, {}, cookie);
    expect(t.repo.getMatch(second.id)).toBeUndefined();
    expect(t.repo.listMatches(tournament.id, 'group').map((m) => m.matchNumber)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  it('cannot reach matches of another tournament', async () => {
    const other = t.repo.createTournament({ name: 'Otro', slug: 'otro' });
    const foreign = t.repo.createMatch({ tournamentId: other.id, phase: 'group', round: 1, matchNumber: 1 });
    expect((await t.get(`${base}/partidos/${foreign.id}`, cookie)).status).toBe(404);
    expect((await t.post(`${base}/partidos/${foreign.id}/eliminar`, {}, cookie)).status).toBe(404);
  });

  it('adds a match to a round, a new round and a tiebreak match, then opens the editor', async () => {
    generate();
    const before = t.repo.listMatches(tournament.id, 'group').length;
    const inRound = await t.post(`${base}/rondas/1/partido`, {}, cookie);
    expect(inRound.status).toBe(303);
    expect(inRound.headers.get('location')).toMatch(new RegExp(`${base}/partidos/\\d+$`));
    expect(t.repo.listMatches(tournament.id, 'group')).toHaveLength(before + 1);

    const round = await t.post(`${base}/rondas`, {}, cookie);
    expect(round.status).toBe(303);
    expect(t.repo.maxRound(tournament.id, 'group')).toBe(8);

    const tiebreak = await t.post(`${base}/desempate`, {}, cookie);
    expect(tiebreak.status).toBe(303);
    expect(t.repo.maxRound(tournament.id, 'group')).toBe(9);
  });

  it('pre-fills the tiebreak match with the teams tied at the cutoff', async () => {
    t.repo.updateTournament(tournament.id, { qualifiers: 1 });
    for (const team of teams.slice(3)) t.repo.deleteTeam(team.id);
    generate();
    const [a, b, c] = teams as [Team, Team, Team];
    const cycle: [number, number][] = [[a.id, b.id], [b.id, c.id], [c.id, a.id]];
    t.repo.listMatches(tournament.id, 'group').forEach((m, i) => {
      const [winner, loser] = cycle[i]!;
      t.repo.updateMatchTeams(m.id, winner, loser);
      t.repo.recordResult(m.id, { winnerId: winner, team1Kills: 10, team1Deaths: 10, team2Kills: 10, team2Deaths: 10 });
    });
    const res = await t.post(`${base}/desempate`, {}, cookie);
    const created = t.repo.getMatch(Number(res.headers.get('location')!.split('/').pop()))!;
    expect([created.team1Id, created.team2Id]).toEqual([a.id, b.id]);
  });

  it('does not create a match for a round number that is out of range', async () => {
    generate();
    const before = t.repo.listMatches(tournament.id, 'group').length;
    expect((await t.post(`${base}/rondas/1000/partido`, {}, cookie)).status).toBe(404);
    expect((await t.post(`${base}/rondas/99999999999/partido`, {}, cookie)).status).toBe(404);
    expect(t.repo.listMatches(tournament.id, 'group')).toHaveLength(before);
  });
});
