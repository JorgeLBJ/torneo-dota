import { resolveSeries, type GameScore, type SeriesLength } from './series.js';

// A match is "live" while the admin says its next game is being played. There is no automatic signal for a
// private lobby, so the mark is manual; these rules say which game may carry it.

/** The game a tournament marks as being played right now. */
export interface LiveMark {
  matchId: number;
  gameNumber: number;
  /** ISO UTC instant the admin marked it. */
  startedAt: string;
}

/**
 * Null when `gameNumber` of the match can be marked live; otherwise why not. It must be the next unplayed game of a
 * series that is not decided yet, and the match needs both teams.
 */
export function liveEligibility(
  team1Id: number | null,
  team2Id: number | null,
  length: SeriesLength,
  games: readonly GameScore[],
  gameNumber: number,
): string | null {
  if (team1Id === null || team2Id === null) return 'El partido todavía no tiene los dos equipos definidos.';
  if (!Number.isInteger(gameNumber) || gameNumber < 1 || gameNumber > length) return 'Ese juego no existe.';
  if (games.some((g) => g.gameNumber === gameNumber)) return 'Ese juego ya tiene resultado.';
  const series = resolveSeries(team1Id, team2Id, length, games);
  if (series.decided) return 'La serie ya está decidida.';
  if (series.nextGame !== gameNumber) return `Marca primero el juego ${series.nextGame}: los juegos se juegan en orden.`;
  return null;
}
