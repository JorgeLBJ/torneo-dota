import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/open.js';
import { createRepository, type Repository, type Team, type Tournament } from '../src/db/repository.js';
import { buildPublicModel, formatDayList } from '../src/public/model.js';
import { regenerateFixture } from '../src/services/fixture.js';
import { recordPlayoffResult } from '../src/services/playoffs.js';
import { loadState } from '../src/services/state.js';

let db: Database.Database;
let repo: Repository;
let tournament: Tournament;
let teams: Team[];

const current = () => repo.getTournamentById(tournament.id)!;
// A fixed clock before the first match (2026-10-03T19:00Z) so "next" never depends on today's date.
const BEFORE = new Date('2026-09-30T12:00:00Z');
const model = (now: Date = BEFORE) => buildPublicModel(loadState(repo, current()), repo.listScheduleDays(tournament.id), { now });

const win = (matchId: number, winnerId: number, k1 = 20, d1 = 10, k2 = 10, d2 = 20) =>
  repo.recordResult(matchId, { winnerId, team1Kills: k1, team1Deaths: d1, team2Kills: k2, team2Deaths: d2 });

/** Every group match won by its first team, with distinct kill counts so the standings are fully ordered. */
const finishGroups = () => {
  for (const match of repo.listMatches(tournament.id, 'group')) win(match.id, match.team1Id!, 20 + match.matchNumber, 10, 10, 20);
};

const playoff = (phase: 'semifinal' | 'final', number: number, winnerId: number) => {
  const result = recordPlayoffResult(repo, current(), loadState(repo, current()), phase, number, {
    winner: String(winnerId),
    t1Kills: '10',
    t1Deaths: '5',
    t2Kills: '5',
    t2Deaths: '10',
  });
  expect(result.ok).toBe(true);
};

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = createRepository(db);
  tournament = repo.createTournament({ name: 'Torneo Oct', slug: 'torneo-oct' });
  teams = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((code) =>
    repo.createTeam(tournament.id, { code, name: `Equipo ${code}`, hero: code === 'A' ? 'axe' : null }),
  );
  repo.replaceScheduleDays(tournament.id, [
    { date: '2026-10-03', phase: 'group', startTimes: ['14:00', '15:00', '16:00', '17:00'], slotMinutes: 60 },
    { date: '2026-10-10', phase: 'group', startTimes: ['14:00', '15:00', '16:00'], slotMinutes: 60 },
    { date: '2026-10-11', phase: 'semifinal', startTimes: ['14:00', '15:00'], slotMinutes: 60 },
    { date: '2026-10-17', phase: 'final', startTimes: ['14:00'], slotMinutes: 60 },
  ]);
  regenerateFixture(repo, tournament);
});
afterEach(() => db.close());

describe('formatDayList', () => {
  it('joins days of one month and keeps months apart', () => {
    expect(formatDayList(['2026-10-03'])).toBe('03 Oct');
    expect(formatDayList(['2026-10-03', '2026-10-10'])).toBe('03 y 10 Oct');
    expect(formatDayList(['2026-10-03', '2026-10-10', '2026-10-17'])).toBe('03, 10 y 17 Oct');
    expect(formatDayList(['2026-09-30', '2026-10-03'])).toBe('30 Sep y 03 Oct');
    expect(formatDayList([])).toBe('Por definir');
  });
});

