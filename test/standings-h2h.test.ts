import { describe, expect, it } from 'vitest';
import { computeStandings, type GroupMatch, type StandingTeam, type TiebreakCriterion } from '../src/domain/standings.js';

const team = (id: number): StandingTeam => ({ id, code: String.fromCharCode(64 + id), name: `Team ${String.fromCharCode(64 + id)}` });
const [A, B, C, D, E] = [1, 2, 3, 4, 5] as const;

let number = 0;
/** A played match won by `winner` (kills/deaths given from team1's point of view). */
const game = (t1: number, t2: number, winner: number, k1 = 10, d1 = 5, k2 = 5, d2 = 10): GroupMatch => ({
  matchNumber: ++number,
  team1Id: t1,
  team2Id: t2,
  winnerId: winner,
  team1Kills: k1,
  team1Deaths: d1,
  team2Kills: k2,
  team2Deaths: d2,
});
const unplayed = (t1: number, t2: number): GroupMatch => ({
  matchNumber: ++number,
  team1Id: t1,
  team2Id: t2,
  winnerId: null,
  team1Kills: null,
  team1Deaths: null,
  team2Kills: null,
  team2Deaths: null,
});

const standings = (ids: number[], matches: GroupMatch[], tiebreakers: TiebreakCriterion[], qualifiers = 2) =>
  computeStandings(ids.map(team), matches, qualifiers, { tiebreakers });
const order = (rows: ReturnType<typeof standings>) => rows.map((r) => r.code).join('');
const row = (rows: ReturnType<typeof standings>, code: string) => rows.find((r) => r.code === code)!;

describe('head-to-head between two teams', () => {
  // A beat B; B beat C: A and B are level on 1 point and on K-D (+5 each).
  const level = () => [game(A, B, A, 10, 5, 5, 10), game(B, C, B, 15, 5, 5, 15)];

  it('puts the winner of their match above the other', () => {
    number = 0;
    const rows = standings([A, B, C], level(), ['h2h']);
    expect(order(rows)).toBe('ABC');
    expect(row(rows, 'A').unresolvedTie).toBe(false);
    expect(row(rows, 'B').unresolvedTie).toBe(false);
    expect([row(rows, 'A').rank, row(rows, 'B').rank]).toEqual([1, 2]);
  });

  it('is decisive whichever team has the lower code', () => {
    number = 0;
    const rows = standings([A, B, C], [game(B, A, B, 10, 5, 5, 10), game(A, C, A, 15, 5, 5, 15)], ['h2h']);
    expect(order(rows)).toBe('BAC');
  });

  it('applies after K−D: only teams level on K−D reach it', () => {
    number = 0;
    const rows = standings([A, B, C], level(), ['kd', 'h2h']);
    expect(order(rows)).toBe('ABC');
    expect(row(rows, 'A').unresolvedTie).toBe(false);
  });

  it('order of criteria matters: K−D first and head-to-head first can disagree', () => {
    number = 0;
    // B beat A narrowly; A crushed C. Both 1 point: A has the far better K−D, B won the direct match.
    const matches = [game(B, A, B, 10, 8, 8, 10), game(A, C, A, 30, 1, 1, 30)];
    expect(order(standings([A, B, C], matches, ['kd', 'h2h']))).toBe('ABC');
    expect(order(standings([A, B, C], matches, ['h2h', 'kd']))).toBe('BAC');
  });

  it('does nothing when the two teams never played (or the match is not played yet)', () => {
    number = 0;
    const rows = standings([A, B, C], [game(A, C, A), game(B, C, B), unplayed(A, B)], ['h2h']);
    expect(row(rows, 'A').unresolvedTie).toBe(true);
    expect(row(rows, 'B').unresolvedTie).toBe(true);
    expect(row(rows, 'A').rank).toBe(row(rows, 'B').rank);
  });
});

