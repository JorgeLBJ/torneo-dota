import { describe, expect, it } from 'vitest';
import { buildPlayoffs, type PlayoffMatch } from '../src/domain/playoffs.js';
import type { QualificationStatus, StandingRow } from '../src/domain/standings.js';

const row = (
  teamId: number,
  status: QualificationStatus,
  unresolvedTie = false,
): StandingRow => ({
  teamId,
  code: `T${teamId}`,
  name: `Team ${teamId}`,
  rank: teamId,
  played: 6,
  wins: 0,
  losses: 0,
  points: 0,
  kills: 0,
  deaths: 0,
  diff: 0,
  last5: [],
  tiedWith: [],
  unresolvedTie,
  status,
});

// Rows are already in standings order: team 1 is seed 1, etc.
const resolved = [
  row(1, 'qualified'),
  row(2, 'qualified'),
  row(3, 'qualified'),
  row(4, 'qualified'),
  row(5, 'eliminated'),
  row(6, 'eliminated'),
  row(7, 'eliminated'),
];

const pm = (
  phase: 'semifinal' | 'final',
  matchNumber: number,
  team1Id: number | null = null,
  team2Id: number | null = null,
  winnerId: number | null = null,
): PlayoffMatch => ({ phase, matchNumber, team1Id, team2Id, winnerId });

describe('buildPlayoffs', () => {
  it('seeds 1v4 and 2v3 once the group stage is resolved', () => {
    const b = buildPlayoffs(resolved, []);
    expect(b.seeded).toBe(true);
    expect(b.semifinals[0]).toMatchObject({ team1Id: 1, team2Id: 4, winnerId: null });
    expect(b.semifinals[1]).toMatchObject({ team1Id: 2, team2Id: 3, winnerId: null });
    expect(b.final).toMatchObject({ team1Id: null, team2Id: null });
    expect(b.championId).toBeNull();
  });

  it('leaves everything TBD while group standings are pending', () => {
    const pending = resolved.map((r) => ({ ...r, status: 'pending' as const }));
    const b = buildPlayoffs(pending, []);
    expect(b.seeded).toBe(false);
    expect(b.semifinals.every((s) => s.team1Id === null && s.team2Id === null)).toBe(true);
  });

  it('does not seed while a tiebreak straddles the cutoff', () => {
    const tie = [
      row(1, 'qualified'),
      row(2, 'qualified'),
      row(3, 'tiebreak', true),
      row(4, 'tiebreak', true),
      row(5, 'eliminated'),
    ];
    const b = buildPlayoffs(tie, []);
    expect(b.seeded).toBe(false);
    expect(b.semifinals[0]).toMatchObject({ team1Id: null, team2Id: null });
  });

  it('does not seed when an unresolved tie inside the qualified zone makes seed order ambiguous', () => {
    const tie = [row(1, 'qualified'), row(2, 'qualified', true), row(3, 'qualified', true), row(4, 'qualified')];
    expect(buildPlayoffs(tie, []).seeded).toBe(false);
  });

  it('fills the final from semifinal winners only', () => {
    const b = buildPlayoffs(resolved, [pm('semifinal', 1, 1, 4, 4), pm('semifinal', 2, 2, 3)]);
    expect(b.final).toMatchObject({ team1Id: 4, team2Id: null });
    const both = buildPlayoffs(resolved, [pm('semifinal', 1, 1, 4, 4), pm('semifinal', 2, 2, 3, 2)]);
    expect(both.final).toMatchObject({ team1Id: 4, team2Id: 2 });
    expect(both.championId).toBeNull();
  });

  it('names a champion only after the final has a winner', () => {
    const ms = [pm('semifinal', 1, 1, 4, 1), pm('semifinal', 2, 2, 3, 3), pm('final', 3, 1, 3, 3)];
    const b = buildPlayoffs(resolved, ms);
    expect(b.final.winnerId).toBe(3);
    expect(b.championId).toBe(3);
  });

  it('ignores a final winner that is not one of the finalists', () => {
    const ms = [pm('semifinal', 1, 1, 4, 1), pm('semifinal', 2, 2, 3, 3), pm('final', 3, 1, 3, 7)];
    expect(buildPlayoffs(resolved, ms).championId).toBeNull();
  });

  it('honors teams an admin assigned manually to semifinals', () => {
    const tie = [row(1, 'qualified'), row(2, 'tiebreak', true), row(3, 'tiebreak', true), row(4, 'qualified')];
    const b = buildPlayoffs(tie, [pm('semifinal', 1, 1, 4), pm('semifinal', 2, 3, 2)]);
    expect(b.semifinals[1]).toMatchObject({ team1Id: 3, team2Id: 2 });
    expect(b.seeded).toBe(false);
  });

  it('reports the seeds used', () => {
    expect(buildPlayoffs(resolved, []).seeds).toEqual([1, 2, 3, 4]);
    expect(buildPlayoffs([], []).seeds).toEqual([]);
  });
});
