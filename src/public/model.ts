import type { Game, Match, ScheduleDay, Team, TiebreakerKey } from '../db/repository.js';
import type { LiveMark } from '../domain/live.js';
import { resolveSeries, seriesLengthFor, type SeriesLength } from '../domain/series.js';
import { describeStream, type StreamView } from '../domain/stream.js';
import { zonedToUtc } from '../format/timezone.js';
import type { QualificationStatus, StandingRow } from '../domain/standings.js';
import { rulebookHtmlOf } from '../rulebook.js';
import type { TournamentState } from '../services/state.js';

// Pure view model of the public page: everything the templates need, already derived and formatted.

const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MONTHS_LONG = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const DAY_LABEL = new Intl.DateTimeFormat('es', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'UTC' });

const NO_DATE = 'Por definir';

const parts = (date: string) => {
  const [y, m, d] = date.split('-');
  return { year: y!, month: Number(m) - 1, day: d! };
};

/** "03 y 10 Oct", "03, 10 y 17 Oct", "30 Sep y 03 Oct"; days of the same month share the month name. */
export function formatDayList(dates: string[]): string {
  const sorted = [...new Set(dates)].sort();
  if (sorted.length === 0) return NO_DATE;
  const byMonth = new Map<string, { month: string; days: string[] }>();
  for (const date of sorted) {
    const { year, month, day } = parts(date);
    const key = `${year}-${month}`;
    const entry = byMonth.get(key) ?? { month: MONTHS_SHORT[month]!, days: [] };
    entry.days.push(day);
    byMonth.set(key, entry);
  }
  const groups = [...byMonth.values()].map(({ month, days }) => {
    const list = days.length === 1 ? days[0]! : `${days.slice(0, -1).join(', ')} y ${days[days.length - 1]}`;
    return `${list} ${month}`;
  });
  return groups.length === 1 ? groups[0]! : `${groups.slice(0, -1).join(', ')} y ${groups[groups.length - 1]}`;
}

export const shortDate = (date: string) => {
  const { month, day } = parts(date);
  return `${day} ${MONTHS_SHORT[month]}`;
};

const points = (n: number) => `${n} ${n === 1 ? 'pt' : 'pts'}`;

/** The running or final state of a match that is played over several games. */
export interface PublicSeries {
  length: SeriesLength;
  /** Game wins of [team A, team B]. */
  wins: [number, number];
  decided: boolean;
  games: { number: number; winnerId: number }[];
}

/** Series of a match, or null for a single game (best of 1) and for a match without teams. */
export function buildSeries(state: TournamentState, match: Match): PublicSeries | null {
  const length = seriesLengthFor(state.tournament, match.phase, match.isTiebreak);
  if (length === 1 || match.team1Id === null || match.team2Id === null) return null;
  const games = state.gamesByMatch.get(match.id) ?? [];
  const resolved = resolveSeries(match.team1Id, match.team2Id, length, games);
  return {
    length,
    wins: resolved.wins,
    decided: resolved.decided,
    games: games.map((g: Game) => ({ number: g.gameNumber, winnerId: g.winnerId })),
  };
}

/** True when at least one game of the match was imported from a Dota match (the detail modal has data). */
export const hasDetail = (state: TournamentState, matchId: number): boolean =>
  (state.gamesByMatch.get(matchId) ?? []).some((g) => g.dotaMatchId !== null);

/** The game being played right now (marked by the admin), ready for the strip and the notice. */
export interface PublicLive {
  matchId: number;
  phase: Match['phase'];
  teamA: Team;
  teamB: Team;
  /** "2.º de grupos" once the table has results, otherwise empty. */
  subtitleA: string;
  subtitleB: string;
  /** "Semifinal 2 · Juego 3 de 3", "Gran final · Juego 1 de 5", "Ronda 4 · Partido 11". */
  label: string;
  gameNumber: number;
  /** Null for a single game. */
  series: PublicSeries | null;
  /** ISO UTC instant the admin marked it. */
  startedAt: string;
  /** This is the match on the stream (at most one live match is). */
  inStream: boolean;
}

