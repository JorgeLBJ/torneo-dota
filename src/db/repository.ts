import type Database from 'better-sqlite3';

// All SQL of the application lives in this module.

export type Phase = 'group' | 'semifinal' | 'final';

export interface Tournament {
  id: number;
  name: string;
  slug: string;
  qualifiers: number;
  createdAt: string;
}

export interface Team {
  id: number;
  tournamentId: number;
  code: string;
  name: string;
  captain: string | null;
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

const TOURNAMENT_COLS = 'id, name, slug, qualifiers, created_at AS createdAt';
const TEAM_COLS = 'id, tournament_id AS tournamentId, code, name, captain';
const MATCH_COLS = `id, tournament_id AS tournamentId, phase, round, match_number AS matchNumber,
  scheduled_date AS scheduledDate, start_time AS startTime, end_time AS endTime,
  team1_id AS team1Id, team2_id AS team2Id, winner_id AS winnerId,
  team1_kills AS team1Kills, team1_deaths AS team1Deaths, team2_kills AS team2Kills, team2_deaths AS team2Deaths`;
const ADMIN_COLS = 'id, username, password_hash AS passwordHash, created_at AS createdAt';
const SESSION_COLS = 'id, admin_id AS adminId, expires_at AS expiresAt';

export function createRepository(db: Database.Database) {
  const q = {
    insertTournament: db.prepare('INSERT INTO tournaments (name, slug, qualifiers) VALUES (@name, @slug, @qualifiers)'),
    tournamentById: db.prepare(`SELECT ${TOURNAMENT_COLS} FROM tournaments WHERE id = ?`),
    tournamentBySlug: db.prepare(`SELECT ${TOURNAMENT_COLS} FROM tournaments WHERE slug = ?`),
    listTournaments: db.prepare(`SELECT ${TOURNAMENT_COLS} FROM tournaments ORDER BY id`),
    updateTournament: db.prepare('UPDATE tournaments SET name = @name, slug = @slug, qualifiers = @qualifiers WHERE id = @id'),
    deleteTournament: db.prepare('DELETE FROM tournaments WHERE id = ?'),

    insertTeam: db.prepare(
      'INSERT INTO teams (tournament_id, code, name, captain) VALUES (@tournamentId, @code, @name, @captain)',
    ),
    teamById: db.prepare(`SELECT ${TEAM_COLS} FROM teams WHERE id = ?`),
    listTeams: db.prepare(`SELECT ${TEAM_COLS} FROM teams WHERE tournament_id = ? ORDER BY code`),
    updateTeam: db.prepare('UPDATE teams SET code = @code, name = @name, captain = @captain WHERE id = @id'),
    deleteTeam: db.prepare('DELETE FROM teams WHERE id = ?'),

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

    insertAdmin: db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)'),
    adminById: db.prepare(`SELECT ${ADMIN_COLS} FROM admins WHERE id = ?`),
    adminByUsername: db.prepare(`SELECT ${ADMIN_COLS} FROM admins WHERE username = ?`),

    insertSession: db.prepare('INSERT INTO sessions (id, admin_id, expires_at) VALUES (?, ?, ?)'),
    validSession: db.prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ? AND expires_at > ?`),
    deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
    deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  };

  const tournamentById = (id: number) => q.tournamentById.get(id) as Tournament | undefined;
  const teamById = (id: number) => q.teamById.get(id) as Team | undefined;
  const matchById = (id: number) => q.matchById.get(id) as Match | undefined;
  const requireRow = <T>(row: T | undefined, what: string): T => {
    if (row === undefined) throw new Error(`${what} not found`);
    return row;
  };

  const insertMatchesTx = db.transaction((matches: NewMatch[]) => {
    for (const m of matches) {
      q.insertMatch.run({
        scheduledDate: null,
        startTime: null,
        endTime: null,
        team1Id: null,
        team2Id: null,
        ...m,
      });
    }
  });

  return {
    // Tournaments
    createTournament(input: { name: string; slug: string; qualifiers?: number }): Tournament {
      const info = q.insertTournament.run({ qualifiers: 4, ...input });
      return requireRow(tournamentById(Number(info.lastInsertRowid)), 'Tournament');
    },
    getTournamentById: tournamentById,
    getTournamentBySlug: (slug: string) => q.tournamentBySlug.get(slug) as Tournament | undefined,
    listTournaments: () => q.listTournaments.all() as Tournament[],
    updateTournament(id: number, patch: Partial<Pick<Tournament, 'name' | 'slug' | 'qualifiers'>>): Tournament {
      const current = requireRow(tournamentById(id), 'Tournament');
      q.updateTournament.run({ ...current, ...patch, id });
      return requireRow(tournamentById(id), 'Tournament');
    },
    deleteTournament(id: number): void {
      q.deleteTournament.run(id);
    },

    // Teams
    createTeam(tournamentId: number, input: { code: string; name: string; captain?: string | null }): Team {
      const info = q.insertTeam.run({ captain: null, ...input, tournamentId });
      return requireRow(teamById(Number(info.lastInsertRowid)), 'Team');
    },
    getTeam: teamById,
    listTeams: (tournamentId: number) => q.listTeams.all(tournamentId) as Team[],
    updateTeam(id: number, patch: Partial<Pick<Team, 'code' | 'name' | 'captain'>>): Team {
      const current = requireRow(teamById(id), 'Team');
      q.updateTeam.run({ ...current, ...patch, id });
      return requireRow(teamById(id), 'Team');
    },
    deleteTeam(id: number): void {
      q.deleteTeam.run(id);
    },

    // Matches
    insertMatches(matches: NewMatch[]): void {
      insertMatchesTx(matches);
    },
    getMatch: matchById,
    listMatches(tournamentId: number, phase?: Phase): Match[] {
      return (phase ? q.listMatchesByPhase.all(tournamentId, phase) : q.listMatches.all(tournamentId)) as Match[];
    },
    deleteMatches(tournamentId: number, phase: Phase): void {
      q.deleteMatchesByPhase.run(tournamentId, phase);
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
    getAdminByUsername: (username: string) => q.adminByUsername.get(username) as Admin | undefined,

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
