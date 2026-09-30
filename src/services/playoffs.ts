import { fail, ok, type Checked } from '../checked.js';
import type { Match, Phase, Repository, Schedule, Tournament } from '../db/repository.js';
import { addMinutes } from '../domain/fixture.js';
import { validateResult, type RawResult } from './results.js';
import type { TournamentState } from './state.js';

type PlayoffPhase = Extract<Phase, 'semifinal' | 'final'>;

const WANTED: { phase: PlayoffPhase; number: number }[] = [
  { phase: 'semifinal', number: 1 },
  { phase: 'semifinal', number: 2 },
  { phase: 'final', number: 1 },
];

/** Calendar slots of one phase, flattened in play order. */
export function phaseSlots(repo: Repository, tournamentId: number, phase: PlayoffPhase): Schedule[] {
  return repo
    .listScheduleDays(tournamentId)
    .filter((d) => d.phase === phase)
    .flatMap((d) =>
      d.startTimes.map((startTime) => ({
        scheduledDate: d.date,
        startTime,
        endTime: addMinutes(startTime, d.slotMinutes),
      })),
    );
}

/** Creates the two semifinals and the final (once), scheduled from the calendar. */
export function ensurePlayoffMatches(repo: Repository, tournament: Tournament): Match[] {
  const existing = repo.listMatches(tournament.id).filter((m) => m.phase !== 'group');
  for (const { phase, number } of WANTED) {
    if (existing.some((m) => m.phase === phase && m.matchNumber === number)) continue;
    const slot = phaseSlots(repo, tournament.id, phase)[number - 1];
    repo.createMatch({
      tournamentId: tournament.id,
      phase,
      round: 1,
      matchNumber: number,
      scheduledDate: slot?.scheduledDate ?? null,
      startTime: slot?.startTime ?? null,
      endTime: slot?.endTime ?? null,
    });
  }
  return repo.listMatches(tournament.id).filter((m) => m.phase !== 'group');
}

const findMatch = (matches: Match[], phase: PlayoffPhase, number: number) =>
  matches.find((m) => m.phase === phase && m.matchNumber === number);

/** Drops the final's result and derived teams (they depend on the semifinal winners). */
function resetFinal(repo: Repository, matches: Match[]): void {
  const final = findMatch(matches, 'final', 1);
  if (!final) return;
  repo.clearResult(final.id);
  repo.updateMatchTeams(final.id, null, null);
}

/** Manually sets the four semifinal teams (SF1: a v b, SF2: c v d), discarding playoff results. */
export function assignSemifinalTeams(
  repo: Repository,
  tournament: Tournament,
  ids: [number, number, number, number],
): Checked<true> {
  const valid = new Set(repo.listTeams(tournament.id).map((t) => t.id));
  if (!ids.every((id) => valid.has(id))) return fail('Elige equipos de este torneo para las semifinales.');
  if (new Set(ids).size !== 4) return fail('Los cuatro equipos de las semifinales deben ser distintos.');

  const matches = ensurePlayoffMatches(repo, tournament);
  for (const number of [1, 2]) {
    const match = findMatch(matches, 'semifinal', number)!;
    repo.clearResult(match.id);
    repo.updateMatchTeams(match.id, ids[(number - 1) * 2]!, ids[(number - 1) * 2 + 1]!);
  }
  resetFinal(repo, matches);
  return ok(true);
}

/** Records a semifinal/final result. Teams come from the derived bracket and are stored with the result. */
export function recordPlayoffResult(
  repo: Repository,
  tournament: Tournament,
  state: TournamentState,
  phase: PlayoffPhase,
  number: number,
  raw: RawResult,
): Checked<Match> {
  const slot = phase === 'final' ? (number === 1 ? state.bracket.final : undefined) : state.bracket.semifinals[number - 1];
  if (!slot) return fail('Partido de playoffs no encontrado.');
  const checked = validateResult([slot.team1Id, slot.team2Id], raw);
  if (!checked.ok) return checked;

  const matches = ensurePlayoffMatches(repo, tournament);
  const match = findMatch(matches, phase, number)!;
  const winnerChanged = match.winnerId !== checked.value.winnerId;
  if (match.team1Id !== slot.team1Id || match.team2Id !== slot.team2Id) {
    repo.clearResult(match.id);
    repo.updateMatchTeams(match.id, slot.team1Id, slot.team2Id);
  }
  const saved = repo.recordResult(match.id, checked.value);
  if (phase === 'semifinal' && winnerChanged) resetFinal(repo, matches);
  return ok(saved);
}

/**
 * Drops the semifinal and final matches (teams, dates and results with them), so the bracket goes back to
 * automatic seeding from the table. They are recreated on demand from the calendar.
 */
export function resetPlayoffs(repo: Repository, tournament: Tournament): void {
  repo.deleteMatches(tournament.id, 'semifinal');
  repo.deleteMatches(tournament.id, 'final');
}

export function clearPlayoffResult(repo: Repository, tournament: Tournament, phase: PlayoffPhase, number: number): void {
  const matches = ensurePlayoffMatches(repo, tournament);
  const match = findMatch(matches, phase, number);
  if (!match) return;
  repo.clearResult(match.id);
  if (phase === 'semifinal') resetFinal(repo, matches);
}