describe('head-to-head among three or more teams (a mini-league)', () => {
  it('leaves a full cycle unresolved', () => {
    number = 0;
    // A>B, B>C, C>A, and all three beat D: A, B, C are level on 2 points and on K−D.
    const matches = [game(A, B, A), game(B, C, B), game(C, A, C), game(A, D, A), game(B, D, B), game(C, D, C)];
    const rows = standings([A, B, C, D], matches, ['h2h']);
    expect(order(rows)).toBe('ABCD');
    for (const code of ['A', 'B', 'C']) {
      expect(row(rows, code).unresolvedTie).toBe(true);
      expect(row(rows, code).rank).toBe(1);
      expect(row(rows, code).tiedWith).toHaveLength(2);
    }
    expect(row(rows, 'D').unresolvedTie).toBe(false);
  });

  // Five teams. A, B and C finish on 2 points; D and E on 1. Inside {A, B, C}: A beat B and C, B–C was not played.
  const partial = () => {
    number = 0;
    return [
      game(A, B, A), game(A, C, A), game(D, A, D), game(E, A, E),
      game(B, D, B), game(B, E, B),
      game(C, D, C, 10, 5, 5, 10), game(C, E, C, 20, 5, 5, 20),
    ];
  };

  it('separates the team with two mini-league wins and leaves the rest level', () => {
    const rows = standings([A, B, C, D, E], partial(), ['h2h'], 3);
    expect(row(rows, 'A').rank).toBe(1);
    expect(row(rows, 'A').unresolvedTie).toBe(false);
    expect(row(rows, 'B').rank).toBe(2);
    expect(row(rows, 'C').rank).toBe(2);
    expect(row(rows, 'B').tiedWith).toEqual([3]);
    expect(row(rows, 'B').unresolvedTie).toBe(true);
  });

  it('hands the still-level teams to the next criterion instead of restarting from points', () => {
    const rows = standings([A, B, C, D, E], partial(), ['h2h', 'kd'], 3);
    // C has the better K−D against D and E, so it goes ahead of B; A stays first.
    expect(order(rows).slice(0, 3)).toBe('ACB');
    expect(row(rows, 'B').unresolvedTie).toBe(false);
    expect(row(rows, 'C').unresolvedTie).toBe(false);
  });

  it('never lifts a team over one with more points, whatever the head-to-head says', () => {
    number = 0;
    // A beat B directly, but B has more points overall.
    const rows = standings([A, B, C, D], [game(A, B, A), game(B, C, B), game(B, D, B), game(C, D, D)], ['h2h']);
    expect(row(rows, 'B').points).toBe(2);
    expect(order(rows).indexOf('B')).toBeLessThan(order(rows).indexOf('A'));
  });

  it('only counts matches among the tied teams', () => {
    number = 0;
    // A and B tied on 2 points; A also beat D, B lost to E. Neither result may count, only A vs B does (B won).
    const rows = standings(
      [A, B, C, D, E],
      [game(B, A, B), game(A, C, A), game(A, D, A), game(D, B, D), game(B, C, B)],
      ['h2h'],
    );
    expect(row(rows, 'A').points).toBe(2);
    expect(row(rows, 'B').points).toBe(2);
    expect(order(rows).indexOf('B')).toBeLessThan(order(rows).indexOf('A'));
  });
});

describe('double round-robin', () => {
  it('a direct sweep decides it', () => {
    number = 0;
    const rows = standings([A, B, C], [game(A, B, A), game(B, A, A), game(B, C, B), game(C, B, B)], ['h2h']);
    expect(order(rows)).toBe('ABC');
    expect(row(rows, 'A').unresolvedTie).toBe(false);
  });

  it('a split leaves them level for this criterion', () => {
    number = 0;
    const rows = standings([A, B, C], [game(A, B, A), game(B, A, B), game(A, C, A), game(B, C, B)], ['h2h']);
    expect(row(rows, 'A').points).toBe(2);
    expect(row(rows, 'B').points).toBe(2);
    expect(row(rows, 'A').unresolvedTie).toBe(true);
    expect(row(rows, 'B').unresolvedTie).toBe(true);
  });

  it('a split falls through to the next criterion', () => {
    number = 0;
    const matches = [game(A, B, A, 10, 5, 5, 10), game(B, A, B, 10, 5, 5, 10), game(A, C, A, 30, 1, 1, 30), game(B, C, B, 12, 5, 5, 12)];
    expect(order(standings([A, B, C], matches, ['h2h', 'kd']))).toBe('ABC');
  });
});

describe('criteria list handling', () => {
  it('with no criteria, teams level on points stay tied', () => {
    number = 0;
    const rows = standings([A, B, C], [game(A, C, A), game(B, C, B)], []);
    expect(row(rows, 'A').unresolvedTie).toBe(true);
    expect(row(rows, 'B').unresolvedTie).toBe(true);
  });

  it('ignores repeated and unknown criteria', () => {
    number = 0;
    const matches = [game(A, B, A, 10, 5, 5, 10), game(B, C, B, 15, 5, 5, 15)];
    const rows = standings([A, B, C], matches, ['h2h', 'h2h', 'nonsense' as never, 'toString' as never]);
    expect(order(rows)).toBe('ABC');
  });

  it('kills still works as a criterion of its own', () => {
    number = 0;
    const matches = [game(A, C, A, 12, 12, 1, 1), game(B, C, B, 30, 30, 1, 1)];
    expect(order(standings([A, B, C], matches, ['kills']))).toBe('BAC');
  });
});

describe('qualification status', () => {
  // A full cycle among three teams, all group matches played, top 2 qualify: the cutoff is inside the tie.
  const cycle = () => [game(A, B, A), game(B, C, B), game(C, A, C)];

  it('marks the tie at the cutoff for a manual decision when head-to-head cannot break it', () => {
    number = 0;
    const rows = standings([A, B, C], cycle(), ['kd', 'h2h']);
    expect(rows.map((r) => r.status)).toEqual(['tiebreak', 'tiebreak', 'tiebreak']);
  });

  it('qualifies and eliminates cleanly when head-to-head breaks the tie', () => {
    number = 0;
    // A and B are level on 1 point and K−D; A won the direct match; C lost to both... C has 0.
    const rows = standings([A, B, C], [game(A, B, A, 10, 5, 5, 10), game(B, C, B, 15, 5, 5, 15), game(A, C, C, 5, 10, 10, 5)], ['kd', 'h2h']);
    expect(rows.map((r) => r.code)).toHaveLength(3);
    expect(rows.every((r) => r.status !== 'tiebreak' || r.unresolvedTie)).toBe(true);
  });
});