describe('matches by day and round', () => {
  it('groups by date, then round, with the bye team and the next round flagged', () => {
    const m = model();
    expect(m.days.map((d) => d.date)).toEqual(['2026-10-03', '2026-10-10']);
    expect(m.days[0]!.label).toMatch(/^sábado,? 0?3 de octubre$/);
    expect(m.days[0]!.rounds.map((r) => r.number)).toEqual([1, 2, 3, 4]);
    const round1 = m.days[0]!.rounds[0]!;
    expect(round1).toMatchObject({ startTime: '14:00', endTime: '15:00', status: 'next' });
    expect(round1.matches).toHaveLength(3);
    const playing = new Set(round1.matches.flatMap((match) => [match.teamA!.id, match.teamB!.id]));
    expect(teams.filter((t) => !playing.has(t.id)).map((t) => t.id)).toEqual([round1.bye!.id]);
    expect(round1.matches[0]).toMatchObject({ number: 1, played: false, isNext: true });
    expect(m.days[0]!.rounds[1]!.status).toBe('pending');
  });

  it('marks played rounds as done, advances "next" and exposes the winner and K/D', () => {
    const group = repo.listMatches(tournament.id, 'group');
    for (const match of group.slice(0, 3)) win(match.id, match.team1Id!, 25, 12, 12, 25);
    const m = model();
    const round1 = m.days[0]!.rounds[0]!;
    expect(round1.status).toBe('done');
    expect(m.days[0]!.rounds[1]!.status).toBe('next');
    expect(round1.matches[0]).toMatchObject({ played: true, winnerId: group[0]!.team1Id, kills: [25, 12], deaths: [12, 25] });
    expect(m.progress).toEqual({ played: 3, total: 21, percent: 14 });
  });

  it('gives a round with several free teams no bye and lists unscheduled matches under "Sin fecha"', () => {
    repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: 8, matchNumber: 22, team1Id: teams[0]!.id, team2Id: teams[1]!.id });
    const m = model();
    const last = m.days[m.days.length - 1]!;
    expect(last).toMatchObject({ date: null, label: 'Sin fecha' });
    expect(last.rounds[0]!.bye).toBeNull();
  });
});

describe('real instants: live and next rounds', () => {
  const round = (m: ReturnType<typeof model>, n: number) => m.days.flatMap((d) => d.rounds).find((r) => r.number === n)!;

  it('exposes UTC instants for rounds, matches and the time zone', () => {
    const m = model();
    expect(m.timezone).toBe('America/Lima');
    expect(round(m, 1)).toMatchObject({ startsAt: '2026-10-03T19:00:00Z', endsAt: '2026-10-03T20:00:00Z' });
    expect(round(m, 1).matches[0]).toMatchObject({ startsAt: '2026-10-03T19:00:00Z' });
    expect(m.bracket.semifinals[0]!.startsAt).toBe('2026-10-11T19:00:00Z');
    expect(m.bracket.final.startsAt).toBe('2026-10-17T19:00:00Z');
  });

  it('marks the round in progress as live and the following one as next', () => {
    const m = model(new Date('2026-10-03T19:30:00Z'));
    expect(round(m, 1).status).toBe('live');
    expect(round(m, 2).status).toBe('next');
    expect(round(m, 3).status).toBe('pending');
    expect(round(m, 1).matches.every((x) => !x.isNext)).toBe(true);
    expect(round(m, 2).matches.every((x) => x.isNext)).toBe(true);
  });

  it('picks the next round by start instant, not by round number', () => {
    const [first, second] = repo.listMatches(tournament.id, 'group').filter((x) => x.round <= 2);
    // Swap the slots of round 1 and round 2: round 2 now starts first.
    repo.updateMatchSchedule(first!.id, { scheduledDate: '2026-10-03', startTime: '18:00', endTime: '19:00' });
    for (const x of repo.listMatches(tournament.id, 'group').filter((y) => y.round === 2)) {
      repo.updateMatchSchedule(x.id, { scheduledDate: '2026-10-03', startTime: '13:00', endTime: '14:00' });
    }
    expect(second).toBeDefined();
    const m = model(new Date('2026-10-03T12:00:00Z'));
    expect(round(m, 2).status).toBe('next');
  });

  it('does not call a past round without results "next": it waits for its result', () => {
    const m = model(new Date('2026-10-03T23:30:00Z'));
    expect(round(m, 4).status).toBe('pending');
    expect(round(m, 5).status).toBe('next');
  });

  it('is not live once every match of the round has a result', () => {
    for (const x of repo.listMatches(tournament.id, 'group').filter((y) => y.round === 1)) win(x.id, x.team1Id!);
    expect(round(model(new Date('2026-10-03T19:30:00Z')), 1).status).toBe('done');
  });
});

describe('standings', () => {
  it('reports the cut line at the qualifiers, and no status while groups are open', () => {
    const [first] = repo.listMatches(tournament.id, 'group');
    win(first!.id, first!.team1Id!);
    const rows = model().standings;
    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.qualifies)).toEqual([true, true, true, true, false, false, false]);
    expect(rows.filter((r) => r.cutLine).map((r) => r.position)).toEqual([4]);
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(['pending']));
    expect(rows[0]).toMatchObject({ points: 1, wins: 1, played: 1, diff: 10 });
  });

  it('labels qualified and eliminated teams once the group stage is complete', () => {
    finishGroups();
    const rows = model().standings;
    expect(rows.slice(0, 4).every((r) => r.status === 'qualified')).toBe(true);
    expect(rows.slice(4).every((r) => r.status === 'eliminated')).toBe(true);
  });

  it('carries the team hero for display', () => {
    const rows = model().standings;
    expect(rows.find((r) => r.team.code === 'A')!.team.hero).toBe('axe');
    expect(rows.find((r) => r.team.code === 'B')!.team.hero).toBeNull();
  });
});

