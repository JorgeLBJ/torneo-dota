import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/open.js';
import { createRepository, type Repository, type Tournament } from '../src/db/repository.js';
import { describeRoundRobin } from '../src/domain/fixture.js';
import {
  FixtureError,
  addBlankMatch,
  addRound,
  editMatch,
  regenerateFixture,
  tiedTeamIds,
} from '../src/services/fixture.js';
import {
  assignSemifinalTeams,
  clearPlayoffResult,
  ensurePlayoffMatches,
  recordPlayoffResult,
} from '../src/services/playoffs.js';
import { validateResult } from '../src/services/results.js';
import { loadState } from '../src/services/state.js';

let db: Database.Database;
let repo: Repository;
let tournament: Tournament;

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = createRepository(db);
  tournament = repo.createTournament({ name: 'Cup', slug: 'cup' });
  // These tests are about the bracket, not about series: playoffs are single games here.
  tournament = repo.updateTournament(tournament.id, { semifinalGames: 1, finalGames: 1 });
});
afterEach(() => db.close());

const addTeams = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    repo.createTeam(tournament.id, { code: String.fromCharCode(65 + i), name: `Team ${i + 1}` }),
  );

const calendar = () =>
  repo.replaceScheduleDays(tournament.id, [
    { date: '2026-10-03', phase: 'group', startTimes: ['14:00', '15:00', '16:00', '17:00'], slotMinutes: 60 },
    { date: '2026-10-10', phase: 'group', startTimes: ['14:00', '15:00', '16:00'], slotMinutes: 60 },
    { date: '2026-10-11', phase: 'semifinal', startTimes: ['14:00', '15:00'], slotMinutes: 60 },
    { date: '2026-10-17', phase: 'final', startTimes: ['14:00'], slotMinutes: 60 },
  ]);

describe('describeRoundRobin', () => {
  it('matches the mockup reference table', () => {
    expect(describeRoundRobin(7, 1)).toEqual({ rounds: 7, matches: 21, byesPerRound: 1 });
    expect(describeRoundRobin(6, 1)).toEqual({ rounds: 5, matches: 15, byesPerRound: 0 });
    expect(describeRoundRobin(8, 1).rounds).toBe(7);
    expect(describeRoundRobin(10, 1).rounds).toBe(9);
    expect(describeRoundRobin(6, 2)).toEqual({ rounds: 10, matches: 30, byesPerRound: 0 });
    expect(describeRoundRobin(1, 1)).toEqual({ rounds: 0, matches: 0, byesPerRound: 0 });
  });
});