export interface PublicMatch {
  id: number;
  number: number;
  round: number;
  teamA: Team | null;
  teamB: Team | null;
  played: boolean;
  /** ISO UTC start, or null while unscheduled. */
  startsAt: string | null;
  winnerId: number | null;
  kills: [number, number] | null;
  deaths: [number, number] | null;
  isNext: boolean;
  /** An extra game to break a tie (shown tagged, never counted in the progress). */
  isTiebreak: boolean;
  series: PublicSeries | null;
  hasDetail: boolean;
  /** The game being played now when this match is live, otherwise null. */
  liveGame: number | null;
  /** This live match is the one on the stream. */
  inStream: boolean;
}

export interface PublicRound {
  number: number;
  startTime: string | null;
  endTime: string | null;
  /** ISO UTC instants of the round (its first scheduled match). */
  startsAt: string | null;
  endsAt: string | null;
  /** live: a match is in its time slot without a result; next: the soonest upcoming round. */
  status: 'live' | 'next' | 'done' | 'pending';
  bye: Team | null;
  matches: PublicMatch[];
}

export interface PublicDay {
  /** YYYY-MM-DD, or null for matches without a date. */
  date: string | null;
  label: string;
  rounds: PublicRound[];
}

export interface PublicStandingRow {
  position: number;
  team: Team;
  played: number;
  wins: number;
  losses: number;
  points: number;
  kills: number;
  deaths: number;
  diff: number;
  last5: ('W' | 'L')[];
  qualifies: boolean;
  cutLine: boolean;
  status: QualificationStatus;
}

export interface BracketSlotView {
  team: Team | null;
  seedLabel: string;
  isWinner: boolean;
  /** Games won in the series, or null when nothing has been played (or the series is a single game). */
  wins: number | null;
}

export interface BracketMatchView {
  title: string;
  matchId: number | null;
  series: PublicSeries | null;
  hasDetail: boolean;
  liveGame: number | null;
  inStream: boolean;
  /** ISO UTC start; the visible `when` text is the server-side (tournament zone) fallback. */
  startsAt: string | null;
  when: string | null;
  slots: [BracketSlotView, BracketSlotView];
}

export interface PublicPhase {
  key: 'group' | 'semifinal' | 'final';
  label: string;
  dates: string;
  current: boolean;
}

export interface PublicModel {
  name: string;
  slug: string;
  /** Where the JSON of a match's Dota detail lives: `${detailBase}/${matchId}/detalle`. */
  detailBase: string;
  /** IANA zone the server-rendered times are shown in (visitors' browsers re-render in their own). */
  timezone: string;
  kicker: string;
  /** The server's clock when this was built (ISO), so browsers can correct for their own clock skew. */
  serverNow: string;
  /** The tournament's live stream, ready to embed, or null. */
  stream: StreamView | null;
  phases: PublicPhase[];
  /** The games being played right now: the one on the stream first, then by start. Empty when nothing is live. */
  live: PublicLive[];
  progress: { played: number; total: number; percent: number };
  teams: Team[];
  days: PublicDay[];
  standings: PublicStandingRow[];
  standingsSub: string;
  bracket: {
    /** True while the pairings are a projection from the current table rather than confirmed. */
    projection: boolean;
    note: string;
    semifinals: [BracketMatchView, BracketMatchView];
    final: BracketMatchView;
    champion: Team | null;
  };
  rules: {
    summary: { label: string; value: string }[];
    tiebreakers: string[];
    /** e.g. "K−D, luego kills" */
    legendTiebreak: string;
    /** The rulebook as sanitized HTML (the rich text, or the old text converted). */
    html: string;
    qualifiers: number;
    pointsWin: string;
    pointsLoss: string;
  };
}

