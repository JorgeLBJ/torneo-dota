import type Database from 'better-sqlite3';
import { isHeroSlug } from '../data/heroes.js';
import { bannerState, type BannerTab } from '../domain/banners.js';
import { initialSeriesLengths, isTournamentFormat, type TournamentFormat } from '../domain/formats.js';
import { liveEligibility, type LiveMark } from '../domain/live.js';
import { resolveSeries, seriesLengthFor, type GameScore, type SeriesLength } from '../domain/series.js';
import { isValidTimeZone, utcToZoned, zonedToUtc } from '../format/timezone.js';

// All SQL of the application lives in this module.

export type Phase = 'group' | 'semifinal' | 'final';
export type TiebreakerKey = 'kd' | 'kills' | 'h2h' | 'extra';

export interface Tournament {
  id: number;
  name: string;
  slug: string;
  /** Chosen at creation and fixed afterwards. */
  format: TournamentFormat;
  qualifiers: number;
  game: string;
  pointsWin: number;
  pointsLoss: number;
  /** Ordered tiebreak criteria applied after points. */
  tiebreakers: TiebreakerKey[];
  groupLegs: 1 | 2;
  /** Games per match (best of 1, 3 or 5) in each phase. */
  groupGames: SeriesLength;
  semifinalGames: SeriesLength;
  finalGames: SeriesLength;
  rulesText: string;
  /** The sanitized rich-text rulebook; null until it is first saved from the editor (then rulesText is converted). */
  rulesHtml: string | null;
  /** Whether the public Reglas tab shows the auto-generated "Desempate" box. */
  showTiebreakBox: boolean;
  /** IANA zone that wall-clock schedule inputs are read in and admin times are shown in. */
  timezone: string;
  /** A Kick/Twitch/YouTube page URL as the admin entered it (validated); the embed is derived from it. */
  streamUrl: string | null;
  isActive: boolean;
  /** The live match whose game is on the stream, or null (optional; always one of the tournament's live matches). */
  streamMatchId: number | null;
  /** ISO 8601 UTC instant it was archived (hidden from the admin selector), or null. */
  archivedAt: string | null;
  createdAt: string;
}

export type TournamentPatch = Partial<
  Omit<Tournament, 'id' | 'createdAt' | 'isActive' | 'streamMatchId' | 'format' | 'archivedAt'>
>;

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

/** One game of a match's series. `dotaSnapshot` is the compact JSON of an imported Dota match, or null. */
export interface Game {
  id: number;
  matchId: number;
  gameNumber: number;
  winnerId: number;
  team1Kills: number;
  team1Deaths: number;
  team2Kills: number;
  team2Deaths: number;
  radiantTeamId: number | null;
  dotaMatchId: number | null;
  dotaSnapshot: string | null;
  /** Where the imported detail came from (read from the snapshot without loading it); null for a manual game. */
  dotaSource: 'opendota' | 'gsi' | null;
  importedAt: string | null;
}

export interface GameInput {
  gameNumber: number;
  winnerId: number;
  team1Kills: number;
  team1Deaths: number;
  team2Kills: number;
  team2Deaths: number;
  radiantTeamId?: number | null;
  dotaMatchId?: number | null;
  dotaSnapshot?: string | null;
  importedAt?: string | null;
}

const gameCols = (p: string, snapshot = true) => `${p}id, ${p}match_id AS matchId, ${p}game_number AS gameNumber, ${p}winner_id AS winnerId,
  ${p}team1_kills AS team1Kills, ${p}team1_deaths AS team1Deaths, ${p}team2_kills AS team2Kills, ${p}team2_deaths AS team2Deaths,
  ${p}radiant_team_id AS radiantTeamId, ${p}dota_match_id AS dotaMatchId, ${snapshot ? `${p}dota_snapshot` : 'NULL'} AS dotaSnapshot, ${p}imported_at AS importedAt,
  CASE WHEN ${p}dota_snapshot IS NULL THEN NULL WHEN json_valid(${p}dota_snapshot) AND json_extract(${p}dota_snapshot, '$.source') = 'gsi' THEN 'gsi' ELSE 'opendota' END AS dotaSource`;

export interface Admin {
  id: number;
  username: string;
  passwordHash: string;
  createdAt: string;
}

