// A match is a series of games. Group matches are usually one game (best of 1); playoffs are longer.
// The winner is the first to ceil(length / 2) game wins; kills and deaths of the match are the sums over its games.

export type SeriesLength = 1 | 3 | 5;

export interface GameScore {
  gameNumber: number;
  winnerId: number;
  team1Kills: number;
  team1Deaths: number;
  team2Kills: number;
  team2Deaths: number;
}

export interface SeriesTotals {
  team1Kills: number;
  team1Deaths: number;
  team2Kills: number;
  team2Deaths: number;
}

export interface SeriesState {
  length: SeriesLength;
  /** Game wins needed to take the series. */
  needed: number;
  /** Game wins of [team 1, team 2]. */
  wins: [number, number];
  winnerId: number | null;
  decided: boolean;
  /** The next game to load, or null once the series is decided or complete. */
  nextGame: number | null;
  /** Sums over all loaded games; null while there are none. */
  totals: SeriesTotals | null;
}

export const SERIES_LENGTHS: readonly SeriesLength[] = [1, 3, 5];

export const isSeriesLength = (value: number): value is SeriesLength => (SERIES_LENGTHS as readonly number[]).includes(value);

export const winsNeeded = (length: number): number => Math.ceil(length / 2);

export interface SeriesFormat {
  groupGames: SeriesLength;
  semifinalGames: SeriesLength;
  finalGames: SeriesLength;
}

/** Games per match for a phase; an extra tiebreak game is always a single game. */
export function seriesLengthFor(format: SeriesFormat, phase: 'group' | 'semifinal' | 'final', isTiebreak: boolean): SeriesLength {
  if (isTiebreak) return 1;
  return phase === 'group' ? format.groupGames : phase === 'semifinal' ? format.semifinalGames : format.finalGames;
}

export function resolveSeries(team1Id: number, team2Id: number, length: SeriesLength, games: readonly GameScore[]): SeriesState {
  const needed = winsNeeded(length);
  const ordered = [...games].sort((a, b) => a.gameNumber - b.gameNumber);
  const wins: [number, number] = [0, 0];
  let winnerId: number | null = null;
  for (const game of ordered) {
    if (winnerId !== null) break; // anything after the decider does not count
    if (game.winnerId === team1Id) wins[0]++;
    else if (game.winnerId === team2Id) wins[1]++;
    if (wins[0] >= needed) winnerId = team1Id;
    else if (wins[1] >= needed) winnerId = team2Id;
  }
  const counted = ordered.length;
  const totals =
    counted === 0
      ? null
      : ordered.reduce<SeriesTotals>(
          (sum, g) => ({
            team1Kills: sum.team1Kills + g.team1Kills,
            team1Deaths: sum.team1Deaths + g.team1Deaths,
            team2Kills: sum.team2Kills + g.team2Kills,
            team2Deaths: sum.team2Deaths + g.team2Deaths,
          }),
          { team1Kills: 0, team1Deaths: 0, team2Kills: 0, team2Deaths: 0 },
        );
  const nextNumber = counted + 1;
  return {
    length,
    needed,
    wins,
    winnerId,
    decided: winnerId !== null,
    nextGame: winnerId === null && nextNumber <= length ? nextNumber : null,
    totals,
  };
}

/** Null when the games form a legal series; otherwise the Spanish reason. */
export function validateSeries(team1Id: number, team2Id: number, length: SeriesLength, games: readonly GameScore[]): string | null {
  const ordered = [...games].sort((a, b) => a.gameNumber - b.gameNumber);
  const seen = new Set<number>();
  for (const game of ordered) {
    if (seen.has(game.gameNumber)) return `El juego ${game.gameNumber} está repetido.`;
    seen.add(game.gameNumber);
    if (game.winnerId !== team1Id && game.winnerId !== team2Id) return `El ganador del juego ${game.gameNumber} no juega este partido.`;
    if (game.gameNumber < 1 || game.gameNumber > length) return `El juego ${game.gameNumber} no existe en una serie al mejor de ${length}.`;
  }
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i]!.gameNumber !== i + 1) return `Carga los juegos en orden: falta el juego ${i + 1}.`;
  }
  const needed = winsNeeded(length);
  const wins: [number, number] = [0, 0];
  for (const game of ordered) {
    if (wins[0] >= needed || wins[1] >= needed) return `La serie ya estaba decidida: el juego ${game.gameNumber} sobra.`;
    if (game.winnerId === team1Id) wins[0]++;
    else wins[1]++;
  }
  return null;
}