describe('regenerateFixture', () => {
  it('generates the 7-team fixture and schedules it on the calendar', () => {
    addTeams(7);
    calendar();
    const result = regenerateFixture(repo, tournament);
    expect(result).toEqual({ rounds: 7, matches: 21, scheduled: true });
    const matches = repo.listMatches(tournament.id, 'group');
    expect(matches).toHaveLength(21);
    expect(matches.map((m) => m.matchNumber)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    expect(matches[0]).toMatchObject({ round: 1, scheduledDate: '2026-10-03', startTime: '14:00', endTime: '15:00' });
    expect(matches.at(-1)).toMatchObject({ round: 7, scheduledDate: '2026-10-10', startTime: '16:00' });
  });

  it('uses two legs from the rules', () => {
    addTeams(4);
    repo.updateTournament(tournament.id, { groupLegs: 2 });
    const t = repo.getTournamentById(tournament.id)!;
    expect(regenerateFixture(repo, t)).toEqual({ rounds: 6, matches: 12, scheduled: false });
  });

  it('generates without dates when the calendar has no group days', () => {
    addTeams(3);
    const result = regenerateFixture(repo, tournament);
    expect(result.scheduled).toBe(false);
    expect(repo.listMatches(tournament.id, 'group')[0]).toMatchObject({ scheduledDate: null, startTime: null });
  });

  it('fails in Spanish and changes nothing when slots are insufficient or teams are missing', () => {
    expect(() => regenerateFixture(repo, tournament)).toThrow(FixtureError);
    expect(() => regenerateFixture(repo, tournament)).toThrow(/al menos 2 equipos/);
    addTeams(7);
    repo.replaceScheduleDays(tournament.id, [
      { date: '2026-10-03', phase: 'group', startTimes: ['14:00'], slotMinutes: 60 },
    ]);
    expect(() => regenerateFixture(repo, tournament)).toThrow(/No hay suficientes horarios/);
    expect(repo.listMatches(tournament.id)).toHaveLength(0);
  });

  it('replaces existing group matches and discards stale playoff matches', () => {
    const [a, b] = addTeams(2) as unknown as [{ id: number }, { id: number }];
    regenerateFixture(repo, tournament);
    const [m] = repo.listMatches(tournament.id, 'group');
    repo.recordResult(m!.id, { winnerId: a.id, team1Kills: 1, team1Deaths: 1, team2Kills: 1, team2Deaths: 1 });
    repo.insertMatches([{ tournamentId: tournament.id, phase: 'semifinal', round: 1, matchNumber: 1, team1Id: a.id, team2Id: b.id }]);
    regenerateFixture(repo, tournament);
    expect(repo.hasResults(tournament.id)).toBe(false);
    expect(repo.listMatches(tournament.id, 'semifinal')).toHaveLength(0);
  });
});

describe('manual fixture editing', () => {
  it('adds a blank match to a round copying its schedule, then renumbers', () => {
    addTeams(4);
    calendar();
    regenerateFixture(repo, tournament);
    const added = addBlankMatch(repo, tournament.id, 1);
    expect(added).toMatchObject({ round: 1, team1Id: null, scheduledDate: '2026-10-03', startTime: '14:00' });
    const numbers = repo.listMatches(tournament.id, 'group').map((m) => m.matchNumber);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(repo.getMatch(added.id)!.matchNumber).toBe(3);
  });

  it('adds a new round after the last one', () => {
    addTeams(4);
    regenerateFixture(repo, tournament);
    const added = addRound(repo, tournament.id);
    expect(added.round).toBe(4);
    expect(repo.maxRound(tournament.id, 'group')).toBe(4);
    expect(repo.getMatch(added.id)!.matchNumber).toBe(7);
  });

  it('edits a match and clears its result when the teams change', () => {
    const [a, b, c] = addTeams(3) as unknown as [{ id: number }, { id: number }, { id: number }];
    regenerateFixture(repo, tournament);
    const match = repo.listMatches(tournament.id, 'group')[0]!;
    repo.updateMatchTeams(match.id, a.id, b.id);
    repo.recordResult(match.id, { winnerId: a.id, team1Kills: 5, team1Deaths: 1, team2Kills: 1, team2Deaths: 5 });
    const same = editMatch(repo, repo.getMatch(match.id)!, {
      round: 1, scheduledDate: '2026-10-05', startTime: '10:00', endTime: '11:00', team1Id: a.id, team2Id: b.id,
    });
    expect(same.resultCleared).toBe(false);
    expect(same.match.winnerId).toBe(a.id);
    const swapped = editMatch(repo, same.match, {
      round: 1, scheduledDate: '2026-10-05', startTime: '10:00', endTime: '11:00', team1Id: a.id, team2Id: c.id,
    });
    expect(swapped.resultCleared).toBe(true);
    expect(swapped.match).toMatchObject({ winnerId: null, team1Kills: null, team2Id: c.id });
  });

  it('finds the teams tied at the qualification cutoff', () => {
    const [a, b, c] = addTeams(3) as unknown as [{ id: number }, { id: number }, { id: number }];
    repo.updateTournament(tournament.id, { qualifiers: 1 });
    const current = repo.getTournamentById(tournament.id)!;
    regenerateFixture(repo, current);
    // No results yet: everyone tied at zero is not a tiebreak.
    expect(tiedTeamIds(loadState(repo, current).standings)).toBeNull();
    // A beats B, B beats C, C beats A with identical kills: a three-way tie across the cutoff.
    const cycle: [number, number][] = [[a.id, b.id], [b.id, c.id], [c.id, a.id]];
    repo.listMatches(tournament.id, 'group').forEach((m, i) => {
      const [winner, loser] = cycle[i]!;
      repo.updateMatchTeams(m.id, winner, loser);
      repo.recordResult(m.id, { winnerId: winner, team1Kills: 10, team1Deaths: 10, team2Kills: 10, team2Deaths: 10 });
    });
    const state = loadState(repo, current);
    expect(state.groupComplete).toBe(true);
    expect(tiedTeamIds(state.standings)).toEqual([a.id, b.id]);
  });
});

describe('validateResult', () => {
  const raw = { winner: '1', t1Kills: '10', t1Deaths: '5', t2Kills: '5', t2Deaths: '10' };
  it('accepts a complete result', () => {
    expect(validateResult([1, 2], raw)).toEqual({
      ok: true,
      value: { winnerId: 1, team1Kills: 10, team1Deaths: 5, team2Kills: 5, team2Deaths: 10 },
    });
  });
  it('rejects bad winners, missing numbers and undefined teams', () => {
    expect(validateResult([1, 2], { ...raw, winner: '' })).toMatchObject({ ok: false, error: expect.stringContaining('ganador') });
    expect(validateResult([1, 2], { ...raw, winner: '3' })).toMatchObject({ ok: false });
    expect(validateResult([1, 2], { ...raw, t1Kills: '' })).toMatchObject({ ok: false, error: expect.stringContaining('kills') });
    expect(validateResult([1, 2], { ...raw, t2Deaths: '-1' })).toMatchObject({ ok: false });
    expect(validateResult([1, 2], { ...raw, t1Kills: '1000' })).toMatchObject({ ok: false });
    expect(validateResult([1, null], raw)).toMatchObject({ ok: false, error: expect.stringContaining('equipos') });
  });
});

describe('playoff service', () => {
  const finishGroup = () => {
    const teams = addTeams(4);
    regenerateFixture(repo, tournament);
    // Team 1 beats everyone, team 2 beats 3 and 4, team 3 beats 4.
    for (const m of repo.listMatches(tournament.id, 'group')) {
      const winner = Math.min(
        teams.findIndex((t) => t.id === m.team1Id),
        teams.findIndex((t) => t.id === m.team2Id),
      );
      const w = teams[winner]!.id;
      const t1Won = m.team1Id === w;
      repo.recordResult(m.id, {
        winnerId: w,
        team1Kills: t1Won ? 20 : 10,
        team1Deaths: t1Won ? 10 : 20,
        team2Kills: t1Won ? 10 : 20,
        team2Deaths: t1Won ? 20 : 10,
      });
    }
    return teams;
  };

  it('creates the three playoff matches once, scheduled from the calendar', () => {
    addTeams(4);
    calendar();
    ensurePlayoffMatches(repo, tournament);
    ensurePlayoffMatches(repo, tournament);
    const matches = repo.listMatches(tournament.id).filter((m) => m.phase !== 'group');
    expect(matches.map((m) => `${m.phase}${m.matchNumber}`).sort()).toEqual(['final1', 'semifinal1', 'semifinal2']);
    expect(matches.map((m) => `${m.phase}${m.matchNumber} ${m.scheduledDate} ${m.startTime}`).sort()).toEqual([
      'final1 2026-10-17 14:00',
      'semifinal1 2026-10-11 14:00',
      'semifinal2 2026-10-11 15:00',
    ]);
  });

  it('records semifinal and final winners and crowns the champion', () => {
    const teams = finishGroup();
    const [t1, t2, t3, t4] = teams as unknown as [{ id: number }, { id: number }, { id: number }, { id: number }];
    const win = (w: number) => ({ winner: String(w), t1Kills: '10', t1Deaths: '5', t2Kills: '5', t2Deaths: '10' });
    let state = loadState(repo, tournament);
    expect(state.bracket.seeded).toBe(true);
    expect(recordPlayoffResult(repo, tournament, state, 'semifinal', 1, win(t1.id))).toMatchObject({ ok: true });
    state = loadState(repo, tournament);
    expect(recordPlayoffResult(repo, tournament, state, 'semifinal', 2, win(t2.id))).toMatchObject({ ok: true });
    state = loadState(repo, tournament);
    expect(state.bracket.final).toMatchObject({ team1Id: t1.id, team2Id: t2.id });
    expect(recordPlayoffResult(repo, tournament, state, 'final', 1, win(t2.id))).toMatchObject({ ok: true });
    state = loadState(repo, tournament);
    expect(state.bracket.championId).toBe(t2.id);
    void t3; void t4;
  });

  it('rejects a winner outside the match and results for undefined teams', () => {
    const teams = finishGroup();
    const state = loadState(repo, tournament);
    const bad = { winner: String(teams[1]!.id), t1Kills: '1', t1Deaths: '1', t2Kills: '1', t2Deaths: '1' };
    // Semifinal 1 is seed 1 vs seed 4, so seed 2 is not part of it.
    expect(recordPlayoffResult(repo, tournament, state, 'semifinal', 1, bad)).toMatchObject({ ok: false });
    expect(recordPlayoffResult(repo, tournament, state, 'final', 1, bad)).toMatchObject({ ok: false });
  });

  it('assigns semifinal teams manually and drops stale results', () => {
    const teams = finishGroup();
    const ids = teams.map((t) => t.id) as [number, number, number, number];
    let state = loadState(repo, tournament);
    recordPlayoffResult(repo, tournament, state, 'semifinal', 1, {
      winner: String(ids[0]), t1Kills: '1', t1Deaths: '0', t2Kills: '0', t2Deaths: '1',
    });
    expect(assignSemifinalTeams(repo, tournament, [ids[0], ids[1], ids[2], ids[3]])).toMatchObject({ ok: true });
    state = loadState(repo, tournament);
    expect(state.bracket.semifinals[0]).toMatchObject({ team1Id: ids[0], team2Id: ids[1], winnerId: null });
    expect(state.bracket.semifinals[1]).toMatchObject({ team1Id: ids[2], team2Id: ids[3] });
    expect(assignSemifinalTeams(repo, tournament, [ids[0], ids[0], ids[2], ids[3]])).toMatchObject({ ok: false });
    expect(assignSemifinalTeams(repo, tournament, [ids[0], ids[1], ids[2], 9999])).toMatchObject({ ok: false });
  });

  it('clearing a semifinal result also clears the final', () => {
    const teams = finishGroup();
    const win = (w: number) => ({ winner: String(w), t1Kills: '10', t1Deaths: '5', t2Kills: '5', t2Deaths: '10' });
    let state = loadState(repo, tournament);
    recordPlayoffResult(repo, tournament, state, 'semifinal', 1, win(teams[0]!.id));
    state = loadState(repo, tournament);
    recordPlayoffResult(repo, tournament, state, 'semifinal', 2, win(teams[1]!.id));
    state = loadState(repo, tournament);
    recordPlayoffResult(repo, tournament, state, 'final', 1, win(teams[0]!.id));
    clearPlayoffResult(repo, tournament, 'semifinal', 1);
    state = loadState(repo, tournament);
    expect(state.bracket.semifinals[0].winnerId).toBeNull();
    expect(state.bracket.championId).toBeNull();
    expect(repo.listMatches(tournament.id, 'final')[0]!.winnerId).toBeNull();
  });
});
