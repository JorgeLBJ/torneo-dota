import type Database from 'better-sqlite3';
import { isHeroSlug } from '../data/heroes.js';
import { isValidTimeZone, utcToZoned, zonedToUtc } from '../format/timezone.js';

// All SQL of the application lives in this module.

export type Phase = 'group' | 'semifinal' | 'final';
export type TiebreakerKey = 'kd' | 'kills' | 'h2h' | 'extra';

export interface Tournament {
  id: number;
  name: string;
  slug: string;
  qualifiers: number;
  game: string;
  pointsWin: number;
  pointsLoss: number;
  /** Ordered tiebreak criteria applied after points. */
  tiebreakers: TiebreakerKey[];
  groupLegs: 1 | 2;
  rulesText: string;
  /** IANA zone that wall-clock schedule inputs are read in and admin times are shown in. */
  timezone: string;
  /** A Kick/Twitch/YouTube page URL as the admin entered it (validated); the embed is derived from it. */
  streamUrl: string | null;
  isActive: boolean;
  createdAt: string;
}

export type TournamentPatch = Partial<Omit<Tournament, 'id' | 'createdAt' | 'isActive'>>;

export interface ScheduleDay {
  /** YYYY-MM-DD */
  date: string;
  phase: Phase;
  /** HH:MM start times, in play order. */
  startTimes: string[];
  slotMinutes: number;
}

export interface Team {
  id: number;
  tournamentId: number;
  code: string;
  name: string;
  captain: string | null;
  /** Hero slug, unique within the tournament. */
  hero: string | null;
  /** Key of the team's own uploaded image (1x WebP) in the image store; replaces the hero everywhere when set. */
  imageKey: string | null;
}

export interface Match {
  id: number;
  tournamentId: number;
  phase: Phase;
  round: number;
  matchNumber: number;
  /** An extra game played to break a tie: outside the table statistics, used only by the `extra` criterion. */
  isTiebreak: boolean;
  /** Start and end as ISO UTC instants (the stored truth). */
  startsAt: string | null;
  endsAt: string | null;
  /** The same schedule as wall-clock values in the tournament's time zone (derived, never stored). */
  scheduledDate: string | null;
  startTime: string | null;
  endTime: string | null;
  team1Id: number | null;
  team2Id: number | null;
  winnerId: number | null;
  team1Kills: number | null;
  team1Deaths: number | null;
  team2Kills: number | null;
  team2Deaths: number | null;
}

export interface NewMatch {
  tournamentId: number;
  phase: Phase;
  round: number;
  matchNumber: number;
  isTiebreak?: boolean;
  scheduledDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  team1Id?: number | null;
  team2Id?: number | null;
}

export interface Schedule {
  scheduledDate: string | null;
  startTime: string | null;
  endTime: string | null;
}

export interface MatchEdit extends Schedule {
  round: number;
  team1Id: number | null;
  team2Id: number | null;
}

export interface MatchResult {
  winnerId: number;
  team1Kills: number;
  team1Deaths: number;
  team2Kills: number;
  team2Deaths: number;
}

export interface Admin {
  id: number;
  username: string;
  passwordHash: string;
  createdAt: string;
}

export interface Session {
  id: string;
  adminId: number;
  expiresAt: string;
}

export const TIEBREAKER_KEYS = ['kd', 'kills', 'h2h', 'extra'] as const;

const TOURNAMENT_COLS = `id, name, slug, qualifiers, game, points_win AS pointsWin, points_loss AS pointsLoss,
  tiebreakers, group_legs AS groupLegs, rules_text AS rulesText, timezone, stream_url AS streamUrl, is_active AS isActive, created_at AS createdAt`;