describe('phases and bracket', () => {
  it('shows the calendar dates per phase and highlights the current one', () => {
    const phases = model().phases;
    expect(phases.map((p) => [p.key, p.dates, p.current])).toEqual([
      ['group', '03 y 10 Oct', true],
      ['semifinal', '11 Oct', false],
      ['final', '17 Oct', false],
    ]);
  });

  it('projects nothing before any result, then the top four while groups are open', () => {
    expect(model().bracket.projection).toBe(true);
    expect(model().bracket.semifinals[0]!.slots.map((s) => s.team)).toEqual([null, null]);
    const [first] = repo.listMatches(tournament.id, 'group');
    win(first!.id, first!.team1Id!);
    const m = model();
    expect(m.bracket.note).toBe('Proyección con la tabla actual · faltan 20 partidos de fase de grupos');
    const sf1 = m.bracket.semifinals[0]!;
    expect(sf1.title).toBe('Semifinal 1');
    expect(sf1.when).toBe('11 Oct · 14:00');
    expect(sf1.slots[0]!.team?.id).toBe(m.standings[0]!.team.id);
    expect(sf1.slots[0]!.seedLabel).toBe('1.º de grupos');
    expect(sf1.slots[1]!.team?.id).toBe(m.standings[3]!.team.id);
    expect(m.bracket.semifinals[1]!.slots[0]!.team?.id).toBe(m.standings[1]!.team.id);
    expect(m.bracket.final.when).toBe('17 Oct · 14:00');
    expect(m.bracket.final.slots.map((s) => s.seedLabel)).toEqual(['Ganador SF1', 'Ganador SF2']);
    expect(m.bracket.champion).toBeNull();
  });

  it('confirms the bracket, follows the winners and crowns the champion', () => {
    finishGroups();
    let m = model();
    expect(m.bracket.note).toBe('Cruces confirmados');
    expect(m.bracket.projection).toBe(false);
    const sf1Winner = m.bracket.semifinals[0]!.slots[0]!.team!.id;
    const sf2Winner = m.bracket.semifinals[1]!.slots[0]!.team!.id;

    playoff('semifinal', 1, sf1Winner);
    m = model();
    expect(m.bracket.semifinals[0]!.slots[0]!.isWinner).toBe(true);
    expect(m.bracket.final.slots[0]!.team?.id).toBe(sf1Winner);
    expect(m.phases.find((p) => p.current)!.key).toBe('semifinal');

    playoff('semifinal', 2, sf2Winner);
    expect(model().phases.find((p) => p.current)!.key).toBe('final');

    playoff('final', 1, sf1Winner);
    m = model();
    expect(m.bracket.champion?.id).toBe(sf1Winner);
    expect(m.phases.find((p) => p.current)!.key).toBe('final');
  });
});

describe('rules', () => {
  it('summarizes points, qualifiers and tiebreakers from the tournament configuration', () => {
    repo.updateTournament(tournament.id, { pointsWin: 3, pointsLoss: 1, tiebreakers: ['kills', 'kd'], rulesText: '## Generales\n- Cinco jugadores' });
    const r = model().rules;
    expect(r.summary).toEqual([
      { label: 'Victoria', value: '3 pts' },
      { label: 'Derrota', value: '1 pt' },
      { label: 'Clasifican', value: 'Top 4' },
      { label: 'Semis', value: '1.º vs 4.º · 2.º vs 3.º' },
    ]);
    expect(r.tiebreakers).toEqual(['Mayor cantidad de kills', 'Diferencia de kills y deaths (K − D)']);
    expect(r.legendTiebreak).toBe('kills, luego K−D');
    expect(r.blocks).toEqual([{ type: 'heading', text: 'Generales' }, { type: 'list', items: ['Cinco jugadores'] }]);
  });
});
