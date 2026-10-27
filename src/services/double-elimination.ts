import { fail, ok, type Checked } from '../checked.js';
import type { Match, Repository, Tournament } from '../db/repository.js';
import {
  buildDoubleElimination,
  DE_SLOTS,
  deSlotForKey,
  POSITIONS,
  POSITION_SEATS,
  type DeSeries,
  type DeSlot,
  type DeSlotKey,
  type DoubleEliminationBracket,
} from '../domain/double-elimination.js';
import { liveEligibility } from '../domain/live.js';
import { seriesLengthFor } from '../domain/series.js';
import { deleteGameResult, saveGameResult, type ImportChoice } from './games.js';
import { markLive } from './live.js';
import { validateResult, type RawResult } from './results.js';

// The admin side of a double-elimination tournament. Positions A–F are the only teams typed by hand; every other
// seat follows from results (domain/double-elimination.ts). After any change the stored series are repaired so a
// series whose seats moved loses its games: a changed or removed result clears everything that depended on it.

const SLOT_KEYS = new Set<string>(DE_SLOTS.map((s) => s.key));
export const isDeSlotKey = (value: string): value is DeSlotKey => SLOT_KEYS.has(value);

const bracketMatches = (repo: Repository, tournamentId: number): Match[] =>
  repo.listMatches(tournamentId).filter((m) => m.phase !== 'group');

const storedFor = (matches: Match[], slot: Pick<DeSlot, 'phase' | 'matchNumber'>): Match | undefined =>
  matches.find((m) => m.phase === slot.phase && m.matchNumber === slot.matchNumber);

/** The bracket as the stored matches make it right now. */
export function currentBracket(repo: Repository, tournament: Tournament): DoubleEliminationBracket {
  return buildDoubleElimination(bracketMatches(repo, tournament.id));
}

/** Creates the ten series (once), unscheduled: the whole bracket is played the same day, in order. */
export function ensureBracketMatches(repo: Repository, tournament: Tournament): Match[] {
  const existing = bracketMatches(repo, tournament.id);
  for (const slot of DE_SLOTS) {
    if (storedFor(existing, slot)) continue;
    repo.createMatch({ tournamentId: tournament.id, phase: slot.phase, round: slot.round, matchNumber: slot.matchNumber });
  }
  return bracketMatches(repo, tournament.id);
}

/**
 * Brings the stored series in line with the bracket: every series whose stored teams are no longer its seats loses
 * its games and takes the derived teams (or none). Clearing one can make a later one stale, so it repeats in bracket
 * order until nothing is stale.
 */
export function repairBracket(repo: Repository, tournament: Tournament): void {
  for (let pass = 0; pass <= DE_SLOTS.length; pass++) {
    const stale = currentBracket(repo, tournament).series.find((s) => s.stale && s.matchId !== null);
    if (!stale) return;
    repo.clearResult(stale.matchId!);
    repo.updateMatchTeams(stale.matchId!, stale.team1Id, stale.team2Id);
  }
}

/** Places six distinct teams of this tournament in positions A–F (in that order). */
export function assignPositions(repo: Repository, tournament: Tournament, ids: readonly number[]): Checked<true> {
  if (ids.length !== POSITIONS.length || !ids.every((id) => Number.isInteger(id))) return fail('Elige los seis equipos de las posiciones A a F.');
  const valid = new Set(repo.listTeams(tournament.id).map((t) => t.id));
  if (!ids.every((id) => valid.has(id))) return fail('Elige equipos de este torneo para las posiciones.');
  if (new Set(ids).size !== POSITIONS.length) return fail('Los seis equipos de las posiciones deben ser distintos.');

  const matches = ensureBracketMatches(repo, tournament);
  // The new stored pair of every series fed by a position; the other seat (a derived one) stays as stored.
  const pairs = new Map<DeSlotKey, [number | null, number | null]>();
  POSITIONS.forEach((position, i) => {
    const { key, seat } = POSITION_SEATS[position];
    const match = storedFor(matches, deSlotForKey(key))!;
    const pair = pairs.get(key) ?? [match.team1Id, match.team2Id];
    pair[seat - 1] = ids[i]!;
    pairs.set(key, pair);
  });
  for (const [key, [team1Id, team2Id]] of pairs) {
    const match = storedFor(matches, deSlotForKey(key))!;
    if (match.team1Id === team1Id && match.team2Id === team2Id) continue;
    repo.clearResult(match.id);
    repo.updateMatchTeams(match.id, team1Id, team2Id);
  }
  repairBracket(repo, tournament);
  return ok(true);
}