const TIEBREAK_LONG: Record<TiebreakerKey, string> = {
  kd: 'Diferencia de kills y deaths (K − D)',
  kills: 'Mayor cantidad de kills',
  h2h: 'Resultado jugado entre los equipos empatados',
  extra: 'Juego adicional entre los equipos empatados',
};
const TIEBREAK_SHORT: Record<TiebreakerKey, string> = {
  kd: 'K−D',
  kills: 'kills',
  h2h: 'resultado jugado entre los empatados',
  extra: 'juego adicional',
};

const DEFAULT_SLOT_MS = 60 * 60_000;

/**
 * Which rounds are in progress and which comes next, from real instants.
 * Live: an unplayed match inside [start, end). Next: the unplayed round starting soonest after `now`
 * (unscheduled rounds only when nothing scheduled is left). A past round still missing results is neither.
 */
export function liveAndNext(matches: Match[], now: Date): { live: Set<number>; next: number | undefined } {
  const t = now.getTime();
  const unplayed = matches.filter((m) => m.winnerId === null);
  const live = new Set<number>();
  for (const m of unplayed) {
    if (!m.startsAt) continue;
    const start = Date.parse(m.startsAt);
    const end = m.endsAt ? Date.parse(m.endsAt) : start + DEFAULT_SLOT_MS;
    if (start <= t && t < end) live.add(m.round);
  }
  const upcoming = unplayed
    .filter((m) => m.startsAt && Date.parse(m.startsAt) > t && !live.has(m.round))
    .sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!) || a.round - b.round)[0];
  if (upcoming) return { live, next: upcoming.round };
  const unscheduled = unplayed.filter((m) => !m.startsAt && !live.has(m.round)).sort((a, b) => a.round - b.round)[0];
  return { live, next: unscheduled?.round };
}

function buildDays(state: TournamentState, live: Set<number>, nextRound: number | undefined): PublicDay[] {
  const { teams, teamsById } = state;
  const groupMatches = state.allGroupMatches;
  const toMatch = (m: Match): PublicMatch => ({
    id: m.id,
    number: m.matchNumber,
    round: m.round,
    teamA: m.team1Id === null ? null : (teamsById.get(m.team1Id) ?? null),
    teamB: m.team2Id === null ? null : (teamsById.get(m.team2Id) ?? null),
    startsAt: m.startsAt,
    played: m.winnerId !== null,
    winnerId: m.winnerId,
    kills: m.winnerId === null ? null : [m.team1Kills ?? 0, m.team2Kills ?? 0],
    deaths: m.winnerId === null ? null : [m.team1Deaths ?? 0, m.team2Deaths ?? 0],
    isNext: m.round === nextRound,
    isTiebreak: m.isTiebreak,
    series: buildSeries(state, m),
    hasDetail: hasDetail(state, m.id),
    liveGame: liveGameOf(state, m.id),
    inStream: inStreamOf(state, m.id),
  });

  const byDate = new Map<string | null, Match[]>();
  for (const m of groupMatches) byDate.set(m.scheduledDate, [...(byDate.get(m.scheduledDate) ?? []), m]);
  const dates = [...byDate.keys()].sort((a, b) => (a === null ? 1 : b === null ? -1 : a < b ? -1 : a > b ? 1 : 0));

  return dates.map((date): PublicDay => {
    const byRound = new Map<number, Match[]>();
    for (const m of byDate.get(date)!) byRound.set(m.round, [...(byRound.get(m.round) ?? []), m]);
    const rounds = [...byRound.keys()]
      .sort((a, b) => a - b)
      .map((number): PublicRound => {
        const list = byRound.get(number)!;
        const complete = list.every((m) => m.team1Id !== null && m.team2Id !== null);
        const playing = new Set(list.flatMap((m) => [m.team1Id, m.team2Id]));
        const resting = teams.filter((t) => !playing.has(t.id));
        const done = list.every((m) => m.winnerId !== null);
        const timed = list.find((m) => m.startTime !== null);
        return {
          number,
          startTime: timed?.startTime ?? null,
          endTime: timed?.endTime ?? null,
          startsAt: timed?.startsAt ?? null,
          endsAt: timed?.endsAt ?? null,
          // A bye exists only in a complete round of an odd-sized group: exactly one team sits out.
          bye: complete && resting.length === 1 && !list.every((m) => m.isTiebreak) ? resting[0]! : null,
          status: live.has(number) ? 'live' : number === nextRound ? 'next' : done ? 'done' : 'pending',
          matches: list.map(toMatch),
        };
      });
    return {
      date,
      label: date === null ? 'Sin fecha' : DAY_LABEL.format(new Date(`${date}T00:00:00Z`)),
      rounds,
    };
  });
}

