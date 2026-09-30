import { fail, ok, type Checked } from '../checked.js';
import type { Game, Match, Repository, Tournament } from '../db/repository.js';
import { gameFromSnapshot, lookupDotaMatch } from '../dota/import.js';
import type { DotaMatchSource } from '../dota/source.js';
import { seriesLengthFor, validateSeries, type GameScore } from '../domain/series.js';
import { validateResult, type RawResult } from './results.js';

/** Data that comes from importing the game from Dota, stored with the game. */
export interface GameImport {
  radiantTeamId: number;
  dotaMatchId: number;
  /** Compact JSON of the imported match (never the raw payload). */
  snapshot: string;
}

/** `keep`: the game keeps the import it already has, as long as its numbers are not changed by hand. */
export type ImportChoice = GameImport | 'keep' | undefined;

const toScore = (game: Game): GameScore => game;

/**
 * Saves one game of a match's series after checking it with the existing result rules and the series rules
 * (game numbers in order, none after the decider). The match's winner, kills and deaths follow from its games.
 */
export function saveGameResult(
  repo: Repository,
  tournament: Tournament,
  match: Match,
  gameNumber: number,
  raw: RawResult,
  imported?: ImportChoice,
): Checked<Match> {
  const checked = validateResult([match.team1Id, match.team2Id], raw);
  if (!checked.ok) return checked;
  const result = checked.value;
  const team1 = match.team1Id!;
  const team2 = match.team2Id!;

  const existing = repo.listGames(match.id);
  const length = seriesLengthFor(tournament, match.phase, match.isTiebreak);
  const score: GameScore = { gameNumber, ...result };
  const error = validateSeries(team1, team2, length, [...existing.filter((g) => g.gameNumber !== gameNumber).map(toScore), score]);
  if (error) return fail(error);

  let dota: GameImport | null = null;
  if (imported === 'keep') {
    const current = existing.find((g) => g.gameNumber === gameNumber);
    const unchanged =
      current !== undefined &&
      current.winnerId === result.winnerId &&
      current.team1Kills === result.team1Kills &&
      current.team1Deaths === result.team1Deaths &&
      current.team2Kills === result.team2Kills &&
      current.team2Deaths === result.team2Deaths;
    if (unchanged && current.dotaMatchId !== null && current.dotaSnapshot !== null && current.radiantTeamId !== null) {
      dota = { radiantTeamId: current.radiantTeamId, dotaMatchId: current.dotaMatchId, snapshot: current.dotaSnapshot };
    }
  } else if (imported) {
    if (imported.radiantTeamId !== team1 && imported.radiantTeamId !== team2) {
      return fail('El equipo Radiant debe ser uno de los dos equipos del partido.');
    }
    dota = imported;
  }

  const saved = repo.saveGame(match.id, {
    gameNumber,
    ...result,
    radiantTeamId: dota?.radiantTeamId ?? null,
    dotaMatchId: dota?.dotaMatchId ?? null,
    dotaSnapshot: dota?.snapshot ?? null,
    importedAt: dota ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
  });
  return ok(saved);
}

/** Removes one game. A game that has later games cannot go first. */
export function deleteGameResult(repo: Repository, tournament: Tournament, match: Match, gameNumber: number): Checked<Match> {
  void tournament;
  const games = repo.listGames(match.id);
  if (!games.some((g) => g.gameNumber === gameNumber)) return fail('Ese juego no tiene resultado.');
  if (games.some((g) => g.gameNumber > gameNumber)) return fail('Borra primero los juegos siguientes.');
  return ok(repo.deleteGame(match.id, gameNumber));
}

/** What the game form says about a Dota import. */
export interface ImportFields {
  /** The Match ID as typed ('' when the game is manual). */
  dotaMatchId: string;
  /** The team id chosen as Radiant. */
  radiant: string;
  /** The form carries the import the game already has. */
  keep: boolean;
}

const MISMATCH = 'Los datos no coinciden con la partida de Dota: pulsa «Autocompletar» de nuevo o quita el Match ID.';

/**
 * Turns the import part of a game form into what is stored with the game. The match is looked up again (from the
 * source's short cache) and the submitted numbers must be the ones it produces: the public detail can never
 * contradict the score shown next to it.
 */
export async function prepareGameImport(
  source: DotaMatchSource,
  teams: [number | null, number | null],
  raw: RawResult,
  fields: ImportFields,
): Promise<Checked<ImportChoice>> {
  if (fields.dotaMatchId.trim() === '') return ok(fields.keep ? 'keep' : undefined);
  const result = validateResult(teams, raw);
  if (!result.ok) return result;
  const [team1, team2] = teams as [number, number];
  const radiant = /^\d+$/.test(fields.radiant) ? Number(fields.radiant) : null;
  if (radiant === null || (radiant !== team1 && radiant !== team2)) {
    return fail('Indica qué equipo jugó de Radiant (pulsa «Buscar» y elige).');
  }
  const found = await lookupDotaMatch(source, fields.dotaMatchId);
  if (!found.ok) return found;
  const expected = gameFromSnapshot(found.value, radiant, team1, team2);
  const given = result.value;
  const same =
    expected.winnerId === given.winnerId &&
    expected.team1Kills === given.team1Kills &&
    expected.team1Deaths === given.team1Deaths &&
    expected.team2Kills === given.team2Kills &&
    expected.team2Deaths === given.team2Deaths;
  if (!same) return fail(MISMATCH);
  return ok({ radiantTeamId: radiant, dotaMatchId: found.value.matchId, snapshot: JSON.stringify(found.value) });
}
