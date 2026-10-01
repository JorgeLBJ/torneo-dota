import type { Game, Match, Repository, Team, Tournament } from '../db/repository.js';
import type { LiveMark } from '../domain/live.js';
import { buildPlayoffs, type Bracket, type PlayoffMatch } from '../domain/playoffs.js';
import { computeStandings, type StandingRow } from '../domain/standings.js';

export interface TournamentState {
  tournament: Tournament;
  teams: Team[];
  teamsById: Map<number, Team>;
  /** Regular group matches only: the fixture proper. */
  groupMatches: Match[];
  /** Extra games played to break ties. */
  tiebreakMatches: Match[];
  /** Both, in match order. */
  allGroupMatches: Match[];
  playoffMatches: Match[];
  standings: StandingRow[];
  bracket: Bracket;
  /** The games of every match, in game order. */
  gamesByMatch: Map<number, Game[]>;
  /** The games being played right now: the one on the stream first, then by the moment they were marked. */
  liveMarks: LiveMark[];
  /** Group matches without a recorded winner. */
  pendingGroup: number;
  groupComplete: boolean;
}

/** Loads everything derived from a tournament's stored data; nothing derived is persisted. */
export function loadState(repo: Repository, tournament: Tournament): TournamentState {
  const teams = repo.listTeams(tournament.id);
  const all = repo.listMatches(tournament.id);
  const allGroupMatches = all.filter((m) => m.phase === 'group');
  const groupMatches = allGroupMatches.filter((m) => !m.isTiebreak);
  const tiebreakMatches = allGroupMatches.filter((m) => m.isTiebreak);
  const playoffMatches = all.filter((m) => m.phase !== 'group');
  const standings = computeStandings(teams, allGroupMatches, tournament.qualifiers, {
    pointsWin: tournament.pointsWin,
    pointsLoss: tournament.pointsLoss,
    tiebreakers: tournament.tiebreakers,
  });
  const bracket = buildPlayoffs(
    standings,
    playoffMatches.map(
      (m): PlayoffMatch => ({
        id: m.id,
        phase: m.phase as 'semifinal' | 'final',
        matchNumber: m.matchNumber,
        team1Id: m.team1Id,
        team2Id: m.team2Id,
        winnerId: m.winnerId,
      }),
    ),
  );
  const gamesByMatch = new Map<number, Game[]>();
  for (const game of repo.listTournamentGames(tournament.id)) {
    const list = gamesByMatch.get(game.matchId) ?? [];
    list.push(game);
    gamesByMatch.set(game.matchId, list);
  }
  const pendingGroup = groupMatches.filter((m) => m.winnerId === null).length;
  return {
    tournament,
    teams,
    teamsById: new Map(teams.map((t) => [t.id, t])),
    groupMatches,
    tiebreakMatches,
    allGroupMatches,
    playoffMatches,
    standings,
    bracket,
    gamesByMatch,
    liveMarks: repo.listLive(tournament.id),
    pendingGroup,
    groupComplete: groupMatches.length > 0 && pendingGroup === 0,
  };
}

export interface StatusLabel {
  label: string;
  cls: 'ok' | 'next' | '';
}

export function describeStatus(state: TournamentState): StatusLabel {
  const { bracket, teamsById } = state;
  if (bracket.championId !== null) {
    const champion = teamsById.get(bracket.championId);
    return { label: `Finalizado · Campeón ${champion?.code ?? ''}`.trim(), cls: 'ok' };
  }
  if (state.groupMatches.length === 0) return { label: 'Sin fixture', cls: '' };
  if (!state.groupComplete) return { label: 'Fase de grupos', cls: 'next' };
  return { label: 'Playoffs', cls: 'next' };
}