function buildStandings(state: TournamentState): PublicStandingRow[] {
  const { standings, teamsById, tournament } = state;
  return standings.flatMap((row: StandingRow, index) => {
    const team = teamsById.get(row.teamId);
    if (!team) return [];
    return [
      {
        position: index + 1,
        team,
        played: row.played,
        wins: row.wins,
        losses: row.losses,
        points: row.points,
        kills: row.kills,
        deaths: row.deaths,
        diff: row.diff,
        last5: row.last5,
        qualifies: index < tournament.qualifiers,
        cutLine: index === tournament.qualifiers - 1,
        status: row.status,
      },
    ];
  });
}

function buildBracket(state: TournamentState, days: ScheduleDay[]): PublicModel['bracket'] {
  const { bracket, standings, teamsById, playoffMatches } = state;
  const position = new Map(standings.map((r, i) => [r.teamId, i + 1]));
  const anyPlayed = standings.some((r) => r.played > 0);
  const confirmed = bracket.semifinals.some((s) => s.team1Id !== null || s.team2Id !== null);
  const team = (id: number | null) => (id === null ? null : (teamsById.get(id) ?? null));

  const startsAt = (phase: 'semifinal' | 'final', number: number): string | null => {
    const stored = playoffMatches.find((m) => m.phase === phase && m.matchNumber === number);
    if (stored?.startsAt) return stored.startsAt;
    const slot = days
      .filter((d) => d.phase === phase)
      .flatMap((d) => d.startTimes.map((time) => ({ date: d.date, time })))[number - 1];
    return slot ? zonedToUtc(slot.date, slot.time, state.tournament.timezone) : null;
  };

  const when = (phase: 'semifinal' | 'final', number: number): string | null => {
    const stored = playoffMatches.find((m) => m.phase === phase && m.matchNumber === number);
    const slots = days
      .filter((d) => d.phase === phase)
      .flatMap((d) => d.startTimes.map((time) => ({ date: d.date, time })));
    const slot = stored?.scheduledDate ? { date: stored.scheduledDate, time: stored.startTime } : slots[number - 1];
    if (!slot) return null;
    return slot.time ? `${shortDate(slot.date)} · ${slot.time}` : shortDate(slot.date);
  };

  const seeded = (id: number | null): BracketSlotView['seedLabel'] => {
    const pos = id === null ? undefined : position.get(id);
    return pos === undefined ? '' : `${pos}.º de grupos`;
  };

  const seedPairs: [number, number][] = [[0, 3], [1, 2]];
  const semifinals = bracket.semifinals.map((slot, i): BracketMatchView => {
    let ids: [number | null, number | null] = [slot.team1Id, slot.team2Id];
    if (!confirmed && anyPlayed) {
      const [a, b] = seedPairs[i]!;
      ids = [standings[a]?.teamId ?? null, standings[b]?.teamId ?? null];
    }
    const stored = playoffMatches.find((m) => m.id === slot.matchId);
    const series = stored ? buildSeries(state, stored) : null;
    const view = (id: number | null, index: 0 | 1): BracketSlotView => ({
      team: team(id),
      seedLabel: seeded(id) || 'Por definir',
      isWinner: id !== null && slot.winnerId === id,
      wins: series && series.games.length > 0 && stored && id !== null && id === (index === 0 ? stored.team1Id : stored.team2Id) ? series.wins[index] : null,
    });
    return {
      title: `Semifinal ${i + 1}`,
      matchId: stored?.id ?? null,
      series,
      hasDetail: stored ? hasDetail(state, stored.id) : false,
      liveGame: stored ? liveGameOf(state, stored.id) : null,
      inStream: stored ? inStreamOf(state, stored.id) : false,
      startsAt: startsAt('semifinal', i + 1),
      when: when('semifinal', i + 1),
      slots: [view(ids[0], 0), view(ids[1], 1)],
    };
  }) as [BracketMatchView, BracketMatchView];

  const finalStored = playoffMatches.find((m) => m.id === bracket.final.matchId);
  const finalSeries = finalStored ? buildSeries(state, finalStored) : null;
  const finalView = (id: number | null, label: string, index: 0 | 1): BracketSlotView => ({
    team: team(id),
    seedLabel: label,
    isWinner: id !== null && bracket.final.winnerId === id,
    wins: finalSeries && finalSeries.games.length > 0 && finalStored && id !== null && id === (index === 0 ? finalStored.team1Id : finalStored.team2Id) ? finalSeries.wins[index] : null,
  });

  let note: string;
  if (confirmed) note = 'Cruces confirmados';
  else if (state.groupComplete) note = 'Pendiente de desempate para definir los cruces';
  else {
    const left = state.pendingGroup;
    note = `Proyección con la tabla actual · ${left === 1 ? 'falta 1 partido' : `faltan ${left} partidos`} de fase de grupos`;
  }

  return {
    projection: !confirmed,
    note,
    semifinals,
    final: {
      title: 'Gran final',
      matchId: finalStored?.id ?? null,
      series: finalSeries,
      hasDetail: finalStored ? hasDetail(state, finalStored.id) : false,
      liveGame: finalStored ? liveGameOf(state, finalStored.id) : null,
      inStream: finalStored ? inStreamOf(state, finalStored.id) : false,
      startsAt: startsAt('final', 1),
      when: when('final', 1),
      slots: [finalView(bracket.final.team1Id, 'Ganador SF1', 0), finalView(bracket.final.team2Id, 'Ganador SF2', 1)],
    },
    champion: team(bracket.championId),
  };
}

