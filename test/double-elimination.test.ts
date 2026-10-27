import { describe, expect, it } from 'vitest';
import {
  DE_SLOTS,
  buildDoubleElimination,
  deSlotFor,
  deSlotForKey,
  type DeSlotKey,
  type DeStoredMatch,
} from '../src/domain/double-elimination.js';

// Teams 1..6 sit in positions A..F.
const A = 1, B = 2, C = 3, D = 4, E = 5, F = 6;

function stored(key: DeSlotKey, team1Id: number | null, team2Id: number | null, winnerId: number | null = null): DeStoredMatch {
  const slot = deSlotForKey(key);
  return { id: slot.matchNumber + (slot.phase === 'final' ? 100 : 0), phase: slot.phase, matchNumber: slot.matchNumber, team1Id, team2Id, winnerId };
}

const placed = (): DeStoredMatch[] => [stored('U1', A, B), stored('U2', C, D), stored('U3', null, E), stored('U4', F, null)];

function withResults(results: Partial<Record<DeSlotKey, number>>): DeStoredMatch[] {
  // Rebuilds stored matches in bracket order, storing each played series with its derived teams.
  let matches = placed();
  for (const slot of DE_SLOTS) {
    const winner = results[slot.key];
    if (winner === undefined) continue;
    const series = buildDoubleElimination(matches).series.find((s) => s.key === slot.key)!;
    matches = matches.filter((m) => !(m.phase === slot.phase && m.matchNumber === slot.matchNumber));
    matches.push(stored(slot.key, series.team1Id, series.team2Id, winner));
  }
  return matches;
}

const series = (matches: DeStoredMatch[], key: DeSlotKey) => buildDoubleElimination(matches).series.find((s) => s.key === key)!;

describe('double elimination structure', () => {
  it('has 10 series stored as semifinal 1..9 and the grand final as final 1', () => {
    expect(DE_SLOTS.map((s) => s.key)).toEqual(['U1', 'U2', 'U3', 'U4', 'U5', 'L1', 'L2', 'L3', 'L4', 'GF']);
    expect(DE_SLOTS.map((s) => `${s.phase}:${s.matchNumber}`)).toEqual([
      'semifinal:1', 'semifinal:2', 'semifinal:3', 'semifinal:4', 'semifinal:5',
      'semifinal:6', 'semifinal:7', 'semifinal:8', 'semifinal:9', 'final:1',
    ]);
    expect(deSlotFor('semifinal', 5)?.key).toBe('U5');
    expect(deSlotFor('final', 1)?.key).toBe('GF');
    expect(deSlotFor('semifinal', 10)).toBeUndefined();
    expect(deSlotFor('group', 1)).toBeUndefined();
  });

  it('names every series with a short code and a label', () => {
    expect(DE_SLOTS.map((s) => `${s.code} ${s.label}`)).toEqual([
      'S1 Superior · Ronda 1',
      'S2 Superior · Ronda 1',
      'S3 Superior · Ronda 2',
      'S4 Superior · Ronda 2',
      'S5 Final superior',
      'I1 Inferior · Ronda 1',
      'I2 Inferior · Ronda 1',
      'I3 Inferior · Ronda 2',
      'I4 Final inferior',
      'GF Gran final',
    ]);
  });
});