const TEAM_COLS = 'id, tournament_id AS tournamentId, code, name, captain, hero, image_key AS imageKey';
const MATCH_COLS = `m.id, m.tournament_id AS tournamentId, m.phase, m.round, m.match_number AS matchNumber, m.is_tiebreak AS isTiebreak,
  m.starts_at AS startsAt, m.ends_at AS endsAt, t.timezone AS timezone,
  m.team1_id AS team1Id, m.team2_id AS team2Id, m.winner_id AS winnerId,
  m.team1_kills AS team1Kills, m.team1_deaths AS team1Deaths, m.team2_kills AS team2Kills, m.team2_deaths AS team2Deaths`;
const MATCH_FROM = 'FROM matches m JOIN tournaments t ON t.id = m.tournament_id';
const ADMIN_COLS = 'id, username, password_hash AS passwordHash, created_at AS createdAt';
const SESSION_COLS = 'id, admin_id AS adminId, expires_at AS expiresAt';

type TournamentRow = Omit<Tournament, 'tiebreakers' | 'isActive'> & { tiebreakers: string; isActive: number };
type MatchRow = Omit<Match, 'scheduledDate' | 'startTime' | 'endTime' | 'isTiebreak'> & { timezone: string; isTiebreak: number };

function toMatch({ timezone, ...row }: MatchRow): Match {
  const start = row.startsAt ? utcToZoned(row.startsAt, timezone) : null;
  const end = row.endsAt ? utcToZoned(row.endsAt, timezone) : null;
  return { ...row, isTiebreak: row.isTiebreak === 1, scheduledDate: start?.date ?? null, startTime: start?.time ?? null, endTime: end?.time ?? null };
}

type ScheduleDayRow = Omit<ScheduleDay, 'startTimes'> & { startTimes: string };

function toTournament(row: TournamentRow): Tournament {
  const known = row.tiebreakers.split(',').filter((k): k is TiebreakerKey => (TIEBREAKER_KEYS as readonly string[]).includes(k));
  return { ...row, tiebreakers: [...new Set(known)], isActive: row.isActive === 1 };
}

