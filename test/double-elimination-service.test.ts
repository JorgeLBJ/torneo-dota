import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Team, Tournament } from '../src/db/repository.js';
import { DE_SLOTS, type DeSlotKey } from '../src/domain/double-elimination.js';
import {
  assignPositions,
  clearBracketSeries,
  deleteBracketGame,
  ensureBracketMatches,
  markBracketLive,
  recordBracketResult,
  resetBracket,
} from '../src/services/double-elimination.js';
import { loadState } from '../src/services/state.js';
import { makeApp, type TestApp } from './helpers/app.js';

let t: TestApp;
let tournament: Tournament;
let teams: Team[];
const NOW = new Date('2026-11-07T16:00:00Z');

beforeEach(async () => {
  t = await makeApp();
  tournament = t.repo.createTournament({ name: 'Relámpago', slug: 'relampago', format: 'double_elimination' });
  teams = ['Alpha', 'Bravo', 'Corsarios', 'Delta', 'Eclipse', 'Fénix'].map((name, i) =>
    t.repo.createTeam(tournament.id, { code: String.fromCharCode(65 + i), name }),
  );
});
afterEach(() => t.db.close());

const team = (i: number) => () => teams[i]!.id;
const [A, B, C, D, E, F] = [team(0), team(1), team(2), team(3), team(4), team(5)] as const;
const ids = () => teams.map((x) => x.id);
const raw = (winner: number) => ({ winner: String(winner), t1Kills: '20', t1Deaths: '10', t2Kills: '10', t2Deaths: '20' });
const bracket = () => loadState(t.repo, tournament).doubleElimination!;
const series = (key: DeSlotKey) => bracket().series.find((s) => s.key === key)!;
const stored = (key: DeSlotKey) => {
  const slot = DE_SLOTS.find((s) => s.key === key)!;
  return t.repo.listMatches(tournament.id, slot.phase).find((m) => m.matchNumber === slot.matchNumber)!;
};
const win = (key: DeSlotKey, winner: number, gameNumber = 1) => {
  const saved = recordBracketResult(t.repo, tournament, key, raw(winner), { gameNumber });
  if (!saved.ok) throw new Error(saved.error);
};

describe('ensureBracketMatches', () => {
  it('creates the ten series once, with the slot phase, number and round', () => {
    ensureBracketMatches(t.repo, tournament);
    ensureBracketMatches(t.repo, tournament);
    const matches = t.repo.listMatches(tournament.id);
    expect(matches).toHaveLength(10);
    for (const slot of DE_SLOTS) {
      const m = matches.filter((x) => x.phase === slot.phase && x.matchNumber === slot.matchNumber);
      expect(m).toHaveLength(1);
      expect(m[0]!.round).toBe(slot.round);
      expect(m[0]!.scheduledDate).toBeNull();
    }
  });
});

describe('assignPositions', () => {
  it('stores A–F in the position seats', () => {
    expect(assignPositions(t.repo, tournament, ids()).ok).toBe(true);
    expect(stored('U1')).toMatchObject({ team1Id: A(), team2Id: B() });
    expect(stored('U2')).toMatchObject({ team1Id: C(), team2Id: D() });
    expect(stored('U3')).toMatchObject({ team1Id: null, team2Id: E() });
    expect(stored('U4')).toMatchObject({ team1Id: F(), team2Id: null });
    expect(bracket().positions).toEqual({ A: A(), B: B(), C: C(), D: D(), E: E(), F: F() });
  });

  it('needs six distinct teams of this tournament', () => {
    const dup = assignPositions(t.repo, tournament, [A(), A(), C(), D(), E(), F()]);
    expect(dup.ok ? '' : dup.error).toContain('distintos');
    const other = t.repo.createTournament({ name: 'Otro', slug: 'otro' });
    const stranger = t.repo.createTeam(other.id, { code: 'X', name: 'Extraño' });
    const foreign = assignPositions(t.repo, tournament, [A(), B(), C(), D(), E(), stranger.id]);
    expect(foreign.ok ? '' : foreign.error).toContain('equipos de este torneo');
    const short = assignPositions(t.repo, tournament, [A(), B(), C()]);
    expect(short.ok).toBe(false);
    expect(t.repo.listMatches(tournament.id).every((m) => m.team1Id === null && m.team2Id === null)).toBe(true);
  });

  it('a changed position drops that series result and everything that depended on it', () => {
    assignPositions(t.repo, tournament, ids());
    win('U1', A());
    win('U3', A());
    const fresh = t.repo.createTeam(tournament.id, { code: 'G', name: 'Gólem' });
    expect(assignPositions(t.repo, tournament, [fresh.id, B(), C(), D(), E(), F()]).ok).toBe(true);
    expect(stored('U1')).toMatchObject({ team1Id: fresh.id, team2Id: B(), winnerId: null });
    expect(stored('U3')).toMatchObject({ team1Id: null, team2Id: E(), winnerId: null });
    expect(t.repo.listGames(stored('U3').id)).toHaveLength(0);
  });

  it('saving the same positions keeps the results', () => {
    assignPositions(t.repo, tournament, ids());
    win('U1', A());
    assignPositions(t.repo, tournament, ids());
    expect(stored('U1').winnerId).toBe(A());
  });
});

