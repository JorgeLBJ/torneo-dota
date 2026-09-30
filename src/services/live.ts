import { fail, ok, type Checked } from '../checked.js';
import type { Match, Repository, Tournament } from '../db/repository.js';
import { liveEligibility } from '../domain/live.js';
import { seriesLengthFor } from '../domain/series.js';

/**
 * Marks a game of a match as the one being played right now. Only the next unplayed game of an undecided series can
 * be live, and only one game per tournament: marking another replaces the current one. Marking the game that is
 * already live keeps the moment it started.
 */
export function markLive(repo: Repository, tournament: Tournament, match: Match, gameNumber: number, now: Date): Checked<void> {
  if (match.tournamentId !== tournament.id) return fail('Partido no encontrado.');
  const reason = liveEligibility(match.team1Id, match.team2Id, seriesLengthFor(tournament, match.phase, match.isTiebreak), repo.listGames(match.id), gameNumber);
  if (reason) return fail(reason);
  const current = repo.getTournamentById(tournament.id)?.live;
  if (current?.matchId === match.id && current.gameNumber === gameNumber) return ok(undefined);
  repo.setLive(tournament.id, { matchId: match.id, gameNumber, startedAt: now.toISOString() });
  return ok(undefined);
}

/**
 * Clears the live mark only when it is still this match and game: a stale button (another match was marked since
 * the page was drawn) must not switch off a game it never showed. Returns whether anything was cleared.
 */
export function clearLive(repo: Repository, tournament: Tournament, matchId: number | null, gameNumber: number): boolean {
  const current = repo.getTournamentById(tournament.id)?.live;
  if (!current || matchId === null || current.matchId !== matchId || current.gameNumber !== gameNumber) return false;
  repo.setLive(tournament.id, null);
  return true;
}
