import { describe, expect, it } from 'vitest';
import { computeStandings, type GroupMatch, type StandingTeam, type TiebreakCriterion } from '../src/domain/standings.js';
import { buildPlayoffs } from '../src/domain/playoffs.js';

const team = (id: number): StandingTeam => ({ id, code: String.fromCharCode(64 + id), name: `Team ${String.fromCharCode(64 + id)}` });
const [A, B, C, D, E] = [1, 2, 3, 4, 5] as const;

let number = 0;
const game = (t1: number, t2: number, winner: number | null, over: Partial<GroupMatch> = {}): GroupMatch => ({
  matchNumber: ++number,
  team1Id: t1,
  team2Id: t2,
  winnerId: winner,
  team1Kills: winner === null ? null : 10,
  team1Deaths: winner === null ? null : 5,
  team2Kills: winner === null ? null : 5,
  team2Deaths: winner === null ? null : 10,
  ...over,
});
const extra = (t1: number, t2: number, winner: number | null, over: Partial<GroupMatch> = {}) => game(t1, t2, winner, { isTiebreak: true, ...over });

const standings = (ids: number[], matches: GroupMatch[], tiebreakers: TiebreakCriterion[], qualifiers = 2) =>
  computeStandings(ids.map(team), matches, qualifiers, { tiebreakers });
const order = (rows: ReturnType<typeof standings>) => rows.map((r) => r.code).join('');
const row = (rows: ReturnType<typeof standings>, code: string) => rows.find((r) => r.code === code)!;

// A full cycle of three teams, all regular matches played: A, B and C are level on everything.
const cycle = () => [game(A, B, A), game(B, C, B), game(C, A, C)];

describe('extra games stay out of the table', () => {
  it('do not count for points, wins, losses, played, kills, deaths, K−D or form', () => {
    number = 0;
    const withExtra = standings([A, B, C], [...cycle(), extra(A, B, A, { team1Kills: 99, team1Deaths: 1, team2Kills: 1, team2Deaths: 99 })], []);
    number = 0;
    const without = standings([A, B, C], cycle(), []);
    for (const code of ['A', 'B', 'C']) {
      const a = row(withExtra, code);
      const b = row(without, code);
      expect([a.played, a.wins, a.losses, a.points, a.kills, a.deaths, a.diff, a.last5]).toEqual([b.played, b.wins, b.losses, b.points, b.kills, b.deaths, b.diff, b.last5]);
    }
  });

  it('do not decide head-to-head', () => {
    number = 0;
    // A and B are level; the only meeting between them is an extra game B won. Head-to-head sees nothing.
    const matches = [game(A, C, A), game(B, C, B), extra(B, A, B)];
    const rows = standings([A, B, C], matches, ['h2h']);
    expect(row(rows, 'A').unresolvedTie).toBe(true);
    expect(row(rows, 'B').unresolvedTie).toBe(true);
  });

  it('an unplayed extra game does not delay the end of the group stage', () => {
    number = 0;
    const rows = standings([A, B, C], [...cycle(), extra(A, B, null)], ['kd']);
    expect(rows.every((r) => r.status !== 'pending')).toBe(true);
  });
});

describe('the "extra" criterion', () => {
  it('two teams: the winner of the extra game goes above', () => {
    number = 0;
    const matches = [game(A, C, A), game(B, C, B), extra(B, A, B)];
    const rows = standings([A, B, C], matches, ['extra']);
    expect(order(rows)).toBe('BAC');
    expect(row(rows, 'A').unresolvedTie).toBe(false);
    expect(row(rows, 'B').unresolvedTie).toBe(false);
  });

  it('with no extra game played, the teams stay level', () => {
    number = 0;
    for (const matches of [[game(A, C, A), game(B, C, B)], [game(A, C, A), game(B, C, B), extra(A, B, null)]]) {
      const rows = standings([A, B, C], matches, ['extra']);
      expect(row(rows, 'A').unresolvedTie).toBe(true);
      expect(row(rows, 'A').rank).toBe(row(rows, 'B').rank);
    }
  });

  it('three teams: a mini-league of extra-game wins, leaving the rest level', () => {
    number = 0;
    // Cycle among A, B, C (all level), then extra games: A beat B and C.
    const rows = standings([A, B, C], [...cycle(), extra(A, B, A), extra(A, C, A)], ['extra'], 3);
    expect(row(rows, 'A').rank).toBe(1);
    expect(row(rows, 'A').unresolvedTie).toBe(false);
    expect(row(rows, 'B').rank).toBe(2);
    expect(row(rows, 'C').rank).toBe(2);
    expect(row(rows, 'B').unresolvedTie).toBe(true);
  });

  it('three teams: a cycle of extra games resolves nothing', () => {
    number = 0;
    const rows = standings([A, B, C], [...cycle(), extra(A, B, A), extra(B, C, B), extra(C, A, C)], ['extra']);
    expect(rows.every((r) => r.unresolvedTie)).toBe(true);
  });

  it('only teams still level reach it: it comes after the earlier criteria in the list', () => {
    number = 0;
    // A and B are level on points; A has the better K−D, but B won the extra game.
    const base = [game(A, C, A, { team1Kills: 30, team1Deaths: 1, team2Kills: 1, team2Deaths: 30 }), game(B, C, B), extra(B, A, B)];
    expect(order(standings([A, B, C], base, ['kd', 'extra']))).toBe('ABC');
    expect(order(standings([A, B, C], base, ['extra', 'kd']))).toBe('BAC');
  });

  it('passes what it cannot separate to the next criterion', () => {
    number = 0;
    // A cycle in which A scores 35 kills in total, C 17 and B 15; the only extra game was never played.
    const matches = [
      game(A, B, A, { team1Kills: 30, team2Kills: 5 }),
      game(B, C, B, { team1Kills: 10, team2Kills: 5 }),
      game(C, A, C, { team1Kills: 12, team2Kills: 5 }),
      extra(A, B, null),
    ];
    const rows = standings([A, B, C], matches, ['extra', 'kills']);
    expect(order(rows)).toBe('ACB');
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(rows.some((r) => r.unresolvedTie)).toBe(false);
    // With the top 2 qualifying, "kills" settles the cutoff too.
    expect(rows.map((r) => r.status)).toEqual(['qualified', 'qualified', 'eliminated']);
  });

  it('with the next criterion unable to separate them either, they stay level', () => {
    number = 0;
    const rows = standings([A, B, C], [...cycle(), extra(A, B, null)], ['extra', 'kills']);
    expect(rows.every((r) => r.unresolvedTie)).toBe(true);
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 1]);
  });
});

