// Six-team double elimination: upper and lower brackets from the start, then a grand final.
// The series are stored as ordinary playoff matches (upper and lower series as 'semifinal' 1..9, the grand final
// as 'final' 1); this module owns that mapping, the bracket's shape and every series label.

export type DeSlotKey = 'U1' | 'U2' | 'U3' | 'U4' | 'U5' | 'L1' | 'L2' | 'L3' | 'L4' | 'GF';
export type Position = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export const POSITIONS: readonly Position[] = ['A', 'B', 'C', 'D', 'E', 'F'];

export type DeSide = 'upper' | 'lower' | 'grand';
type Source = { position: Position } | { winnerOf: DeSlotKey } | { loserOf: DeSlotKey };

export interface DeSlot {
  key: DeSlotKey;
  /** Short code shown next to the series and in placeholders ("Ganador S1"). */
  code: string;
  label: string;
  side: DeSide;
  /** Column inside its side, from 1. */
  round: number;
  phase: 'semifinal' | 'final';
  matchNumber: number;
  sources: readonly [Source, Source];
}

const slot = (
  key: DeSlotKey,
  code: string,
  label: string,
  side: DeSide,
  round: number,
  matchNumber: number,
  sources: readonly [Source, Source],
): DeSlot => ({ key, code, label, side, round, phase: key === 'GF' ? 'final' : 'semifinal', matchNumber, sources });

/** In play order: every series only depends on earlier ones. */
export const DE_SLOTS: readonly DeSlot[] = [
  slot('U1', 'S1', 'Superior · Ronda 1', 'upper', 1, 1, [{ position: 'A' }, { position: 'B' }]),
  slot('U2', 'S2', 'Superior · Ronda 1', 'upper', 1, 2, [{ position: 'C' }, { position: 'D' }]),
  slot('U3', 'S3', 'Superior · Ronda 2', 'upper', 2, 3, [{ winnerOf: 'U1' }, { position: 'E' }]),
  slot('U4', 'S4', 'Superior · Ronda 2', 'upper', 2, 4, [{ position: 'F' }, { winnerOf: 'U2' }]),
  slot('U5', 'S5', 'Final superior', 'upper', 3, 5, [{ winnerOf: 'U3' }, { winnerOf: 'U4' }]),
  slot('L1', 'I1', 'Inferior · Ronda 1', 'lower', 1, 6, [{ loserOf: 'U1' }, { loserOf: 'U4' }]),
  slot('L2', 'I2', 'Inferior · Ronda 1', 'lower', 1, 7, [{ loserOf: 'U2' }, { loserOf: 'U3' }]),
  slot('L3', 'I3', 'Inferior · Ronda 2', 'lower', 2, 8, [{ winnerOf: 'L1' }, { winnerOf: 'L2' }]),
  slot('L4', 'I4', 'Final inferior', 'lower', 3, 9, [{ winnerOf: 'L3' }, { loserOf: 'U5' }]),
  slot('GF', 'GF', 'Gran final', 'grand', 1, 1, [{ winnerOf: 'U5' }, { winnerOf: 'L4' }]),
];

const BY_KEY = new Map(DE_SLOTS.map((s) => [s.key, s]));

export function deSlotForKey(key: DeSlotKey): DeSlot {
  return BY_KEY.get(key)!;
}

/** The series stored as this playoff match, if any. */
export function deSlotFor(phase: string, matchNumber: number): DeSlot | undefined {
  return DE_SLOTS.find((s) => s.phase === phase && s.matchNumber === matchNumber);
}

/** Where each position is stored: the seat (1 or 2) of a series fed directly by that position. */
export const POSITION_SEATS: Readonly<Record<Position, { key: DeSlotKey; seat: 1 | 2 }>> = Object.fromEntries(
  DE_SLOTS.flatMap((s) =>
    s.sources.flatMap((src, i) => ('position' in src ? [[src.position, { key: s.key, seat: (i + 1) as 1 | 2 }]] : [])),
  ),
) as Record<Position, { key: DeSlotKey; seat: 1 | 2 }>;

