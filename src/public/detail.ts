import type { Game, Match, Team } from '../db/repository.js';
import { resolveEmblem, type EmblemSources } from '../domain/emblem.js';
import { resolveSeries, seriesLengthFor } from '../domain/series.js';
import type { DotaSnapshot } from '../dota/snapshot.js';
import type { TournamentState } from '../services/state.js';

// The JSON behind "Ver detalle de la partida": what the public modal shows about a match and its games.

export type DetailEmblem = { kind: 'image'; src: string; src2x: string } | { kind: 'hero'; src: string } | { kind: 'tile' };

export interface DetailTeam {
  id: number;
  name: string;
  code: string;
  emblem: DetailEmblem;
}

export interface DetailGame {
  number: number;
  winnerId: number;
  /** [team 1, team 2] */
  kills: [number, number];
  deaths: [number, number];
  /** The team that played Radiant, when the game was imported. */
  radiantTeamId: number | null;
  dota: DotaSnapshot | null;
}

export interface MatchDetail {
  matchId: number;
  title: string;
  teams: [DetailTeam, DetailTeam];
  /** null for a single game. */
  series: { length: number; wins: [number, number]; winnerId: number | null } | null;
  games: DetailGame[];
}

const titleOf = (match: Match): string =>
  match.phase === 'final' ? 'Gran final' : match.phase === 'semifinal' ? `Semifinal ${match.matchNumber}` : `Partido ${match.matchNumber}`;

function toTeam(team: Team, sources: EmblemSources): DetailTeam {
  const emblem = resolveEmblem(team, sources);
  return {
    id: team.id,
    name: team.name,
    code: team.code,
    emblem: emblem.kind === 'image' ? emblem : emblem.kind === 'hero' ? emblem : { kind: 'tile' },
  };
}

function parseSnapshot(text: string | null): DotaSnapshot | null {
  if (text === null) return null;
  try {
    const value = JSON.parse(text) as DotaSnapshot;
    return Array.isArray(value?.players) && value.players.length === 10 ? value : null;
  } catch {
    return null;
  }
}

/** Null when the match has no two teams. `games` must carry their snapshots (see Repository.listGames). */
export function buildMatchDetail(state: TournamentState, match: Match, games: readonly Game[], sources: EmblemSources): MatchDetail | null {
  const team1 = match.team1Id === null ? undefined : state.teamsById.get(match.team1Id);
  const team2 = match.team2Id === null ? undefined : state.teamsById.get(match.team2Id);
  if (!team1 || !team2) return null;
  const length = seriesLengthFor(state.tournament, match.phase, match.isTiebreak);
  const resolved = resolveSeries(team1.id, team2.id, length, games);
  return {
    matchId: match.id,
    title: titleOf(match),
    teams: [toTeam(team1, sources), toTeam(team2, sources)],
    series: length === 1 ? null : { length, wins: resolved.wins, winnerId: resolved.winnerId },
    games: games.map((g) => ({
      number: g.gameNumber,
      winnerId: g.winnerId,
      kills: [g.team1Kills, g.team2Kills],
      deaths: [g.team1Deaths, g.team2Deaths],
      radiantTeamId: g.radiantTeamId,
      dota: parseSnapshot(g.dotaSnapshot),
    })),
  };
}
