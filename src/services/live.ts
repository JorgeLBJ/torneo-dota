import { fail, ok, type Checked } from '../checked.js';
import type { Match, Repository, Tournament } from '../db/repository.js';
import { liveEligibility } from '../domain/live.js';
import { seriesLengthFor } from '../domain/series.js';

/**
 * Marks a game of a match as being played right now. Only the next unplayed game of an undecided series can be live;
 * any number of matches can be live at once, but each has one live game. Marking the game that is already live keeps
 * the moment it started.
 */
export function markLive(repo: Repository, tournament: Tournament, match: Match, gameNumber: number, now: Date): Checked<void> {
  if (match.tournamentId !== tournament.id) return fail('Partido no encontrado.');
  const reason = liveEligibility(match.team1Id, match.team2Id, seriesLengthFor(tournament, match.phase, match.isTiebreak), repo.listGames(match.id), gameNumber);
  if (reason) return fail(reason);
  const current = repo.listLive(tournament.id).find((mark) => mark.matchId === match.id);
  if (current?.gameNumber === gameNumber) return ok(undefined);
  repo.setLive(match.id, { gameNumber, startedAt: now.toISOString() });
  return ok(undefined);
}

/**
 * Clears the live mark only when it is still this match and game: a stale button (the game was saved or another
 * game marked since the page was drawn) must not switch off a game it never showed. Returns whether anything was
 * cleared. Clearing the stream match's mark also takes it off the stream.
 */
export function clearLive(repo: Repository, tournament: Tournament, matchId: number | null, gameNumber: number): boolean {
  const current = repo.listLive(tournament.id).find((mark) => mark.matchId === matchId);
  if (!current || current.gameNumber !== gameNumber || matchId === null) return false;
  repo.setLive(matchId, null);
  return true;
}

/** Puts a live match on the stream; the previous one (if any) is replaced. */
export function setStream(repo: Repository, tournament: Tournament, matchId: number | null): Checked<void> {
  const live = repo.listLive(tournament.id).some((mark) => mark.matchId === matchId);
  if (matchId === null || !live) return fail('Solo se puede pasar al stream una partida en vivo.');
  repo.setStream(tournament.id, matchId);
  return ok(undefined);
}

export function clearStream(repo: Repository, tournament: Tournament): void {
  repo.setStream(tournament.id, null);
}

/** Takes a match off the stream only when it is still the one there (a stale button must not remove another). */
export function unstreamMatch(repo: Repository, tournament: Tournament, matchId: number | null): boolean {
  const current = repo.getTournamentById(tournament.id)?.streamMatchId ?? null;
  if (matchId === null || current !== matchId) return false;
  repo.setStream(tournament.id, null);
  return true;
}