function buildPhases(state: TournamentState, days: ScheduleDay[]): PublicPhase[] {
  const { bracket, groupComplete } = state;
  const decided = bracket.semifinals.every((s) => s.winnerId !== null);
  const current: PublicPhase['key'] =
    bracket.championId !== null ? 'final' : !groupComplete ? 'group' : decided ? 'final' : 'semifinal';
  const datesOf = (phase: PublicPhase['key']) => formatDayList(days.filter((d) => d.phase === phase).map((d) => d.date));
  return [
    { key: 'group', label: 'Fase de grupos', dates: datesOf('group'), current: current === 'group' },
    { key: 'semifinal', label: 'Semifinales', dates: datesOf('semifinal'), current: current === 'semifinal' },
    { key: 'final', label: 'Gran final', dates: datesOf('final'), current: current === 'final' },
  ];
}

function buildRules(state: TournamentState): PublicModel['rules'] {
  const { tournament } = state;
  const summary = [
    { label: 'Victoria', value: points(tournament.pointsWin) },
    { label: 'Derrota', value: points(tournament.pointsLoss) },
    { label: 'Clasifican', value: `Top ${tournament.qualifiers}` },
    ...(tournament.qualifiers === 4 ? [{ label: 'Semis', value: '1.º vs 4.º · 2.º vs 3.º' }] : []),
  ];
  return {
    summary,
    tiebreakers: tournament.tiebreakers.map((k) => TIEBREAK_LONG[k]),
    legendTiebreak: tournament.tiebreakers.map((k) => TIEBREAK_SHORT[k]).join(', luego '),
    html: rulebookHtmlOf(tournament),
    qualifiers: tournament.qualifiers,
    pointsWin: points(tournament.pointsWin),
    pointsLoss: points(tournament.pointsLoss),
  };
}

