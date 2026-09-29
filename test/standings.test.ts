import { describe, expect, it } from 'vitest';
import { computeStandings, type GroupMatch, type StandingTeam } from '../src/domain/standings.js';

const teams: StandingTeam[] = [
  { id: 1, code: 'A', name: 'Alpha' },
  { id: 2, code: 'B', name: 'Bravo' },
  { id: 3, code: 'C', name: 'Charlie' },
  { id: 4, code: 'D', name: 'Delta' },
];

let n = 0;
const m = (
  t1: number,
  t2: number,
  winner: number | null,
  k1 = 0,
  d1 = 0,
  k2 = 0,
  d2 = 0,
): GroupMatch => ({
  matchNumber: ++n,
  team1Id: t1,
  team2Id: t2,
  winnerId: winner,
  team1Kills: winner === null ? null : k1,
  team1Deaths: winner === null ? null : d1,
  team2Kills: winner === null ? null : k2,
  team2Deaths: winner === null ? null : d2,
});

const row = (rows: ReturnType<typeof computeStandings>, id: number) => rows.find((r) => r.teamId === id)!;

describe('computeStandings basics', () => {
  it('counts only played matches', () => {
    n = 0;
    const rows = computeStandings(teams, [m(1, 2, 1, 10, 5, 5, 10), m(3, 4, null)], 2);
    expect(row(rows, 1)).toMatchObject({ played: 1, wins: 1, losses: 0, points: 1, kills: 10, deaths: 5, diff: 5 });
    expect(row(rows, 2)).toMatchObject({ played: 1, wins: 0, losses: 1, points: 0, kills: 5, deaths: 10, diff: -5 });
    expect(row(rows, 3)).toMatchObject({ played: 0, points: 0 });
  });

  it('keeps all statuses pending until every group match is played', () => {
    n = 0;
    const rows = computeStandings(teams, [m(1, 2, 1, 10, 5, 5, 10), m(3, 4, null)], 2);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
  });

  it('returns rows for teams with no matches', () => {
    expect(computeStandings(teams, [], 2)).toHaveLength(4);
  });

  it('orders zero-result teams by code', () => {
    expect(computeStandings([...teams].reverse(), [], 2).map((r) => r.code)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('tiebreakers', () => {
  it('orders by points first', () => {
    n = 0;
    const rows = computeStandings(teams, [m(1, 2, 2, 1, 50, 50, 1), m(3, 4, 3, 10, 0, 0, 10)], 2);
    expect(rows.slice(0, 2).map((r) => r.teamId).sort()).toEqual([2, 3]);
  });

  it('breaks a points tie by kill difference', () => {
    n = 0;
    const rows = computeStandings(teams, [m(1, 3, 1, 10, 5, 5, 10), m(2, 4, 2, 20, 5, 5, 20)], 2);
    expect(rows.map((r) => r.teamId).slice(0, 2)).toEqual([2, 1]);
    expect(row(rows, 1).unresolvedTie).toBe(false);
  });

  it('breaks a points and diff tie by total kills', () => {
    n = 0;
    const rows = computeStandings(teams, [m(1, 3, 1, 10, 5, 5, 10), m(2, 4, 2, 20, 15, 15, 20)], 2);
    expect(rows.map((r) => r.teamId).slice(0, 2)).toEqual([2, 1]);
    expect(row(rows, 2).unresolvedTie).toBe(false);
  });

  it('resolves a 3-way points and diff tie by total kills', () => {
    n = 0;
    // Cycle: A beats B, B beats C, C beats A. All end 1 point and diff 0.
    const rows = computeStandings(
      teams.slice(0, 3),
      [m(1, 2, 1, 30, 20, 20, 30), m(2, 3, 2, 20, 10, 10, 20), m(3, 1, 3, 35, 25, 25, 35)],
      2,
    );
    expect(rows.map((r) => [r.teamId, r.points, r.diff, r.kills])).toEqual([
      [1, 1, 0, 55],
      [3, 1, 0, 45],
      [2, 1, 0, 40],
    ]);
    expect(rows.every((r) => !r.unresolvedTie)).toBe(true);
  });

  it('flags teams tied on points, diff and kills without breaking by name', () => {
    n = 0;
    const rows = computeStandings(teams, [m(1, 3, 1, 10, 5, 5, 10), m(2, 4, 2, 10, 5, 5, 10)], 2);
    expect(row(rows, 1).unresolvedTie).toBe(true);
    expect(row(rows, 1).tiedWith).toEqual([2]);
    expect(row(rows, 2).tiedWith).toEqual([1]);
    expect(row(rows, 3).unresolvedTie).toBe(true);
    expect(rows.map((r) => r.teamId)).toEqual([1, 2, 3, 4]);
  });

  it('gives a 3-way exact tie the same tiedWith set and rank', () => {
    n = 0;
    // A beats B, B beats C, C beats A, all 10-5: each 1 win, 1 loss, +0 diff, 15 kills.
    const rows = computeStandings(
      teams.slice(0, 3),
      [m(1, 2, 1, 10, 5, 5, 10), m(2, 3, 2, 10, 5, 5, 10), m(3, 1, 3, 10, 5, 5, 10)],
      2,
    );
    expect(row(rows, 1).tiedWith).toEqual([2, 3]);
    expect(row(rows, 2).tiedWith).toEqual([1, 3]);
    expect(row(rows, 3).tiedWith).toEqual([1, 2]);
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 1]);
  });
});

describe('qualification', () => {
  it('marks qualified and eliminated once all matches are played', () => {
    n = 0;
    const rows = computeStandings(teams, [m(1, 2, 1, 10, 5, 5, 10), m(3, 4, 3, 30, 5, 5, 30)], 2);
    expect(row(rows, 3).status).toBe('qualified');
    expect(row(rows, 1).status).toBe('qualified');
    expect(row(rows, 2).status).toBe('eliminated');
    expect(row(rows, 4).status).toBe('eliminated');
  });

  it('flags tiebreak when an unresolved tie straddles the cutoff', () => {
    n = 0;
    const rows = computeStandings(teams, [m(1, 3, 1, 10, 5, 5, 10), m(2, 4, 2, 10, 5, 5, 10)], 1);
    expect(row(rows, 1).status).toBe('tiebreak');
    expect(row(rows, 2).status).toBe('tiebreak');
    expect(row(rows, 3).status).toBe('eliminated');
  });

  it('does not flag tiebreak when the tie sits fully inside the qualified zone', () => {
    n = 0;
    const rows = computeStandings(teams, [m(1, 3, 1, 10, 5, 5, 10), m(2, 4, 2, 10, 5, 5, 10)], 2);
    expect(row(rows, 1).status).toBe('qualified');
    expect(row(rows, 2).status).toBe('qualified');
    expect(row(rows, 3).status).toBe('eliminated');
  });

  it('qualifies everyone when qualifiers >= team count', () => {
    n = 0;
    const rows = computeStandings(teams.slice(0, 2), [m(1, 2, 1, 1, 0, 0, 1)], 4);
    expect(rows.every((r) => r.status === 'qualified')).toBe(true);
  });
});

describe('last5 form', () => {
  it('lists results chronologically by match number, capped at 5', () => {
    n = 0;
    const ms = [
      m(1, 2, 1, 1, 0, 0, 1),
      m(1, 3, 3, 0, 1, 1, 0),
      m(1, 4, 1, 1, 0, 0, 1),
      m(2, 1, 2, 1, 0, 0, 1),
      m(3, 1, 3, 1, 0, 0, 1),
      m(4, 1, 1, 0, 1, 1, 0),
    ];
    // Provided out of order on purpose.
    const rows = computeStandings(teams, [...ms].reverse(), 2);
    expect(row(rows, 1).last5).toEqual(['L', 'W', 'L', 'L', 'W']);
    expect(row(rows, 1).played).toBe(6);
  });
});

describe('configurable rules', () => {
  it('uses points per win and per loss', () => {
    n = 0;
    const rows = computeStandings(teams, [m(1, 2, 1, 10, 5, 5, 10), m(3, 4, 3, 10, 5, 5, 10)], 2, {
      pointsWin: 3,
      pointsLoss: 1,
    });
    const alpha = rows.find((r) => r.teamId === 1)!;
    const bravo = rows.find((r) => r.teamId === 2)!;
    expect(alpha.points).toBe(3);
    expect(bravo.points).toBe(1);
  });

  it('applies the configured tiebreaker order', () => {
    n = 0;
    // Both win once: A has diff +10 with 20 kills, C has diff +5 with 30 kills.
    const matches = [m(1, 2, 1, 20, 10, 0, 0), m(3, 4, 3, 30, 25, 0, 0)];
    const byDiff = computeStandings(teams, matches, 2, { tiebreakers: ['kd', 'kills'] });
    expect(byDiff.map((r) => r.teamId).slice(0, 2)).toEqual([1, 3]);
    const byKills = computeStandings(teams, matches, 2, { tiebreakers: ['kills', 'kd'] });
    expect(byKills.map((r) => r.teamId).slice(0, 2)).toEqual([3, 1]);
  });

  it('does not flag ties on criteria that are not configured', () => {
    n = 0;
    const matches = [m(1, 2, 1, 10, 5, 0, 0), m(3, 4, 3, 20, 15, 0, 0)];
    // Same diff (+5), different kills.
    const kdOnly = computeStandings(teams, matches, 2, { tiebreakers: ['kd'] });
    expect(kdOnly.find((r) => r.teamId === 1)!.unresolvedTie).toBe(true);
    const both = computeStandings(teams, matches, 2, { tiebreakers: ['kd', 'kills'] });
    expect(both.find((r) => r.teamId === 1)!.unresolvedTie).toBe(false);
  });

  it('keeps the default behaviour without rules', () => {
    n = 0;
    const matches = [m(1, 2, 1, 10, 5, 5, 10)];
    expect(computeStandings(teams, matches, 2)).toEqual(
      computeStandings(teams, matches, 2, { pointsWin: 1, pointsLoss: 0, tiebreakers: ['kd', 'kills'] }),
    );
  });
});

describe('unknown tiebreakers', () => {
  it('ignores criteria it does not know instead of failing', () => {
    const teams = [{ id: 1, code: 'A', name: 'A' }, { id: 2, code: 'B', name: 'B' }];
    const rows = computeStandings(teams, [], 1, { tiebreakers: ['bogus' as never, 'kd'] });
    expect(rows).toHaveLength(2);
  });
});