describe('recordBracketResult', () => {
  beforeEach(() => {
    assignPositions(t.repo, tournament, ids());
  });

  it('winners advance and losers drop to the lower bracket (S4)', () => {
    win('U1', A());
    win('U2', D());
    expect(series('U3')).toMatchObject({ team1Id: A(), team2Id: E() });
    expect(series('U4')).toMatchObject({ team1Id: F(), team2Id: D() });
    win('U3', E());
    win('U4', F());
    expect(series('L1')).toMatchObject({ team1Id: B(), team2Id: D() });
    expect(series('L2')).toMatchObject({ team1Id: C(), team2Id: A() });
    expect(series('U5')).toMatchObject({ team1Id: E(), team2Id: F() });
    win('U5', F());
    win('L1', B());
    win('L2', A());
    expect(series('L3')).toMatchObject({ team1Id: B(), team2Id: A() });
    win('L3', A());
    expect(series('L4')).toMatchObject({ team1Id: A(), team2Id: E() });
    win('L4', A());
    expect(series('GF')).toMatchObject({ team1Id: F(), team2Id: A() });
    // Stored teams follow the seats once a result is saved.
    expect(stored('L4')).toMatchObject({ team1Id: A(), team2Id: E(), winnerId: A() });
  });

  it('the grand final is best of 3: one win is not enough, two make the champion', () => {
    for (const [key, winner] of [['U1', A], ['U2', C], ['U3', A], ['U4', F], ['U5', A], ['L1', B], ['L2', E], ['L3', B], ['L4', B]] as const) {
      win(key, winner());
    }
    expect(series('GF')).toMatchObject({ team1Id: A(), team2Id: B() });
    win('GF', B(), 1);
    expect(bracket().championId).toBeNull();
    expect(stored('GF').winnerId).toBeNull();
    win('GF', B(), 2);
    expect(bracket().championId).toBe(B());
    expect(t.repo.listGames(stored('GF').id)).toHaveLength(2);
    // Every other series is a single game.
    const second = recordBracketResult(t.repo, tournament, 'U1', raw(A()), { gameNumber: 2 });
    expect(second.ok).toBe(false);
  });

  it('refuses a series whose seats are not filled yet', () => {
    const early = recordBracketResult(t.repo, tournament, 'U3', raw(E()));
    expect(early.ok ? '' : early.error).toContain('equipos');
    expect(t.repo.listGames(stored('U3').id)).toHaveLength(0);
  });

  it('refuses an unknown series', () => {
    expect(recordBracketResult(t.repo, tournament, 'X9', raw(A())).ok).toBe(false);
  });

  it('changing an upper result clears every later series that depended on it (S6)', () => {
    for (const [key, winner] of [['U1', A], ['U2', C], ['U3', A], ['U4', F], ['U5', A], ['L1', B], ['L2', E], ['L3', B], ['L4', B]] as const) {
      win(key, winner());
    }
    win('GF', A());
    win('GF', A(), 2);
    expect(bracket().championId).toBe(A());
    // U1 now goes to Bravo: U3, U5, L1, L3, L4 and the grand final all depended on it.
    win('U1', B());
    expect(series('U3')).toMatchObject({ team1Id: B(), team2Id: E(), winnerId: null });
    expect(stored('U3')).toMatchObject({ team1Id: B(), team2Id: E(), winnerId: null });
    expect(series('L1')).toMatchObject({ team1Id: A(), team2Id: C(), winnerId: null });
    // L2 took the loser of U3, which is open again.
    expect(stored('L2')).toMatchObject({ team1Id: D(), team2Id: null, winnerId: null });
    for (const key of ['U3', 'U5', 'L1', 'L2', 'L3', 'L4', 'GF'] as const) {
      expect(t.repo.listGames(stored(key).id), key).toHaveLength(0);
    }
    // Independent series keep their results.
    expect(stored('U2').winnerId).toBe(C());
    expect(stored('U4').winnerId).toBe(F());
    expect(bracket().championId).toBeNull();
    expect(bracket().series.some((s) => s.stale)).toBe(false);
  });
});

describe('deleting, clearing and resetting', () => {
  beforeEach(() => {
    assignPositions(t.repo, tournament, ids());
    win('U1', A());
    win('U2', C());
    win('U3', A());
  });

  it('deleting a game clears the series that depended on it', () => {
    const removed = deleteBracketGame(t.repo, tournament, 'U1', 1);
    expect(removed.ok).toBe(true);
    expect(stored('U1').winnerId).toBeNull();
    expect(stored('U3')).toMatchObject({ team1Id: null, team2Id: E(), winnerId: null });
    expect(t.repo.listGames(stored('U3').id)).toHaveLength(0);
    expect(stored('U2').winnerId).toBe(C());
  });

  it('clearing a series clears its dependents', () => {
    expect(clearBracketSeries(t.repo, tournament, 'U1').ok).toBe(true);
    expect(stored('U1').winnerId).toBeNull();
    expect(stored('U3').winnerId).toBeNull();
  });

  it('resetting removes every series with its games', () => {
    resetBracket(t.repo, tournament);
    expect(t.repo.listMatches(tournament.id)).toHaveLength(0);
    expect(bracket().positions.A).toBeNull();
  });
});

describe('markBracketLive', () => {
  it('marks a series with both teams, refuses one without', () => {
    assignPositions(t.repo, tournament, ids());
    expect(markBracketLive(t.repo, tournament, 'U1', 1, NOW).ok).toBe(true);
    expect(t.repo.listLive(tournament.id).map((m) => m.matchId)).toEqual([stored('U1').id]);
    const empty = markBracketLive(t.repo, tournament, 'U3', 1, NOW);
    expect(empty.ok ? '' : empty.error).toContain('equipos');
    // A single-game series has no game 2.
    expect(markBracketLive(t.repo, tournament, 'U2', 2, NOW).ok).toBe(false);
  });
});