/** Name of the stage a match belongs to, without the game: "Semifinal 2", "Gran final", "Ronda 4 · Partido 11". */
function matchLabel(match: Match): string {
  if (match.phase === 'final') return 'Gran final';
  if (match.phase === 'semifinal') return `Semifinal ${match.matchNumber}`;
  return `Ronda ${match.round} · Partido ${match.matchNumber}`;
}

const liveGameOf = (state: TournamentState, matchId: number): number | null =>
  state.liveMarks.find((mark) => mark.matchId === matchId)?.gameNumber ?? null;

const inStreamOf = (state: TournamentState, matchId: number): boolean =>
  state.tournament.streamMatchId === matchId && state.liveMarks.some((mark) => mark.matchId === matchId);

function buildLive(state: TournamentState): PublicLive[] {
  const lives: PublicLive[] = [];
  for (const mark of state.liveMarks) {
    const live = buildLiveOf(state, mark);
    if (live) lives.push(live);
  }
  return lives;
}

function buildLiveOf(state: TournamentState, mark: LiveMark): PublicLive | null {
  const match = [...state.allGroupMatches, ...state.playoffMatches].find((m) => m.id === mark.matchId);
  const teamA = match?.team1Id == null ? undefined : state.teamsById.get(match.team1Id);
  const teamB = match?.team2Id == null ? undefined : state.teamsById.get(match.team2Id);
  if (!match || !teamA || !teamB) return null;
  const series = buildSeries(state, match);
  const anyPlayed = state.standings.some((row) => row.played > 0);
  const position = (id: number) => {
    const index = state.standings.findIndex((row) => row.teamId === id);
    return anyPlayed && index >= 0 ? `${index + 1}.º de grupos` : '';
  };
  return {
    matchId: match.id,
    phase: match.phase,
    teamA,
    teamB,
    subtitleA: position(teamA.id),
    subtitleB: position(teamB.id),
    label: series ? `${matchLabel(match)} · Juego ${mark.gameNumber} de ${series.length}` : matchLabel(match),
    gameNumber: mark.gameNumber,
    series,
    startedAt: mark.startedAt,
    inStream: inStreamOf(state, match.id),
  };
}

export function buildPublicModel(state: TournamentState, scheduleDays: ScheduleDay[], options: { now?: Date; parentHosts?: readonly string[] } = {}): PublicModel {
  const { tournament, groupMatches } = state;
  const now = options.now ?? new Date();
  const { live, next: nextRound } = liveAndNext(state.allGroupMatches, now);
  const played = groupMatches.length - state.pendingGroup;
  const first = scheduleDays.map((d) => d.date).sort()[0];
  const kicker = first
    ? `${tournament.game} · ${MONTHS_LONG[parts(first).month]} ${parts(first).year}`
    : tournament.game;

  return {
    name: tournament.name,
    slug: tournament.slug,
    detailBase: `/t/${tournament.slug}/partido`,
    timezone: tournament.timezone,
    kicker,
    serverNow: now.toISOString(),
    stream: describeStream(tournament.streamUrl, options.parentHosts ?? ['sites.google.com']),
    phases: buildPhases(state, scheduleDays),
    live: buildLive(state),
    progress: {
      played,
      total: groupMatches.length,
      percent: groupMatches.length === 0 ? 0 : Math.round((played / groupMatches.length) * 100),
    },
    teams: state.teams,
    days: buildDays(state, live, nextRound),
    standings: buildStandings(state),
    standingsSub: `${played} de ${groupMatches.length} partidos jugados`,
    bracket: buildBracket(state, scheduleDays),
    rules: buildRules(state),
  };
}