export interface ObserverToken {
  id: number;
  name: string;
  /** First characters of the token, to tell tokens apart; the token itself is never stored. */
  tokenPrefix: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

/** A welcome banner of a tournament (see migration 015). Instants are ISO UTC strings. */
export interface Banner {
  id: number;
  tournamentId: number;
  /** Only the admin sees the name. */
  name: string;
  altText: string;
  /** The 1920 px WebP; width and height are its real size. */
  imageKey: string;
  imageWidth: number;
  imageHeight: number;
  /** The 1280 px WebP (or the same size when the upload was smaller: never enlarged). */
  imageKeySmall: string;
  imageWidthSmall: number;
  ctaText: string | null;
  ctaTab: BannerTab | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  /** Grows with every change; the browser keys "already shown" on id + version. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type NewBanner = Omit<Banner, 'id' | 'tournamentId' | 'version' | 'createdAt' | 'updatedAt'>;

export interface BannerUpdate {
  name: string;
  altText: string;
  ctaText: string | null;
  ctaTab: BannerTab | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  /** Undefined keeps the stored image. */
  image?: { key: string; width: number; height: number; keySmall: string; widthSmall: number };
}

const BANNER_COLS = `id, tournament_id AS tournamentId, name, alt_text AS altText, image_key AS imageKey, image_width AS imageWidth,
  image_height AS imageHeight, image_key_sm AS imageKeySmall, image_width_sm AS imageWidthSmall, cta_text AS ctaText, cta_tab AS ctaTab,
  active, starts_at AS startsAt, ends_at AS endsAt, version, created_at AS createdAt, updated_at AS updatedAt`;

type BannerRow = Omit<Banner, 'active'> & { active: number };

const toBanner = (row: BannerRow): Banner => ({ ...row, active: row.active === 1 });

export interface GsiCapture {
  dotaMatchId: number;
  observerTokenId: number | null;
  gameState: string | null;
  isFinal: boolean;
  /** The payload as the Dota client sent it, minus the auth block. */
  stateJson: string;
  /** UTC, 'YYYY-MM-DD HH:MM:SS'. */
  firstReceivedAt: string;
  updatedAt: string;
}

/** The saved game that used a capture's Dota match id. */
export interface GsiCaptureLink {
  tournamentId: number;
  tournamentName: string;
  matchId: number;
  phase: Phase;
  round: number;
  matchNumber: number;
  team1Name: string | null;
  team2Name: string | null;
  gameNumber: number;
}

/** A capture as the admin list shows it: score and duration are read from the stored JSON without loading it. */
export interface GsiCaptureRow {
  dotaMatchId: number;
  observerName: string | null;
  gameState: string | null;
  isFinal: boolean;
  firstReceivedAt: string;
  updatedAt: string;
  radiantScore: number | null;
  direScore: number | null;
  durationSec: number | null;
  winner: 'radiant' | 'dire' | null;
  link: GsiCaptureLink | null;
}

export interface Session {
  id: string;
  adminId: number;
  expiresAt: string;
}

export const TIEBREAKER_KEYS = ['kd', 'kills', 'h2h', 'extra'] as const;

const TOURNAMENT_COLS = `id, name, slug, format, qualifiers, game, points_win AS pointsWin, points_loss AS pointsLoss,
  tiebreakers, group_legs AS groupLegs, group_games AS groupGames, semifinal_games AS semifinalGames, final_games AS finalGames,
  stream_match_id AS streamMatchId,
  rules_text AS rulesText, rules_html AS rulesHtml, show_tiebreak_box AS showTiebreakBox, timezone, stream_url AS streamUrl, is_active AS isActive,
  archived_at AS archivedAt, created_at AS createdAt`;
const TEAM_COLS = 'id, tournament_id AS tournamentId, code, name, captain, hero, image_key AS imageKey';
const MATCH_COLS = `m.id, m.tournament_id AS tournamentId, m.phase, m.round, m.match_number AS matchNumber, m.is_tiebreak AS isTiebreak,
  m.starts_at AS startsAt, m.ends_at AS endsAt, t.timezone AS timezone,
  m.team1_id AS team1Id, m.team2_id AS team2Id, m.winner_id AS winnerId,
  m.team1_kills AS team1Kills, m.team1_deaths AS team1Deaths, m.team2_kills AS team2Kills, m.team2_deaths AS team2Deaths`;
const MATCH_FROM = 'FROM matches m JOIN tournaments t ON t.id = m.tournament_id';
const OBSERVER_COLS = `id, name, token_prefix AS tokenPrefix, created_at AS createdAt, last_seen_at AS lastSeenAt, revoked_at AS revokedAt`;
const GSI_COLS = `dota_match_id AS dotaMatchId, observer_token_id AS observerTokenId, game_state AS gameState, is_final AS isFinal,
  state_json AS stateJson, first_received_at AS firstReceivedAt, updated_at AS updatedAt`;
// Score, duration and winner come from json_extract so the list never loads the (large) stored payloads.
const gsiJson = (path: string) => `CASE WHEN json_valid(c.state_json) THEN json_extract(c.state_json, '${path}') END`;
const GSI_ROW_SELECT = `SELECT c.dota_match_id AS dotaMatchId, o.name AS observerName, c.game_state AS gameState, c.is_final AS isFinal,
  c.first_received_at AS firstReceivedAt, c.updated_at AS updatedAt,
  ${gsiJson('$.map.radiant_score')} AS radiantScore, ${gsiJson('$.map.dire_score')} AS direScore,
  ${gsiJson('$.map.clock_time')} AS durationSec, ${gsiJson('$.map.win_team')} AS winTeam,
  g.game_number AS linkGame, m.id AS linkMatchId, m.phase AS linkPhase, m.round AS linkRound, m.match_number AS linkNumber,
  t.id AS linkTournamentId, t.name AS linkTournamentName, t1.name AS linkTeam1, t2.name AS linkTeam2
  FROM gsi_captures c
  LEFT JOIN observer_tokens o ON o.id = c.observer_token_id
  LEFT JOIN match_games g ON g.dota_match_id = c.dota_match_id
  LEFT JOIN matches m ON m.id = g.match_id
  LEFT JOIN tournaments t ON t.id = m.tournament_id
  LEFT JOIN teams t1 ON t1.id = m.team1_id
  LEFT JOIN teams t2 ON t2.id = m.team2_id`;
const ADMIN_COLS = 'id, username, password_hash AS passwordHash, created_at AS createdAt';
const SESSION_COLS = 'id, admin_id AS adminId, expires_at AS expiresAt';

type TournamentRow = Omit<Tournament, 'tiebreakers' | 'isActive' | 'showTiebreakBox' | 'format'> & {
  format: string;
  tiebreakers: string;
  isActive: number;
  showTiebreakBox: number;
};
type MatchRow = Omit<Match, 'scheduledDate' | 'startTime' | 'endTime' | 'isTiebreak'> & { timezone: string; isTiebreak: number };

function toMatch({ timezone, ...row }: MatchRow): Match {
  const start = row.startsAt ? utcToZoned(row.startsAt, timezone) : null;
  const end = row.endsAt ? utcToZoned(row.endsAt, timezone) : null;
  return { ...row, isTiebreak: row.isTiebreak === 1, scheduledDate: start?.date ?? null, startTime: start?.time ?? null, endTime: end?.time ?? null };
}

type ScheduleDayRow = Omit<ScheduleDay, 'startTimes'> & { startTimes: string };

function toTournament(row: TournamentRow): Tournament {
  const known = row.tiebreakers.split(',').filter((k): k is TiebreakerKey => (TIEBREAKER_KEYS as readonly string[]).includes(k));
  // The column has no CHECK (see migration 016); an unknown key is read as the original format.
  const format = isTournamentFormat(row.format) ? row.format : 'league_playoffs';
  return { ...row, format, tiebreakers: [...new Set(known)], isActive: row.isActive === 1, showTiebreakBox: row.showTiebreakBox === 1 };
}

interface RawGsiRow {
  dotaMatchId: number;
  observerName: string | null;
  gameState: string | null;
  isFinal: number;
  firstReceivedAt: string;
  updatedAt: string;
  radiantScore: unknown;
  direScore: unknown;
  durationSec: unknown;
  winTeam: unknown;
  linkGame: number | null;
  linkMatchId: number | null;
  linkPhase: Phase | null;
  linkRound: number | null;
  linkNumber: number | null;
  linkTournamentId: number | null;
  linkTournamentName: string | null;
  linkTeam1: string | null;
  linkTeam2: string | null;
}

const finiteOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function toGsiRow(r: RawGsiRow): GsiCaptureRow {
  const duration = finiteOrNull(r.durationSec);
  return {
    dotaMatchId: r.dotaMatchId,
    observerName: r.observerName,
    gameState: r.gameState,
    isFinal: r.isFinal === 1,
    firstReceivedAt: r.firstReceivedAt,
    updatedAt: r.updatedAt,
    radiantScore: finiteOrNull(r.radiantScore),
    direScore: finiteOrNull(r.direScore),
    durationSec: duration === null ? null : Math.floor(duration),
    winner: r.winTeam === 'radiant' || r.winTeam === 'dire' ? r.winTeam : null,
    link:
      r.linkMatchId === null || r.linkTournamentId === null || r.linkPhase === null
        ? null
        : {
            tournamentId: r.linkTournamentId,
            tournamentName: r.linkTournamentName ?? '',
            matchId: r.linkMatchId,
            phase: r.linkPhase,
            round: r.linkRound ?? 0,
            matchNumber: r.linkNumber ?? 0,
            team1Name: r.linkTeam1,
            team2Name: r.linkTeam2,
            gameNumber: r.linkGame ?? 1,
          },
  };
}

export function createRepository(db: Database.Database, now: () => Date = () => new Date()) {
  const q = {
    insertTournament: db.prepare(
      `INSERT INTO tournaments (name, slug, format, qualifiers, semifinal_games, final_games)
       VALUES (@name, @slug, @format, @qualifiers, @semifinalGames, @finalGames)`,
    ),
    tournamentById: db.prepare(`SELECT ${TOURNAMENT_COLS} FROM tournaments WHERE id = ?`),
    tournamentBySlug: db.prepare(`SELECT ${TOURNAMENT_COLS} FROM tournaments WHERE slug = ?`),
    listTournaments: db.prepare(`SELECT ${TOURNAMENT_COLS} FROM tournaments ORDER BY id`),
    updateTournament: db.prepare(
      `UPDATE tournaments SET name = @name, slug = @slug, qualifiers = @qualifiers, game = @game,
         points_win = @pointsWin, points_loss = @pointsLoss, tiebreakers = @tiebreakers,
         group_legs = @groupLegs, group_games = @groupGames, semifinal_games = @semifinalGames, final_games = @finalGames,
         rules_text = @rulesText, rules_html = @rulesHtml, show_tiebreak_box = @showTiebreakBox, timezone = @timezone, stream_url = @streamUrl WHERE id = @id`,
    ),
    setLive: db.prepare('UPDATE matches SET live_game_number = @gameNumber, live_started_at = @startedAt WHERE id = @id'),
    setStream: db.prepare('UPDATE tournaments SET stream_match_id = @matchId WHERE id = @id'),
    clearStreamOf: db.prepare('UPDATE tournaments SET stream_match_id = NULL WHERE stream_match_id = ?'),
    liveOfMatch: db.prepare(
      'SELECT id AS matchId, live_game_number AS gameNumber, live_started_at AS startedAt FROM matches WHERE id = ? AND live_game_number IS NOT NULL AND live_started_at IS NOT NULL',
    ),
    // The match on the stream first, then by the moment each was marked.
    liveOfTournament: db.prepare(
      `SELECT m.id AS matchId, m.live_game_number AS gameNumber, m.live_started_at AS startedAt
         FROM matches m JOIN tournaments t ON t.id = m.tournament_id
        WHERE m.tournament_id = ? AND m.live_game_number IS NOT NULL AND m.live_started_at IS NOT NULL
        ORDER BY (t.stream_match_id = m.id) DESC, m.live_started_at, m.id`,
    ),
    activeTournament: db.prepare(`SELECT ${TOURNAMENT_COLS} FROM tournaments WHERE is_active = 1`),
    clearActive: db.prepare('UPDATE tournaments SET is_active = 0 WHERE is_active = 1'),
    markActive: db.prepare('UPDATE tournaments SET is_active = 1 WHERE id = ?'),
    deleteTournament: db.prepare('DELETE FROM tournaments WHERE id = ?'),
    setArchivedAt: db.prepare('UPDATE tournaments SET archived_at = ? WHERE id = ?'),

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
    setAggregate: db.prepare(
      `UPDATE matches SET winner_id = @winnerId, team1_kills = @team1Kills, team1_deaths = @team1Deaths,
         team2_kills = @team2Kills, team2_deaths = @team2Deaths WHERE id = @id`,
    ),
    gamesByMatch: db.prepare(`SELECT ${gameCols('')} FROM match_games WHERE match_id = ? ORDER BY game_number`),
    // Without the (few KB) snapshots: the tournament state is rebuilt on every public update.
    gamesByTournament: db.prepare(
      `SELECT ${gameCols('g.', false)} FROM match_games g JOIN matches m ON m.id = g.match_id
       WHERE m.tournament_id = ? ORDER BY g.match_id, g.game_number`,
    ),
    upsertGame: db.prepare(
      `INSERT INTO match_games (match_id, game_number, winner_id, team1_kills, team1_deaths, team2_kills, team2_deaths,
         radiant_team_id, dota_match_id, dota_snapshot, imported_at)
       VALUES (@matchId, @gameNumber, @winnerId, @team1Kills, @team1Deaths, @team2Kills, @team2Deaths,
         @radiantTeamId, @dotaMatchId, @dotaSnapshot, @importedAt)
       ON CONFLICT (match_id, game_number) DO UPDATE SET winner_id = excluded.winner_id,
         team1_kills = excluded.team1_kills, team1_deaths = excluded.team1_deaths,
         team2_kills = excluded.team2_kills, team2_deaths = excluded.team2_deaths,
         radiant_team_id = excluded.radiant_team_id, dota_match_id = excluded.dota_match_id,
         dota_snapshot = excluded.dota_snapshot, imported_at = excluded.imported_at`,
    ),
    deleteGame: db.prepare('DELETE FROM match_games WHERE match_id = ? AND game_number = ?'),
    deleteGames: db.prepare('DELETE FROM match_games WHERE match_id = ?'),
    matchIdsOfTournament: db.prepare('SELECT id FROM matches WHERE tournament_id = ?').pluck(),
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
    insertObserver: db.prepare('INSERT INTO observer_tokens (name, token_hash, token_prefix) VALUES (?, ?, ?)'),
    observerById: db.prepare(`SELECT ${OBSERVER_COLS} FROM observer_tokens WHERE id = ?`),
    listObservers: db.prepare(`SELECT ${OBSERVER_COLS} FROM observer_tokens ORDER BY id DESC`),
    activeObserverByHash: db.prepare(`SELECT ${OBSERVER_COLS} FROM observer_tokens WHERE token_hash = ? AND revoked_at IS NULL`),
    revokeObserver: db.prepare("UPDATE observer_tokens SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL"),
    // The WHERE on the conflict branch is what keeps a final capture immutable.
    upsertGsi: db.prepare(`INSERT INTO gsi_captures (dota_match_id, observer_token_id, game_state, is_final, state_json) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (dota_match_id) DO UPDATE SET observer_token_id = excluded.observer_token_id, game_state = excluded.game_state,
        is_final = excluded.is_final, state_json = excluded.state_json, updated_at = datetime('now')
      WHERE gsi_captures.is_final = 0`),
    gsiById: db.prepare(`SELECT ${GSI_COLS} FROM gsi_captures WHERE dota_match_id = ?`),
    gsiRows: db.prepare(`${GSI_ROW_SELECT} GROUP BY c.dota_match_id ORDER BY c.updated_at DESC, c.dota_match_id DESC LIMIT ?`),
    gsiRowById: db.prepare(`${GSI_ROW_SELECT} WHERE c.dota_match_id = ? GROUP BY c.dota_match_id`),
    deleteGsi: db.prepare('DELETE FROM gsi_captures WHERE dota_match_id = ?'),
    gsiCountsByObserver: db.prepare('SELECT observer_token_id AS id, COUNT(*) AS n FROM gsi_captures WHERE observer_token_id IS NOT NULL GROUP BY observer_token_id'),
    gsiUnlinkedFinal: db.prepare(`SELECT COUNT(*) AS n FROM gsi_captures c
      WHERE c.is_final = 1 AND NOT EXISTS (SELECT 1 FROM match_games g WHERE g.dota_match_id = c.dota_match_id)`),
    touchObserver: db.prepare("UPDATE observer_tokens SET last_seen_at = datetime('now') WHERE id = ?"),
    insertBanner: db.prepare(`INSERT INTO promo_banners (tournament_id, name, alt_text, image_key, image_width, image_height, image_key_sm,
      image_width_sm, cta_text, cta_tab, active, starts_at, ends_at)
      VALUES (@tournamentId, @name, @altText, @imageKey, @imageWidth, @imageHeight, @imageKeySmall, @imageWidthSmall, @ctaText, @ctaTab, @active, @startsAt, @endsAt)`),
    bannerById: db.prepare(`SELECT ${BANNER_COLS} FROM promo_banners WHERE id = ?`),
    listBanners: db.prepare(`SELECT ${BANNER_COLS} FROM promo_banners WHERE tournament_id = ? ORDER BY id DESC`),
    activeBanners: db.prepare(`SELECT ${BANNER_COLS} FROM promo_banners WHERE tournament_id = ? AND active = 1 ORDER BY id DESC`),
    updateBanner: db.prepare(`UPDATE promo_banners SET name = @name, alt_text = @altText, cta_text = @ctaText, cta_tab = @ctaTab, active = @active,
      starts_at = @startsAt, ends_at = @endsAt, version = version + 1, updated_at = datetime('now') WHERE id = @id`),
    updateBannerImage: db.prepare(`UPDATE promo_banners SET image_key = @key, image_width = @width, image_height = @height,
      image_key_sm = @keySmall, image_width_sm = @widthSmall WHERE id = @id`),
    setBannerActive: db.prepare("UPDATE promo_banners SET active = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?"),
    deleteBanner: db.prepare('DELETE FROM promo_banners WHERE id = ?'),
    deleteOtherSessions: db.prepare('DELETE FROM sessions WHERE admin_id = ? AND id <> ?'),

    insertSession: db.prepare('INSERT INTO sessions (id, admin_id, expires_at) VALUES (?, ?, ?)'),
    validSession: db.prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ? AND expires_at > ?`),
    deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
    deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  };

  const bannerById = (id: number): Banner | undefined => {
    const row = q.bannerById.get(id) as BannerRow | undefined;
    return row && toBanner(row);
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

  /**
   * Saves several teams at once in ONE transaction: fields, hero and (when `key` is given; null clears it) image key.
   * The previous keys are read inside it, so concurrent saves each see a distinct previous key and never share an
   * object. Codes and heroes are freed first, so teams can swap them without tripping the unique indexes; the caller
   * has already validated the final state.
   */
  const saveTeamsBatchTx = db.transaction(
    (tournamentId: number, updates: TeamUpdate[]): { ok: true; teams: Team[]; previous: Record<number, string | null> } | { ok: false; missingId: number } => {
      const previous: Record<number, string | null> = {};
      for (const update of updates) {
        const current = teamById(update.id);
        if (!current || current.tournamentId !== tournamentId) return { ok: false, missingId: update.id };
        previous[update.id] = current.imageKey;
      }
      const free = db.prepare("UPDATE teams SET code = '~' || id, hero = NULL WHERE id = ?");
      for (const update of updates) free.run(update.id);
      for (const update of updates) {
        const current = requireRow(teamById(update.id), 'Team');
        q.updateTeam.run({ ...current, ...update.fields, imageKey: update.key === undefined ? previous[update.id] : update.key, id: update.id });
      }
      return { ok: true, teams: updates.map((update) => requireRow(teamById(update.id), 'Team')), previous };
    },
  );

  const gamesOf = (matchId: number): Game[] => q.gamesByMatch.all(matchId) as Game[];

  /**
   * Keeps matches.winner_id / kills / deaths equal to what the games say: the series winner (null while undecided)
   * and the sums over the games (null while there are none). Called in the same transaction as every game change.
   */
  const refreshAggregate = (matchId: number): void => {
    const match = matchById(matchId);
    if (!match) return;
    const tournament = tournamentById(match.tournamentId);
    const games = gamesOf(matchId);
    if (!tournament || games.length === 0 || match.team1Id === null || match.team2Id === null) {
      q.setAggregate.run({ id: matchId, winnerId: null, team1Kills: null, team1Deaths: null, team2Kills: null, team2Deaths: null });
      return;
    }
    const scores: GameScore[] = games;
    const state = resolveSeries(match.team1Id, match.team2Id, seriesLengthFor(tournament, match.phase, match.isTiebreak), scores);
    q.setAggregate.run({ id: matchId, winnerId: state.winnerId, ...state.totals });
  };

  const gameParams = (matchId: number, game: GameInput) => ({
    matchId,
    gameNumber: game.gameNumber,
    winnerId: game.winnerId,
    team1Kills: game.team1Kills,
    team1Deaths: game.team1Deaths,
    team2Kills: game.team2Kills,
    team2Deaths: game.team2Deaths,
    radiantTeamId: game.radiantTeamId ?? null,
    dotaMatchId: game.dotaMatchId ?? null,
    dotaSnapshot: game.dotaSnapshot ?? null,
    importedAt: game.importedAt ?? null,
  });

  const assertWinner = (matchId: number, winnerId: number): void => {
    const match = requireRow(matchById(matchId), 'Match');
    if (winnerId !== match.team1Id && winnerId !== match.team2Id) throw new Error('The winner must be one of the match teams');
  };

  /** Turns one match's live mark off, and takes it off the stream with it. */
  const clearLiveOf = (matchId: number): void => {
    q.setLive.run({ id: matchId, gameNumber: null, startedAt: null });
    q.clearStreamOf.run(matchId);
  };

  /**
   * Turns the live mark of a match off when it stopped being true: its game is no longer the next unplayed game of
   * an undecided series (it got a result, the series was decided or reset, the length changed) or the match lost a
   * team. Called in the same transaction as every change that can cause it.
   */
  const reconcileLiveOf = (matchId: number): void => {
    const match = matchById(matchId);
    const live = q.liveOfMatch.get(matchId) as { gameNumber: number } | undefined;
    if (!match || !live) return;
    const tournament = requireRow(tournamentById(match.tournamentId), 'Tournament');
    const invalid =
      liveEligibility(match.team1Id, match.team2Id, seriesLengthFor(tournament, match.phase, match.isTiebreak), gamesOf(match.id), live.gameNumber) !== null;
    if (invalid) clearLiveOf(matchId);
  };

  /**
   * After a game is saved: when it was the live game of a series that is still open, the mark moves on to the next game
   * (started now, still on the stream if the match was); otherwise the usual reconciliation turns the mark off.
   */
  const advanceLiveAfterSave = (matchId: number, savedGame: number): void => {
    const match = matchById(matchId);
    const live = q.liveOfMatch.get(matchId) as { gameNumber: number } | undefined;
    if (match && live && live.gameNumber === savedGame) {
      const tournament = requireRow(tournamentById(match.tournamentId), 'Tournament');
      const length = seriesLengthFor(tournament, match.phase, match.isTiebreak);
      if (liveEligibility(match.team1Id, match.team2Id, length, gamesOf(matchId), savedGame + 1) === null) {
        q.setLive.run({ id: matchId, gameNumber: savedGame + 1, startedAt: now().toISOString() });
        return;
      }
    }
    reconcileLiveOf(matchId);
  };

  const reconcileLive = (tournamentId: number): void => {
    for (const mark of q.liveOfTournament.all(tournamentId) as { matchId: number }[]) reconcileLiveOf(mark.matchId);
  };

  /** A different pairing in a live match is a different match: the mark goes. The same pairing keeps it. */
  const dropLiveIfPairingChanged = (before: Match, team1Id: number | null, team2Id: number | null): void => {
    if (before.team1Id !== team1Id || before.team2Id !== team2Id) clearLiveOf(before.id);
    else reconcileLiveOf(before.id);
  };

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
    createTournament(input: { name: string; slug: string; qualifiers?: number; format?: TournamentFormat }): Tournament {
      const format = input.format ?? 'league_playoffs';
      const info = q.insertTournament.run({ qualifiers: 4, ...input, format, ...initialSeriesLengths(format) });
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
      return inTransaction(() => {
        const before = requireRow(tournamentById(id), 'Tournament');
        q.updateTournament.run({ ...next, tiebreakers: next.tiebreakers.join(','), showTiebreakBox: next.showTiebreakBox ? 1 : 0 });
        // A different series length changes who wins the matches that already have games.
        if (before.groupGames !== next.groupGames || before.semifinalGames !== next.semifinalGames || before.finalGames !== next.finalGames) {
          for (const matchId of q.matchIdsOfTournament.all(id) as number[]) refreshAggregate(matchId);
          reconcileLive(id);
        }
        return requireRow(tournamentById(id), 'Tournament');
      });
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
    /** Hides the tournament from the admin selector (the caller keeps the active one out). */
    archiveTournament(id: number): Tournament {
      if (q.setArchivedAt.run(now().toISOString(), id).changes === 0) throw new Error('Tournament not found');
      return requireRow(tournamentById(id), 'Tournament');
    },
    restoreTournament(id: number): Tournament {
      if (q.setArchivedAt.run(null, id).changes === 0) throw new Error('Tournament not found');
      return requireRow(tournamentById(id), 'Tournament');
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
    /** Atomically saves many teams (see saveTeamsBatchTx); returns the image keys it replaced. */
    saveTeamsBatch(tournamentId: number, updates: TeamUpdate[]) {
      for (const update of updates) requireHero(update.fields.hero);
      return saveTeamsBatchTx(tournamentId, updates);
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
      return inTransaction(() => {
        q.updateMatch.run({ ...edit, ...instants(current.tournamentId, edit), id });
        dropLiveIfPairingChanged(current, edit.team1Id, edit.team2Id);
        return requireRow(matchById(id), 'Match');
      });
    },
    updateMatchSchedule(id: number, schedule: Schedule): Match {
      const current = requireRow(matchById(id), 'Match');
      q.updateSchedule.run({ ...instants(current.tournamentId, schedule), id });
      return requireRow(matchById(id), 'Match');
    },
    updateMatchTeams(id: number, team1Id: number | null, team2Id: number | null): Match {
      const current = requireRow(matchById(id), 'Match');
      return inTransaction(() => {
        q.updateMatchTeams.run({ team1Id, team2Id, id });
        dropLiveIfPairingChanged(current, team1Id, team2Id);
        return requireRow(matchById(id), 'Match');
      });
    },
    /** Decides a match with one game: replaces every game of the match by game 1 (the legacy "single result"). */
    recordResult(id: number, result: MatchResult): Match {
      return inTransaction(() => {
        assertWinner(id, result.winnerId);
        q.deleteGames.run(id);
        q.upsertGame.run(gameParams(id, { gameNumber: 1, ...result }));
        refreshAggregate(id);
        reconcileLiveOf(id);
        return requireRow(matchById(id), 'Match');
      });
    },
    /** Removes every game of the match and with them its result. */
    clearResult(id: number): Match {
      return inTransaction(() => {
        q.deleteGames.run(id);
        refreshAggregate(id);
        reconcileLiveOf(id);
        return requireRow(matchById(id), 'Match');
      });
    },

    // The games being played right now, one per match. The application decides what may be marked (see
    // domain/live.ts); the repository only stores it, and turns it off by itself whenever a change makes it untrue.
    /** Live games of the tournament: the one on the stream first, then by the moment they were marked. */
    listLive: (tournamentId: number): LiveMark[] => q.liveOfTournament.all(tournamentId) as LiveMark[],
    /** Marks a game of the match as live (replacing the match's previous one), or clears it with null (and its stream mark). */
    setLive(matchId: number, live: { gameNumber: number; startedAt: string } | null): void {
      if (live) q.setLive.run({ id: matchId, gameNumber: live.gameNumber, startedAt: live.startedAt });
      else clearLiveOf(matchId);
    },
    /** Puts a live match on the stream (replacing the previous one) or takes it off with null. */
    setStream(tournamentId: number, matchId: number | null): void {
      if (matchId !== null) {
        const match = matchById(matchId);
        if (!match || match.tournamentId !== tournamentId) throw new Error('The stream match must belong to the tournament');
        if (!q.liveOfMatch.get(matchId)) throw new Error('Only a live match can be on the stream');
      }
      q.setStream.run({ id: tournamentId, matchId });
    },

    // Games (the series of a match). The match's winner and kills/deaths are re-derived in the same transaction.
    listGames: gamesOf,
    /** Every game of the tournament, ordered by match then game number. `dotaSnapshot` is always null here: read a match's games for it. */
    listTournamentGames: (tournamentId: number): Game[] => q.gamesByTournament.all(tournamentId) as Game[],
    saveGame(matchId: number, game: GameInput): Match {
      return inTransaction(() => {
        assertWinner(matchId, game.winnerId);
        q.upsertGame.run(gameParams(matchId, game));
        refreshAggregate(matchId);
        advanceLiveAfterSave(matchId, game.gameNumber);
        return requireRow(matchById(matchId), 'Match');
      });
    },
    deleteGame(matchId: number, gameNumber: number): Match {
      return inTransaction(() => {
        q.deleteGame.run(matchId, gameNumber);
        refreshAggregate(matchId);
        reconcileLiveOf(matchId);
        return requireRow(matchById(matchId), 'Match');
      });
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

    // Observer tokens (Game State Integration)
    createObserverToken(name: string, tokenHash: string, tokenPrefix: string): ObserverToken {
      const info = q.insertObserver.run(name, tokenHash, tokenPrefix);
      return requireRow(q.observerById.get(Number(info.lastInsertRowid)) as ObserverToken | undefined, 'Observer token');
    },
    listObserverTokens: () => q.listObservers.all() as ObserverToken[],
    getObserverToken: (id: number) => q.observerById.get(id) as ObserverToken | undefined,
    findActiveObserverByHash: (tokenHash: string) => q.activeObserverByHash.get(tokenHash) as ObserverToken | undefined,
    /** Revoking twice keeps the first revocation time. */
    revokeObserverToken(id: number): void {
      q.revokeObserver.run(id);
    },
    touchObserverLastSeen(id: number): void {
      q.touchObserver.run(id);
    },

    // Game State Integration captures
    /** Stores the latest state of a match; a capture that is already final is left untouched. Returns whether it wrote. */
    upsertGsiCapture(dotaMatchId: number, observerTokenId: number | null, gameState: string | null, isFinal: boolean, stateJson: string): boolean {
      return q.upsertGsi.run(dotaMatchId, observerTokenId, gameState, isFinal ? 1 : 0, stateJson).changes > 0;
    },
    getGsiCapture(dotaMatchId: number): GsiCapture | undefined {
      const row = q.gsiById.get(dotaMatchId) as (Omit<GsiCapture, 'isFinal'> & { isFinal: number }) | undefined;
      return row && { ...row, isFinal: row.isFinal === 1 };
    },
    /** The most recently updated captures, with their score and the saved game that used them (if any). */
    listGsiCaptureRows: (limit: number): GsiCaptureRow[] => (q.gsiRows.all(limit) as RawGsiRow[]).map(toGsiRow),
    getGsiCaptureRow(dotaMatchId: number): GsiCaptureRow | undefined {
      const row = q.gsiRowById.get(dotaMatchId) as RawGsiRow | undefined;
      return row && toGsiRow(row);
    },
    /** Returns whether a capture was deleted. A saved game that used it is not touched. */
    deleteGsiCapture: (dotaMatchId: number): boolean => q.deleteGsi.run(dotaMatchId).changes > 0,
    /** Captures per observer token id. */
    countGsiCapturesByObserver: (): Map<number, number> =>
      new Map((q.gsiCountsByObserver.all() as { id: number; n: number }[]).map((r) => [r.id, r.n])),
    /** Final captures whose Dota match id no saved game uses yet. */
    countUnlinkedFinalGsiCaptures: (): number => (q.gsiUnlinkedFinal.get() as { n: number }).n,

    // Welcome banners
    createBanner(tournamentId: number, input: NewBanner): Banner {
      const info = q.insertBanner.run({ ...input, tournamentId, active: input.active ? 1 : 0 });
      return requireRow(bannerById(Number(info.lastInsertRowid)), 'Banner');
    },
    getBanner: (id: number): Banner | undefined => bannerById(id),
    listBanners: (tournamentId: number): Banner[] => (q.listBanners.all(tournamentId) as BannerRow[]).map(toBanner),
    /** Saves the fields (and the image, when given) in one step and bumps the version. Undefined when the banner is gone. */
    updateBanner(id: number, update: BannerUpdate): Banner | undefined {
      return inTransaction(() => {
        const { image, ...fields } = update;
        if (q.updateBanner.run({ ...fields, active: fields.active ? 1 : 0, id }).changes === 0) return undefined;
        if (image) q.updateBannerImage.run({ ...image, id });
        return bannerById(id);
      });
    },
    setBannerActive(id: number, active: boolean): Banner | undefined {
      q.setBannerActive.run(active ? 1 : 0, id);
      return bannerById(id);
    },
    deleteBanner(id: number): void {
      q.deleteBanner.run(id);
    },
    /** The banner the public page opens right now: active and inside its window. */
    findShowingBanner(tournamentId: number, at: Date): Banner | undefined {
      return (q.activeBanners.all(tournamentId) as BannerRow[]).map(toBanner).find((b) => bannerState(b, at) === 'showing');
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

export interface TeamUpdate {
  id: number;
  fields: Pick<Team, 'code' | 'name' | 'captain' | 'hero'>;
  /** Undefined: keep the stored image key. String: the new key. Null: no image. */
  key?: string | null;
}

export type Repository = ReturnType<typeof createRepository>;