export interface DeStoredMatch {
  id: number;
  phase: string;
  matchNumber: number;
  team1Id: number | null;
  team2Id: number | null;
  winnerId: number | null;
}

export interface DeSeries {
  key: DeSlotKey;
  code: string;
  label: string;
  side: DeSide;
  round: number;
  phase: 'semifinal' | 'final';
  matchNumber: number;
  matchId: number | null;
  /** Teams in their seats, from the positions and earlier results. */
  team1Id: number | null;
  team2Id: number | null;
  /** Counts only when it is one of the two seated teams and the stored teams are those seats. */
  winnerId: number | null;
  loserId: number | null;
  /** What fills each seat, for empty placeholders ("Posición A", "Ganador S1", "Perdedor S4"). */
  sources: [string, string];
  /** The stored teams no longer match the seats (an earlier result changed): its games must be cleared. */
  stale: boolean;
}

export interface DoubleEliminationBracket {
  series: DeSeries[];
  positions: Record<Position, number | null>;
  championId: number | null;
  complete: boolean;
}

function describe(src: Source): string {
  if ('position' in src) return `Posición ${src.position}`;
  if ('winnerOf' in src) return `Ganador ${deSlotForKey(src.winnerOf).code}`;
  return `Perdedor ${deSlotForKey(src.loserOf).code}`;
}

/** Derives the whole bracket from the stored matches; nothing derived is persisted. */
export function buildDoubleElimination(matches: readonly DeStoredMatch[]): DoubleEliminationBracket {
  const storedFor = (s: DeSlot) => matches.find((m) => m.phase === s.phase && m.matchNumber === s.matchNumber);
  const done = new Map<DeSlotKey, DeSeries>();
  const positions = Object.fromEntries(POSITIONS.map((p) => [p, null])) as Record<Position, number | null>;

  for (const s of DE_SLOTS) {
    const stored = storedFor(s);
    const seat = (src: Source, i: number): number | null => {
      if ('position' in src) {
        const team = (i === 0 ? stored?.team1Id : stored?.team2Id) ?? null;
        positions[src.position] = team;
        return team;
      }
      if ('winnerOf' in src) return done.get(src.winnerOf)?.winnerId ?? null;
      return done.get(src.loserOf)?.loserId ?? null;
    };
    const team1Id = seat(s.sources[0], 0);
    const team2Id = seat(s.sources[1], 1);
    const storedTeams = [stored?.team1Id ?? null, stored?.team2Id ?? null];
    const seatsMatch = storedTeams[0] === team1Id && storedTeams[1] === team2Id;
    const winner = stored?.winnerId ?? null;
    const winnerId =
      seatsMatch && team1Id !== null && team2Id !== null && (winner === team1Id || winner === team2Id) ? winner : null;
    const loserId = winnerId === null ? null : winnerId === team1Id ? team2Id : team1Id;
    // A seat fed by a result is stale when it still stores a team the results no longer put there. (Position seats
    // are the stored teams themselves; a seat stored empty is simply not filled yet.)
    const derived = [team1Id, team2Id];
    const stale = s.sources.some((src, i) => !('position' in src) && storedTeams[i] !== null && storedTeams[i] !== derived[i]);
    done.set(s.key, {
      key: s.key,
      code: s.code,
      label: s.label,
      side: s.side,
      round: s.round,
      phase: s.phase,
      matchNumber: s.matchNumber,
      matchId: stored?.id ?? null,
      team1Id,
      team2Id,
      winnerId,
      loserId,
      sources: [describe(s.sources[0]), describe(s.sources[1])],
      stale,
    });
  }

  const series = DE_SLOTS.map((s) => done.get(s.key)!);
  const championId = done.get('GF')!.winnerId;
  return { series, positions, championId, complete: championId !== null };
}