const NOT_FOUND = 'Serie de las llaves no encontrada.';

/** The series and its stored match, with the stored teams aligned to its seats (a realignment drops its games). */
function alignedMatch(repo: Repository, tournament: Tournament, series: DeSeries): Match {
  const matches = ensureBracketMatches(repo, tournament);
  let match = storedFor(matches, series)!;
  if (match.team1Id !== series.team1Id || match.team2Id !== series.team2Id) {
    repo.clearResult(match.id);
    match = repo.updateMatchTeams(match.id, series.team1Id, series.team2Id);
  }
  return match;
}

const findSeries = (repo: Repository, tournament: Tournament, key: string): DeSeries | undefined =>
  isDeSlotKey(key) ? currentBracket(repo, tournament).series.find((s) => s.key === key) : undefined;

/** Records one game of a series; later series that depended on its previous outcome are cleared. */
export function recordBracketResult(
  repo: Repository,
  tournament: Tournament,
  key: string,
  raw: RawResult,
  options: { gameNumber?: number; imported?: ImportChoice } = {},
): Checked<Match> {
  const series = findSeries(repo, tournament, key);
  if (!series) return fail(NOT_FOUND);
  const checked = validateResult([series.team1Id, series.team2Id], raw);
  if (!checked.ok) return checked;
  const match = alignedMatch(repo, tournament, series);
  const saved = saveGameResult(repo, tournament, match, options.gameNumber ?? 1, raw, options.imported);
  if (!saved.ok) return saved;
  repairBracket(repo, tournament);
  return ok(repo.getMatch(saved.value.id) ?? saved.value);
}

/** Marks a game of a series as live; the series' teams are stored first, like a result would. */
export function markBracketLive(repo: Repository, tournament: Tournament, key: string, gameNumber: number, now: Date): Checked<void> {
  const series = findSeries(repo, tournament, key);
  if (!series) return fail(NOT_FOUND);
  if (series.team1Id === null || series.team2Id === null) return fail('El partido todavía no tiene los dos equipos definidos.');
  // Validate first, against what the series will look like after the teams are aligned: a refusal changes nothing.
  const existing = series.matchId === null ? undefined : repo.getMatch(series.matchId);
  const realigned = !existing || existing.team1Id !== series.team1Id || existing.team2Id !== series.team2Id;
  const refusal = liveEligibility(
    series.team1Id,
    series.team2Id,
    seriesLengthFor(tournament, series.phase, false),
    realigned ? [] : repo.listGames(existing.id),
    gameNumber,
  );
  if (refusal) return fail(refusal);
  return markLive(repo, tournament, alignedMatch(repo, tournament, series), gameNumber, now);
}

/** Removes one game of a series (the last one loaded) and clears what depended on it. */
export function deleteBracketGame(repo: Repository, tournament: Tournament, key: string, gameNumber: number): Checked<Match> {
  if (!isDeSlotKey(key)) return fail(NOT_FOUND);
  const match = storedFor(ensureBracketMatches(repo, tournament), deSlotForKey(key))!;
  const removed = deleteGameResult(repo, tournament, match, gameNumber);
  if (removed.ok) repairBracket(repo, tournament);
  return removed;
}

/** Drops every game of a series and clears what depended on it. */
export function clearBracketSeries(repo: Repository, tournament: Tournament, key: string): Checked<true> {
  if (!isDeSlotKey(key)) return fail(NOT_FOUND);
  const match = storedFor(ensureBracketMatches(repo, tournament), deSlotForKey(key))!;
  repo.clearResult(match.id);
  repairBracket(repo, tournament);
  return ok(true);
}

/** Deletes the ten series with their teams and games: the positions start empty again. */
export function resetBracket(repo: Repository, tournament: Tournament): void {
  repo.deleteMatches(tournament.id, 'semifinal');
  repo.deleteMatches(tournament.id, 'final');
}
