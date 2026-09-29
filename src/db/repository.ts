import type Database from 'better-sqlite3';

// All SQL of the application lives in this module.

export type Phase = 'group' | 'semifinal' | 'final';
export type TiebreakerKey = 'kd' | 'kills';

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
}

export interface Match {
  id: number;
  tournamentId: number;
  phase: Phase;
  round: number;
  matchNumber: number;
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

const TOURNAMENT_COLS = `id, name, slug, qualifiers, game, points_win AS pointsWin, points_loss AS pointsLoss,
  tiebreakers, group_legs AS groupLegs, rules_text AS rulesText, is_active AS isActive, created_at AS createdAt`;
const TEAM_COLS = 'id, tournament_id AS tournamentId, code, name, captain, hero';
const MATCH_COLS = `id, tournament_id AS tournamentId, phase, round, match_number AS matchNumber,
  scheduled_date AS scheduledDate, start_time AS startTime, end_time AS endTime,
  team1_id AS team1Id, team2_id AS team2Id, winner_id AS winnerId,
  team1_kills AS team1Kills, team1_deaths AS team1Deaths, team2_kills AS team2Kills, team2_deaths AS team2Deaths`;
const ADMIN_COLS = 'id, username, password_hash AS passwordHash, created_at AS createdAt';
const SESSION_COLS = 'id, admin_id AS adminId, expires_at AS expiresAt';

type TournamentRow = Omit<Tournament, 'tiebreakers' | 'isActive'> & { tiebreakers: string; isActive: number };
type ScheduleDayRow = Omit<ScheduleDay, 'startTimes'> & { startTimes: string };

function toTournament(row: TournamentRow): Tournament {
  const tiebreakers = row.tiebreakers === '' ? [] : (row.tiebreakers.split(',') as TiebreakerKey[]);
  return { ...row, tiebreakers, isActive: row.isActive === 1 };
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
         group_legs = @groupLegs, rules_text = @rulesText WHERE id = @id`,
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
      'UPDATE teams SET code = @code, name = @name, captain = @captain, hero = @hero WHERE id = @id',
    ),
    deleteTeam: db.prepare('DELETE FROM teams WHERE id = ?'),
    teamHasMatches: db
      .prepare('SELECT EXISTS(SELECT 1 FROM matches WHERE team1_id = @id OR team2_id = @id OR winner_id = @id)')
      .pluck(),

    insertMatch: db.prepare(
      `INSERT INTO matches (tournament_id, phase, round, match_number, scheduled_date, start_time, end_time, team1_id, team2_id)
       VALUES (@tournamentId, @phase, @round, @matchNumber, @scheduledDate, @startTime, @endTime, @team1Id, @team2Id)`,
    ),
    matchById: db.prepare(`SELECT ${MATCH_COLS} FROM matches WHERE id = ?`),
    listMatches: db.prepare(`SELECT ${MATCH_COLS} FROM matches WHERE tournament_id = ? ORDER BY match_number`),
    listMatchesByPhase: db.prepare(
      `SELECT ${MATCH_COLS} FROM matches WHERE tournament_id = ? AND phase = ? ORDER BY match_number`,
    ),
    deleteMatchesByPhase: db.prepare('DELETE FROM matches WHERE tournament_id = ? AND phase = ?'),
    deleteMatch: db.prepare('DELETE FROM matches WHERE id = ?'),
    updateMatch: db.prepare(
      `UPDATE matches SET round = @round, scheduled_date = @scheduledDate, start_time = @startTime,
         end_time = @endTime, team1_id = @team1Id, team2_id = @team2Id WHERE id = @id`,
    ),
    updateSchedule: db.prepare(
      'UPDATE matches SET scheduled_date = @scheduledDate, start_time = @startTime, end_time = @endTime WHERE id = @id',
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
  const matchById = (id: number) => q.matchById.get(id) as Match | undefined;
  const requireRow = <T>(row: T | undefined, what: string): T => {
    if (row === undefined) throw new Error(`${what} not found`);
    return row;
  };

  const withDefaults = (m: NewMatch) => ({
    scheduledDate: null,
    startTime: null,
    endTime: null,
    team1Id: null,
    team2Id: null,
    ...m,
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
      const info = q.insertTeam.run({ captain: null, hero: null, ...input, tournamentId });
      return requireRow(teamById(Number(info.lastInsertRowid)), 'Team');
    },
    getTeam: teamById,
    listTeams: (tournamentId: number) => q.listTeams.all(tournamentId) as Team[],
    updateTeam(id: number, patch: Partial<Pick<Team, 'code' | 'name' | 'captain' | 'hero'>>): Team {
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
      return (phase ? q.listMatchesByPhase.all(tournamentId, phase) : q.listMatches.all(tournamentId)) as Match[];
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
      q.updateMatch.run({ ...edit, id });
      return requireRow(matchById(id), 'Match');
    },
    updateMatchSchedule(id: number, schedule: Schedule): Match {
      q.updateSchedule.run({ ...schedule, id });
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
    deleteSession(id: string): void {
      q.deleteSession.run(id);
    },
    deleteExpiredSessions(now: string): void {
      q.deleteExpiredSessions.run(now);
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;
