import type { StandingRow } from './standings.js';

export interface PlayoffMatch {
  id?: number;
  phase: 'semifinal' | 'final';
  matchNumber: number;
  team1Id: number | null;
  team2Id: number | null;
  winnerId: number | null;
}

export interface BracketSlot {
  matchId: number | null;
  team1Id: number | null;
  team2Id: number | null;
  winnerId: number | null;
}

export interface Bracket {
  /** True when seeds were derived automatically from resolved standings. */
  seeded: boolean;
  /** Team ids by seed (index 0 = seed 1); empty until seeded. */
  seeds: number[];
  /** [SF1 (seed1 v seed4), SF2 (seed2 v seed3)] */
  semifinals: [BracketSlot, BracketSlot];
  final: BracketSlot;
  championId: number | null;
}

const SEMIFINAL_SEEDS: [number, number][] = [
  [0, 3],
  [1, 2],
];

/** A winner only counts when it is one of the match's two (stored) teams. */
function validWinner(match: PlayoffMatch | undefined): number | null {
  const winner = match?.winnerId ?? null;
  if (winner === null || match?.team1Id == null || match.team2Id == null) return null;
  return winner === match.team1Id || winner === match.team2Id ? winner : null;
}

function toSlot(match: PlayoffMatch | undefined): BracketSlot {
  return {
    matchId: match?.id ?? null,
    team1Id: match?.team1Id ?? null,
    team2Id: match?.team2Id ?? null,
    winnerId: validWinner(match),
  };
}

function byMatchNumber(matches: PlayoffMatch[], phase: PlayoffMatch['phase']): PlayoffMatch[] {
  return matches.filter((m) => m.phase === phase).sort((a, b) => a.matchNumber - b.matchNumber);
}

/**
 * Four-team playoff bracket derived from standings and stored playoff matches.
 * Automatic seeding requires the group stage to be fully resolved: no pending
 * or tiebreak status, and no unresolved tie inside the seeded zone.
 * Semifinal teams already assigned on a stored match (manual tiebreak
 * resolution) take precedence over seeding.
 */
export function buildPlayoffs(standings: StandingRow[], playoffMatches: PlayoffMatch[]): Bracket {
  const top = standings.slice(0, 4);
  const seeded =
    top.length === 4 && top.every((r) => r.status === 'qualified' && !r.unresolvedTie);
  const seeds = seeded ? top.map((r) => r.teamId) : [];

  const [sf1Stored, sf2Stored] = byMatchNumber(playoffMatches, 'semifinal');
  const semifinals = [sf1Stored, sf2Stored].map((stored, i): BracketSlot => {
    const slot = toSlot(stored);
    const [a, b] = SEMIFINAL_SEEDS[i]!;
    if (slot.team1Id === null && slot.team2Id === null && seeded) {
      slot.team1Id = seeds[a] ?? null;
      slot.team2Id = seeds[b] ?? null;
    }
    return slot;
  }) as [BracketSlot, BracketSlot];

  const finalStored = byMatchNumber(playoffMatches, 'final')[0];
  const final = toSlot(finalStored);
  final.team1Id = semifinals[0].winnerId;
  final.team2Id = semifinals[1].winnerId;
  if (final.winnerId !== final.team1Id && final.winnerId !== final.team2Id) final.winnerId = null;

  return { seeded, seeds, semifinals, final, championId: final.winnerId };
}
