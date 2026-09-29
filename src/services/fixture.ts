import type { Match, MatchEdit, NewMatch, Repository, Tournament } from '../db/repository.js';
import { assignSchedule, generateRoundRobin, type DaySlots } from '../domain/fixture.js';
import type { StandingRow } from '../domain/standings.js';

/** A problem the admin can fix; its message is shown as-is (Spanish). */
export class FixtureError extends Error {}

const DEFAULT_SLOT_MINUTES = 60;

export interface RegenerateResult {
  rounds: number;
  matches: number;
  /** False when the calendar has no group days, so matches have no date/time. */
  scheduled: boolean;
}

/**
 * Replaces every group match with a freshly generated round-robin (one or two
 * legs, from the tournament rules) scheduled on the group days of the calendar.
 * Playoff matches are dropped because they depend on the standings.
 */
export function regenerateFixture(repo: Repository, tournament: Tournament): RegenerateResult {
  const teams = repo.listTeams(tournament.id);
  if (teams.length < 2) throw new FixtureError('Se necesitan al menos 2 equipos para generar el fixture.');

  const rounds = generateRoundRobin(
    teams.map((t) => t.id),
    tournament.groupLegs,
  );
  const days: DaySlots[] = repo
    .listScheduleDays(tournament.id)
    .filter((d) => d.phase === 'group')
    .map((d) => ({ date: d.date, startTimes: d.startTimes, slotMinutes: d.slotMinutes }));

  const freeSlots = days.reduce((sum, d) => sum + d.startTimes.length, 0);
  if (days.length > 0 && freeSlots < rounds.length) {
    throw new FixtureError(
      `No hay suficientes horarios en el calendario: el fixture necesita ${rounds.length} rondas y los días de grupos solo tienen ${freeSlots} horarios. Agrega horarios en Configuración.`,
    );
  }
  const slots = days.length > 0 ? assignSchedule(rounds, days, DEFAULT_SLOT_MINUTES) : null;

  const matches: NewMatch[] = [];
  for (const [index, round] of rounds.entries()) {
    const slot = slots?.[index];
    for (const [team1Id, team2Id] of round.matches) {
      matches.push({
        tournamentId: tournament.id,
        phase: 'group',
        round: round.round,
        matchNumber: matches.length + 1,
        scheduledDate: slot?.date ?? null,
        startTime: slot?.startTime ?? null,
        endTime: slot?.endTime ?? null,
        team1Id,
        team2Id,
      });
    }
  }
  repo.replaceGroupMatches(tournament.id, matches, { clearPlayoffs: true });
  return { rounds: rounds.length, matches: matches.length, scheduled: slots !== null };
}

/** Adds an empty match to an existing round, inheriting the round's date and time. */
export function addBlankMatch(repo: Repository, tournamentId: number, round: number): Match {
  const group = repo.listMatches(tournamentId, 'group');
  const sibling = group.find((m) => m.round === round);
  const match = repo.createMatch({
    tournamentId,
    phase: 'group',
    round,
    matchNumber: group.reduce((max, m) => Math.max(max, m.matchNumber), 0) + 1,
    scheduledDate: sibling?.scheduledDate ?? null,
    startTime: sibling?.startTime ?? null,
    endTime: sibling?.endTime ?? null,
  });
  repo.renumberGroupMatches(tournamentId);
  return repo.getMatch(match.id)!;
}

/** Adds a new round after the last one, holding one empty match. */
export function addRound(repo: Repository, tournamentId: number): Match {
  return addBlankMatch(repo, tournamentId, repo.maxRound(tournamentId, 'group') + 1);
}

/**
 * Applies a manual edit. Changing the teams of a played match discards its
 * result, because kills/deaths belong to the previous sides.
 */
export function editMatch(repo: Repository, match: Match, edit: MatchEdit): { match: Match; resultCleared: boolean } {
  const resultCleared = match.winnerId !== null && (edit.team1Id !== match.team1Id || edit.team2Id !== match.team2Id);
  if (resultCleared) repo.clearResult(match.id);
  repo.updateMatch(match.id, edit);
  if (match.phase === 'group' && edit.round !== match.round) repo.renumberGroupMatches(match.tournamentId);
  return { match: repo.getMatch(match.id)!, resultCleared };
}

/** The first two teams tied across the qualification cutoff, if the standings need a tiebreak match. */
export function tiedTeamIds(standings: StandingRow[]): [number, number] | null {
  const tied = standings.filter((r) => r.status === 'tiebreak' && r.unresolvedTie);
  return tied.length >= 2 ? [tied[0]!.teamId, tied[1]!.teamId] : null;
}