describe('status at the qualification cutoff', () => {
  it('"extra-pending" when a tie at the cutoff survives and "extra" is in the list', () => {
    number = 0;
    const rows = standings([A, B, C], cycle(), ['kd', 'h2h', 'extra']);
    expect(rows.map((r) => r.status)).toEqual(['extra-pending', 'extra-pending', 'extra-pending']);
  });

  it('is still "extra-pending" when an extra game was played but the teams are still level', () => {
    number = 0;
    const rows = standings([A, B, C], [...cycle(), extra(A, B, A)], ['extra']);
    // A beat B in the mini-league of three: A separated, B and C still level at the cutoff (top 2).
    expect(row(rows, 'A').status).toBe('qualified');
    expect(row(rows, 'B').status).toBe('extra-pending');
    expect(row(rows, 'C').status).toBe('extra-pending');
  });

  it('keeps the plain unresolved status when "extra" is not a criterion', () => {
    number = 0;
    const rows = standings([A, B, C], cycle(), ['kd', 'h2h']);
    expect(rows.map((r) => r.status)).toEqual(['tiebreak', 'tiebreak', 'tiebreak']);
  });

  it('resolves to qualified / eliminated once the extra game decides it', () => {
    number = 0;
    const rows = standings([A, B, C, D], [game(A, C, A), game(B, C, B), game(A, D, D), game(B, D, D), extra(B, A, B)], ['extra'], 2);
    // D has 2 points; A and B are level on 1 and the extra game B won decides them; C has none.
    expect(order(rows)).toBe('DBAC');
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => r.status)).toEqual(['qualified', 'qualified', 'eliminated', 'eliminated']);
    expect(rows.some((r) => r.unresolvedTie)).toBe(false);
  });

  describe('playoff seeding', () => {
    // A beat everyone. B, C, D and E form a 4-cycle (B>C>D>E>B): level on 1 point, and the top 4 cut runs through them.
    const league = () => [
      game(A, B, A), game(A, C, A), game(A, D, A), game(A, E, A),
      game(B, C, B), game(C, D, C), game(D, E, D), game(E, B, E),
    ];

    it('stays manual while "Pendiente de juego adicional" sits on the cutoff', () => {
      number = 0;
      const rows = standings([A, B, C, D, E], league(), ['extra'], 4);
      expect(order(rows)).toBe('ABCDE');
      expect(rows.map((r) => r.status)).toEqual(['qualified', 'extra-pending', 'extra-pending', 'extra-pending', 'extra-pending']);
      const bracket = buildPlayoffs(rows, []);
      expect(bracket.seeded).toBe(false);
      expect(bracket.seeds).toEqual([]);
    });

    it('seeds automatically once the extra games settle the cutoff', () => {
      number = 0;
      // Extra games: B beat C, D and E; C beat D and E; D beat E.
      const settled = [...league(), extra(B, C, B), extra(B, D, B), extra(B, E, B), extra(C, D, C), extra(C, E, C), extra(D, E, D)];
      const rows = standings([A, B, C, D, E], settled, ['extra'], 4);
      expect(order(rows)).toBe('ABCDE');
      expect(rows.map((r) => r.status)).toEqual(['qualified', 'qualified', 'qualified', 'qualified', 'eliminated']);
      const bracket = buildPlayoffs(rows, []);
      expect(bracket.seeded).toBe(true);
      expect(bracket.seeds).toEqual([A, B, C, D]);
    });

    it('a tie that does not reach the cutoff still blocks seeding through the unresolved flag', () => {
      number = 0;
      const rows = standings([A, B, C, D], [...cycle(), game(A, D, A), game(B, D, B), game(C, D, C)], ['extra'], 4);
      expect(buildPlayoffs(rows, []).seeded).toBe(false);
    });
  });
});
