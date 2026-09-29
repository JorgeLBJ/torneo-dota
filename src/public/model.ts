import type { Match, ScheduleDay, Team, TiebreakerKey } from '../db/repository.js';
import { zonedToUtc } from '../format/timezone.js';
import type { QualificationStatus, StandingRow } from '../domain/standings.js';
import { renderRulebook, type RulebookBlock } from '../markdown.js';
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

const shortDate = (date: string) => {
  const { month, day } = parts(date);
  return `${day} ${MONTHS_SHORT[month]}`;
};

const points = (n: number) => `${n} ${n === 1 ? 'pt' : 'pts'}`;

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
}

export interface BracketMatchView {
  title: string;
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
  /** IANA zone the server-rendered times are shown in (visitors' browsers re-render in their own). */
  timezone: string;
  kicker: string;
  phases: PublicPhase[];
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
    blocks: RulebookBlock[];
    qualifiers: number;
    pointsWin: string;
    pointsLoss: string;
  };
}

const TIEBREAK_LONG: Record<TiebreakerKey, string> = {
  kd: 'Diferencia de kills y deaths (K − D)',
  kills: 'Mayor cantidad de kills',
};
const TIEBREAK_SHORT: Record<TiebreakerKey, string> = { kd: 'K−D', kills: 'kills' };

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
  const { teams, teamsById, groupMatches } = state;
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
          bye: complete && resting.length === 1 ? resting[0]! : null,
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
    const view = (id: number | null): BracketSlotView => ({
      team: team(id),
      seedLabel: seeded(id) || 'Por definir',
      isWinner: id !== null && slot.winnerId === id,
    });
    return { title: `Semifinal ${i + 1}`, startsAt: startsAt('semifinal', i + 1), when: when('semifinal', i + 1), slots: [view(ids[0]), view(ids[1])] };
  }) as [BracketMatchView, BracketMatchView];

  const finalView = (id: number | null, label: string): BracketSlotView => ({
    team: team(id),
    seedLabel: label,
    isWinner: id !== null && bracket.final.winnerId === id,
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
      startsAt: startsAt('final', 1),
      when: when('final', 1),
      slots: [finalView(bracket.final.team1Id, 'Ganador SF1'), finalView(bracket.final.team2Id, 'Ganador SF2')],
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
    tiebreakers: [...tournament.tiebreakers.map((k) => TIEBREAK_LONG[k]), 'Si persiste: partida de desempate'],
    legendTiebreak: tournament.tiebreakers.map((k) => TIEBREAK_SHORT[k]).join(', luego '),
    blocks: renderRulebook(tournament.rulesText),
    qualifiers: tournament.qualifiers,
    pointsWin: points(tournament.pointsWin),
    pointsLoss: points(tournament.pointsLoss),
  };
}

export function buildPublicModel(state: TournamentState, scheduleDays: ScheduleDay[], options: { now?: Date } = {}): PublicModel {
  const { tournament, groupMatches } = state;
  const { live, next: nextRound } = liveAndNext(groupMatches, options.now ?? new Date());
  const played = groupMatches.length - state.pendingGroup;
  const first = scheduleDays.map((d) => d.date).sort()[0];
  const kicker = first
    ? `${tournament.game} · ${MONTHS_LONG[parts(first).month]} ${parts(first).year}`
    : tournament.game;

  return {
    name: tournament.name,
    slug: tournament.slug,
    timezone: tournament.timezone,
    kicker,
    phases: buildPhases(state, scheduleDays),
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