export function createRepository(db: Database.Database) {
  const q = {
    insertTournament: db.prepare('INSERT INTO tournaments (name, slug, qualifiers) VALUES (@name, @slug, @qualifiers)'),
    tournamentById: db.prepare(`SELECT ${TOURNAMENT_COLS} FROM tournaments WHERE id = ?`),
    tournamentBySlug: db.prepare(`SELECT ${TOURNAMENT_COLS} FROM tournaments WHERE slug = ?`),
    listTournaments: db.prepare(`SELECT ${TOURNAMENT_COLS} FROM tournaments ORDER BY id`),
    updateTournament: db.prepare(
      `UPDATE tournaments SET name = @name, slug = @slug, qualifiers = @qualifiers, game = @game,
         points_win = @pointsWin, points_loss = @pointsLoss, tiebreakers = @tiebreakers,
         group_legs = @groupLegs, rules_text = @rulesText, timezone = @timezone, stream_url = @streamUrl WHERE id = @id`,
    ),
    activeTournament: db.prepare(`SELECT ${TOURNAMENT_COLS} FROM tournaments WHERE is_active = 1`),
    clearActive: db.prepare('UPDATE tournaments SET is_active = 0 WHERE is_active = 1'),
    markActive: db.prepare('UPDATE tournaments SET is_active = 1 WHERE id = ?'),
    deleteTournament: db.prepare('DELETE FROM tournaments WHERE id = ?'),

    deleteScheduleDays: db.prepare('DELETE FROM schedule_days WHERE tournament_id = ?'),
    insertScheduleDay: db.prepare(
      `INSERT INTO schedule_days (tournament_id, position, date, phase, start_times, slot_minutes)
       VALUES (@tournamentId, @position, @date, @phase, @startTimes, @slotMinutes)`,
    ),
    listScheduleDays: db.prepare(
      `SELECT date, phase, start_times AS startTimes, slot_minutes AS slotMinutes
       FROM schedule_days WHERE tournament_id = ? ORDER BY position`,
    ),

    insertTeam: db.prepare(
      'INSERT INTO teams (tournament_id, code, name, captain, hero) VALUES (@tournamentId, @code, @name, @captain, @hero)',
    ),
    teamById: db.prepare(`SELECT ${TEAM_COLS} FROM teams WHERE id = ?`),
    listTeams: db.prepare(`SELECT ${TEAM_COLS} FROM teams WHERE tournament_id = ? ORDER BY code`),
    updateTeam: db.prepare(
      'UPDATE teams SET code = @code, name = @name, captain = @captain, hero = @hero, image_key = @imageKey WHERE id = @id',
    ),
    deleteTeam: db.prepare('DELETE FROM teams WHERE id = ?'),
    teamHasMatches: db
      .prepare('SELECT EXISTS(SELECT 1 FROM matches WHERE team1_id = @id OR team2_id = @id OR winner_id = @id)')
      .pluck(),

    insertMatch: db.prepare(
      `INSERT INTO matches (tournament_id, phase, round, match_number, is_tiebreak, starts_at, ends_at, team1_id, team2_id)
       VALUES (@tournamentId, @phase, @round, @matchNumber, @isTiebreak, @startsAt, @endsAt, @team1Id, @team2Id)`,
    ),
    matchById: db.prepare(`SELECT ${MATCH_COLS} ${MATCH_FROM} WHERE m.id = ?`),
    tournamentZone: db.prepare('SELECT timezone FROM tournaments WHERE id = ?').pluck(),
    listMatches: db.prepare(`SELECT ${MATCH_COLS} ${MATCH_FROM} WHERE m.tournament_id = ? ORDER BY m.match_number`),
    listMatchesByPhase: db.prepare(
      `SELECT ${MATCH_COLS} ${MATCH_FROM} WHERE m.tournament_id = ? AND m.phase = ? ORDER BY m.match_number`,
    ),
    deleteMatchesByPhase: db.prepare('DELETE FROM matches WHERE tournament_id = ? AND phase = ?'),
    deleteMatch: db.prepare('DELETE FROM matches WHERE id = ?'),
    updateMatch: db.prepare(
      `UPDATE matches SET round = @round, starts_at = @startsAt, ends_at = @endsAt,
         team1_id = @team1Id, team2_id = @team2Id WHERE id = @id`,
    ),
    updateSchedule: db.prepare(
      'UPDATE matches SET starts_at = @startsAt, ends_at = @endsAt WHERE id = @id',
    ),
    updateMatchTeams: db.prepare('UPDATE matches SET team1_id = @team1Id, team2_id = @team2Id WHERE id = @id'),
    recordResult: db.prepare(
      `UPDATE matches SET winner_id = @winnerId, team1_kills = @team1Kills, team1_deaths = @team1Deaths,
         team2_kills = @team2Kills, team2_deaths = @team2Deaths WHERE id = @id`,
    ),
    clearResult: db.prepare(
      `UPDATE matches SET winner_id = NULL, team1_kills = NULL, team1_deaths = NULL,
         team2_kills = NULL, team2_deaths = NULL WHERE id = ?`,
    ),
    listGroupOrder: db.prepare(
      "SELECT id FROM matches WHERE tournament_id = ? AND phase = 'group' ORDER BY round, match_number, id",
    ),
    setMatchNumber: db.prepare('UPDATE matches SET match_number = ? WHERE id = ?'),
    maxRound: db.prepare('SELECT COALESCE(MAX(round), 0) FROM matches WHERE tournament_id = ? AND phase = ?').pluck(),
    hasResults: db
      .prepare('SELECT EXISTS(SELECT 1 FROM matches WHERE tournament_id = ? AND winner_id IS NOT NULL)')
      .pluck(),

    insertAdmin: db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)'),
    adminById: db.prepare(`SELECT ${ADMIN_COLS} FROM admins WHERE id = ?`),
    adminByUsername: db.prepare(`SELECT ${ADMIN_COLS} FROM admins WHERE username = ?`),
    listAdmins: db.prepare(`SELECT ${ADMIN_COLS} FROM admins ORDER BY id`),
    countAdmins: db.prepare('SELECT COUNT(*) FROM admins').pluck(),
    deleteAdmin: db.prepare('DELETE FROM admins WHERE id = ?'),
    setAdminPassword: db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?'),
    deleteOtherSessions: db.prepare('DELETE FROM sessions WHERE admin_id = ? AND id <> ?'),

    insertSession: db.prepare('INSERT INTO sessions (id, admin_id, expires_at) VALUES (?, ?, ?)'),
    validSession: db.prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ? AND expires_at > ?`),
    deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
    deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  };

  const tournamentById = (id: number): Tournament | undefined => {
    const row = q.tournamentById.get(id) as TournamentRow | undefined;
    return row && toTournament(row);
  };
  const teamById = (id: number) => q.teamById.get(id) as Team | undefined;
  const matchById = (id: number): Match | undefined => {
    const row = q.matchById.get(id) as MatchRow | undefined;
    return row && toMatch(row);
  };
  /** Wall-clock schedule (read in the tournament's zone) -> stored UTC instants. */
  const instants = (tournamentId: number, s: { scheduledDate?: string | null; startTime?: string | null; endTime?: string | null }) => {
    const zone = q.tournamentZone.get(tournamentId) as string;
    const { scheduledDate: date, startTime: start, endTime: end } = s;
    const startsAt = date && start ? zonedToUtc(date, start, zone) : null;
    let endsAt = date && end ? zonedToUtc(date, end, zone) : null;
    // An end that is not after the start belongs to the next day (a slot running past midnight).
    if (startsAt && endsAt && endsAt <= startsAt) endsAt = new Date(Date.parse(endsAt) + 86_400_000).toISOString().replace('.000Z', 'Z');
    return { startsAt, endsAt };
  };
  const requireHero = (hero: string | null | undefined): void => {
    if (hero != null && !isHeroSlug(hero)) throw new Error(`Unknown hero "${hero}"`);
  };
  const requireRow = <T>(row: T | undefined, what: string): T => {
    if (row === undefined) throw new Error(`${what} not found`);
    return row;
  };

  const withDefaults = (m: NewMatch) => ({
    team1Id: null,
    team2Id: null,
    ...m,
    isTiebreak: m.isTiebreak ? 1 : 0,
    ...instants(m.tournamentId, m),
  });

  const insertMatchesTx = db.transaction((matches: NewMatch[]) => {
    for (const m of matches) q.insertMatch.run(withDefaults(m));
  });

  const replaceGroupMatchesTx = db.transaction((tournamentId: number, matches: NewMatch[], clearPlayoffs: boolean) => {
    if (clearPlayoffs) {
      q.deleteMatchesByPhase.run(tournamentId, 'semifinal');
      q.deleteMatchesByPhase.run(tournamentId, 'final');
    }
    q.deleteMatchesByPhase.run(tournamentId, 'group');
    for (const m of matches) q.insertMatch.run(withDefaults(m));
  });

  const renumberTx = db.transaction((tournamentId: number) => {
    const rows = q.listGroupOrder.all(tournamentId) as { id: number }[];
    rows.forEach((row, i) => q.setMatchNumber.run(i + 1, row.id));
  });

  const setActiveTx = db.transaction((id: number) => {
    q.clearActive.run();
    if (q.markActive.run(id).changes === 0) throw new Error('Tournament not found');
  });

  const createFirstAdminTx = db.transaction((username: string, passwordHash: string): Admin | null => {
    // Re-checked inside the transaction: of two setups that raced past the first check, only one gets here first.
    if ((q.countAdmins.get() as number) > 0) return null;
    const info = q.insertAdmin.run(username, passwordHash);
    return q.adminById.get(Number(info.lastInsertRowid)) as Admin;
  });

  const inTransaction = <T>(work: () => T): T => db.transaction(work)();

  const replaceScheduleDaysTx = db.transaction((tournamentId: number, days: ScheduleDay[]) => {
    q.deleteScheduleDays.run(tournamentId);
    days.forEach((d, position) =>
      q.insertScheduleDay.run({
        tournamentId,
        position,
        date: d.date,
        phase: d.phase,
        startTimes: d.startTimes.join(','),
        slotMinutes: d.slotMinutes,
      }),
    );
  });

  return {
    /** Runs several repository calls as one atomic unit: any throw rolls all of them back. */
    transaction: inTransaction,

    // Tournaments
    createTournament(input: { name: string; slug: string; qualifiers?: number }): Tournament {
      const info = q.insertTournament.run({ qualifiers: 4, ...input });
      return requireRow(tournamentById(Number(info.lastInsertRowid)), 'Tournament');
    },
    getTournamentById: tournamentById,
    getTournamentBySlug(slug: string): Tournament | undefined {
      const row = q.tournamentBySlug.get(slug) as TournamentRow | undefined;
      return row && toTournament(row);
    },
    listTournaments: () => (q.listTournaments.all() as TournamentRow[]).map(toTournament),
    updateTournament(id: number, patch: TournamentPatch): Tournament {
      const next = { ...requireRow(tournamentById(id), 'Tournament'), ...patch, id };
      if (!isValidTimeZone(next.timezone)) throw new Error(`Invalid time zone "${next.timezone}"`);
      q.updateTournament.run({ ...next, tiebreakers: next.tiebreakers.join(',') });
      return requireRow(tournamentById(id), 'Tournament');
    },
    getActiveTournament(): Tournament | undefined {
      const row = q.activeTournament.get() as TournamentRow | undefined;
      return row && toTournament(row);
    },
    /** Makes exactly this tournament the active one (atomic). */
    setActiveTournament(id: number): void {
      setActiveTx(id);
    },
    deleteTournament(id: number): void {
      q.deleteTournament.run(id);
    },

    // Calendar days
    listScheduleDays: (tournamentId: number): ScheduleDay[] =>
      (q.listScheduleDays.all(tournamentId) as ScheduleDayRow[]).map((d) => ({
        ...d,
        startTimes: d.startTimes.split(',').filter(Boolean),
      })),
    replaceScheduleDays(tournamentId: number, days: ScheduleDay[]): void {
      replaceScheduleDaysTx(tournamentId, days);
    },

    // Teams
    createTeam(
      tournamentId: number,
      input: { code: string; name: string; captain?: string | null; hero?: string | null },
    ): Team {
      requireHero(input.hero);
      const info = q.insertTeam.run({ captain: null, hero: null, ...input, tournamentId });
      return requireRow(teamById(Number(info.lastInsertRowid)), 'Team');
    },
    getTeam: teamById,
    listTeams: (tournamentId: number) => q.listTeams.all(tournamentId) as Team[],
    updateTeam(id: number, patch: Partial<Pick<Team, 'code' | 'name' | 'captain' | 'hero' | 'imageKey'>>): Team {
      requireHero(patch.hero);
      const current = requireRow(teamById(id), 'Team');
      q.updateTeam.run({ ...current, ...patch, id });
      return requireRow(teamById(id), 'Team');
    },
    deleteTeam(id: number): void {
      q.deleteTeam.run(id);
    },
    teamHasMatches: (teamId: number): boolean => q.teamHasMatches.get({ id: teamId }) === 1,

    // Matches
    insertMatches(matches: NewMatch[]): void {
      insertMatchesTx(matches);
    },
    createMatch(match: NewMatch): Match {
      const info = q.insertMatch.run(withDefaults(match));
      return requireRow(matchById(Number(info.lastInsertRowid)), 'Match');
    },
    /** Atomically swaps every group-phase match for the given list (optionally dropping playoff matches too). */
    replaceGroupMatches(tournamentId: number, matches: NewMatch[], options: { clearPlayoffs?: boolean } = {}): void {
      replaceGroupMatchesTx(tournamentId, matches, options.clearPlayoffs ?? false);
    },
    /** Rewrites group match numbers 1..n ordered by round, then previous number. */
    renumberGroupMatches(tournamentId: number): void {
      renumberTx(tournamentId);
    },
    getMatch: matchById,
    listMatches(tournamentId: number, phase?: Phase): Match[] {
      return ((phase ? q.listMatchesByPhase.all(tournamentId, phase) : q.listMatches.all(tournamentId)) as MatchRow[]).map(toMatch);
    },
    maxRound: (tournamentId: number, phase: Phase): number => q.maxRound.get(tournamentId, phase) as number,
    hasResults: (tournamentId: number): boolean => q.hasResults.get(tournamentId) === 1,
    deleteMatches(tournamentId: number, phase: Phase): void {
      q.deleteMatchesByPhase.run(tournamentId, phase);
    },
    deleteMatch(id: number): void {
      q.deleteMatch.run(id);
    },
    updateMatch(id: number, edit: MatchEdit): Match {
      const current = requireRow(matchById(id), 'Match');
      q.updateMatch.run({ ...edit, ...instants(current.tournamentId, edit), id });
      return requireRow(matchById(id), 'Match');
    },
    updateMatchSchedule(id: number, schedule: Schedule): Match {
      const current = requireRow(matchById(id), 'Match');
      q.updateSchedule.run({ ...instants(current.tournamentId, schedule), id });
      return requireRow(matchById(id), 'Match');
    },
    updateMatchTeams(id: number, team1Id: number | null, team2Id: number | null): Match {
      q.updateMatchTeams.run({ team1Id, team2Id, id });
      return requireRow(matchById(id), 'Match');
    },
    recordResult(id: number, result: MatchResult): Match {
      q.recordResult.run({ ...result, id });
      return requireRow(matchById(id), 'Match');
    },
    clearResult(id: number): Match {
      q.clearResult.run(id);
      return requireRow(matchById(id), 'Match');
    },

    // Admins
    createAdmin(username: string, passwordHash: string): Admin {
      const info = q.insertAdmin.run(username, passwordHash);
      return requireRow(q.adminById.get(Number(info.lastInsertRowid)) as Admin | undefined, 'Admin');
    },
    /** Creates the first admin, or returns null (creating nothing) if one already exists. Atomic. */
    createFirstAdmin(username: string, passwordHash: string): Admin | null {
      return createFirstAdminTx(username, passwordHash);
    },
    setAdminPassword(id: number, passwordHash: string): void {
      q.setAdminPassword.run(passwordHash, id);
    },
    getAdminById: (id: number) => q.adminById.get(id) as Admin | undefined,
    getAdminByUsername: (username: string) => q.adminByUsername.get(username) as Admin | undefined,
    listAdmins: () => q.listAdmins.all() as Admin[],
    countAdmins: () => q.countAdmins.get() as number,
    deleteAdmin(id: number): void {
      q.deleteAdmin.run(id);
    },

    // Sessions
    createSession(id: string, adminId: number, expiresAt: string): void {
      q.insertSession.run(id, adminId, expiresAt);
    },
    /** `now` is an ISO-8601 UTC string, compared lexicographically with expires_at. */
    getValidSession: (id: string, now: string) => q.validSession.get(id, now) as Session | undefined,
    /** Deletes every session of the admin except the one with this (hashed) id. */
    deleteOtherSessions(adminId: number, keepId: string): void {
      q.deleteOtherSessions.run(adminId, keepId);
    },
    deleteSession(id: string): void {
      q.deleteSession.run(id);
    },
    deleteExpiredSessions(now: string): void {
      q.deleteExpiredSessions.run(now);
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;