describe('buildDoubleElimination', () => {
  it('is empty with no stored matches', () => {
    const bracket = buildDoubleElimination([]);
    expect(bracket.positions).toEqual({ A: null, B: null, C: null, D: null, E: null, F: null });
    expect(bracket.series.every((s) => s.team1Id === null && s.team2Id === null && s.winnerId === null)).toBe(true);
    expect(bracket.championId).toBeNull();
    expect(bracket.complete).toBe(false);
  });

  it('reads positions A..F from the stored position seats', () => {
    const bracket = buildDoubleElimination(placed());
    expect(bracket.positions).toEqual({ A, B, C, D, E, F });
    expect(series(placed(), 'U1')).toMatchObject({ team1Id: A, team2Id: B });
    expect(series(placed(), 'U2')).toMatchObject({ team1Id: C, team2Id: D });
    expect(series(placed(), 'U3')).toMatchObject({ team1Id: null, team2Id: E });
    expect(series(placed(), 'U4')).toMatchObject({ team1Id: F, team2Id: null });
  });

  it('describes the source of every seat for empty placeholders', () => {
    const sources = buildDoubleElimination([]).series.map((s) => s.sources.join(' / '));
    expect(sources).toEqual([
      'Posición A / Posición B',
      'Posición C / Posición D',
      'Ganador S1 / Posición E',
      'Posición F / Ganador S2',
      'Ganador S3 / Ganador S4',
      'Perdedor S1 / Perdedor S4',
      'Perdedor S2 / Perdedor S3',
      'Ganador I1 / Ganador I2',
      'Ganador I3 / Perdedor S5',
      'Ganador S5 / Ganador I4',
    ]);
  });

  it('advances winners and drops losers following the stakeholder bracket', () => {
    // A beats B, D beats C, E beats A, F beats D, E beats F (upper final).
    const m = withResults({ U1: A, U2: D, U3: E, U4: F, U5: E });
    expect(series(m, 'U3')).toMatchObject({ team1Id: A, team2Id: E, winnerId: E, loserId: A });
    expect(series(m, 'U4')).toMatchObject({ team1Id: F, team2Id: D, winnerId: F, loserId: D });
    expect(series(m, 'U5')).toMatchObject({ team1Id: E, team2Id: F, winnerId: E, loserId: F });
    expect(series(m, 'L1')).toMatchObject({ team1Id: B, team2Id: D }); // loser U1 vs loser U4
    expect(series(m, 'L2')).toMatchObject({ team1Id: C, team2Id: A }); // loser U2 vs loser U3
    expect(series(m, 'GF')).toMatchObject({ team1Id: E, team2Id: null });
  });

  it('crowns the grand final winner, whichever bracket they come from', () => {
    const m = withResults({ U1: A, U2: D, U3: E, U4: F, U5: E, L1: D, L2: A, L3: D, L4: F });
    expect(series(m, 'L3')).toMatchObject({ team1Id: D, team2Id: A, winnerId: D });
    expect(series(m, 'L4')).toMatchObject({ team1Id: D, team2Id: F, winnerId: F }); // winner L3 vs loser U5
    expect(series(m, 'GF')).toMatchObject({ team1Id: E, team2Id: F });
    const fromLower = withResults({ U1: A, U2: D, U3: E, U4: F, U5: E, L1: D, L2: A, L3: D, L4: F, GF: F });
    expect(buildDoubleElimination(fromLower)).toMatchObject({ championId: F, complete: true });
    const fromUpper = withResults({ U1: A, U2: D, U3: E, U4: F, U5: E, L1: D, L2: A, L3: D, L4: F, GF: E });
    expect(buildDoubleElimination(fromUpper).championId).toBe(E);
  });

  it('ignores a stored result whose teams no longer match the derived seats and flags it stale', () => {
    const m = withResults({ U1: A, U3: E });
    // U1 is changed to B: U3 was played by A, so its stored result no longer counts.
    const changed = m.map((x) => (x.phase === 'semifinal' && x.matchNumber === 1 ? { ...x, winnerId: B } : x));
    const u3 = series(changed, 'U3');
    expect(u3).toMatchObject({ team1Id: B, team2Id: E, winnerId: null, loserId: null, stale: true });
    expect(series(changed, 'U1').stale).toBe(false);
    expect(series(changed, 'L2')).toMatchObject({ team2Id: null });
  });

  it('flags as stale a match whose stored teams are set while a derived seat is empty', () => {
    const m = withResults({ U1: A, U3: E });
    const removed = m.map((x) => (x.phase === 'semifinal' && x.matchNumber === 1 ? { ...x, winnerId: null } : x));
    expect(series(removed, 'U3')).toMatchObject({ team1Id: null, team2Id: E, winnerId: null, stale: true });
  });

  it('does not flag a match whose stored teams are still empty', () => {
    expect(buildDoubleElimination(withResults({ U1: A })).series.some((s) => s.stale)).toBe(false);
  });

  it('only counts a winner that is one of the two seated teams', () => {
    const m = placed().map((x) => (x.matchNumber === 1 && x.phase === 'semifinal' ? { ...x, winnerId: C } : x));
    expect(series(m, 'U1').winnerId).toBeNull();
  });
});
