import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { MIGRATIONS_DIR, openDatabase } from '../src/db/open.js';
import { createRepository, type Match, type Repository, type Team, type Tournament } from '../src/db/repository.js';

let db: Database.Database;
let repo: Repository;
let tournament: Tournament;
let a: Team;
let b: Team;
let c: Team;

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = createRepository(db);
  tournament = repo.createTournament({ name: 'Copa', slug: 'copa' });
  a = repo.createTeam(tournament.id, { code: 'A', name: 'Alpha' });
  b = repo.createTeam(tournament.id, { code: 'B', name: 'Bravo' });
  c = repo.createTeam(tournament.id, { code: 'C', name: 'Charlie' });
});
afterEach(() => db.close());

const lives = () => repo.listLive(tournament.id);
const live = () => lives()[0] ?? null;
const stream = () => repo.getTournamentById(tournament.id)!.streamMatchId;
const match = (phase: Match['phase'], n = 1, teams: [number | null, number | null] = [a.id, b.id]): Match =>
  repo.createMatch({ tournamentId: tournament.id, phase, round: 1, matchNumber: n, team1Id: teams[0], team2Id: teams[1] });
const game = (matchId: number, number: number, winner: Team) =>
  repo.saveGame(matchId, { gameNumber: number, winnerId: winner.id, team1Kills: 1, team1Deaths: 1, team2Kills: 1, team2Deaths: 1 });
const mark = (m: Match, gameNumber = 1, startedAt = '2026-10-03T19:00:00.000Z') => repo.setLive(m.id, { gameNumber, startedAt });

describe('the live games of a tournament', () => {
  it('are nothing by default; several can be live at once, each in its own match', () => {
    expect(lives()).toEqual([]);
    const m1 = match('group', 1);
    const m2 = match('group', 2, [b.id, c.id]);
    mark(m1);
    mark(m2, 1, '2026-10-03T20:00:00.000Z');
    expect(lives()).toEqual([
      { matchId: m1.id, gameNumber: 1, startedAt: '2026-10-03T19:00:00.000Z' },
      { matchId: m2.id, gameNumber: 1, startedAt: '2026-10-03T20:00:00.000Z' },
    ]);
  });

  it('marking again the same match replaces its game (one live game per match); null clears it', () => {
    repo.updateTournament(tournament.id, { semifinalGames: 3 });
    const m = match('semifinal');
    mark(m, 1);
    mark(m, 2, '2026-10-03T21:00:00.000Z');
    expect(lives()).toEqual([{ matchId: m.id, gameNumber: 2, startedAt: '2026-10-03T21:00:00.000Z' }]);
    repo.setLive(m.id, null);
    expect(lives()).toEqual([]);
  });

  it('belongs to one tournament: another tournament has its own', () => {
    const other = repo.createTournament({ name: 'Otra', slug: 'otra' });
    mark(match('group'));
    expect(repo.listLive(other.id)).toEqual([]);
  });

  it('is not touched by saving the rules', () => {
    mark(match('group'));
    repo.updateTournament(tournament.id, { pointsWin: 3 });
    expect(live()).not.toBeNull();
  });

  it('disappears with its match', () => {
    const m = match('group');
    mark(m);
    repo.deleteMatch(m.id);
    expect(live()).toBeNull();
    const m2 = match('group', 2);
    mark(m2);
    repo.replaceGroupMatches(tournament.id, []);
    expect(live()).toBeNull();
  });
});

describe('the match on the stream', () => {
  it('is optional, only one at a time, and listed first among the live games', () => {
    const m1 = match('group', 1);
    const m2 = match('group', 2, [b.id, c.id]);
    mark(m1, 1, '2026-10-03T19:00:00.000Z');
    mark(m2, 1, '2026-10-03T20:00:00.000Z');
    expect(stream()).toBeNull();
    expect(lives().map((l) => l.matchId)).toEqual([m1.id, m2.id]);
    repo.setStream(tournament.id, m2.id);
    expect(stream()).toBe(m2.id);
    expect(lives().map((l) => l.matchId)).toEqual([m2.id, m1.id]);
    repo.setStream(tournament.id, m1.id);
    expect(stream()).toBe(m1.id);
    repo.setStream(tournament.id, null);
    expect(stream()).toBeNull();
  });

  it('goes away with the live mark of that match (cleared by hand or by a saved result), not with others', () => {
    const m1 = match('group', 1);
    const m2 = match('group', 2, [b.id, c.id]);
    mark(m1);
    mark(m2);
    repo.setStream(tournament.id, m1.id);
    repo.setLive(m2.id, null);
    expect(stream()).toBe(m1.id);
    game(m1.id, 1, a);
    expect(stream()).toBeNull();
    mark(m2);
    repo.setStream(tournament.id, m2.id);
    repo.setLive(m2.id, null);
    expect(stream()).toBeNull();
  });

  it('goes away with its match', () => {
    const m = match('group');
    mark(m);
    repo.setStream(tournament.id, m.id);
    repo.deleteMatch(m.id);
    expect(stream()).toBeNull();
  });

  it('refuses a match that is not live or not of the tournament', () => {
    const m = match('group');
    expect(() => repo.setStream(tournament.id, m.id)).toThrow();
    const other = repo.createTournament({ name: 'Otra', slug: 'otra' });
    const x = repo.createTeam(other.id, { code: 'X', name: 'X' });
    const y = repo.createTeam(other.id, { code: 'Y', name: 'Y' });
    const foreign = repo.createMatch({ tournamentId: other.id, phase: 'group', round: 1, matchNumber: 1, team1Id: x.id, team2Id: y.id });
    repo.setLive(foreign.id, { gameNumber: 1, startedAt: '2026-10-03T19:00:00.000Z' });
    expect(() => repo.setStream(tournament.id, foreign.id)).toThrow();
  });
});

describe('the live mark turns itself off when it stops being true', () => {
  it('saving the result of the live game', () => {
    const m = match('group');
    mark(m);
    game(m.id, 1, a);
    expect(live()).toBeNull();
  });

  it('a single result recorded over the match, and clearing it', () => {
    const m = match('group');
    mark(m);
    repo.recordResult(m.id, { winnerId: a.id, team1Kills: 1, team1Deaths: 1, team2Kills: 1, team2Deaths: 1 });
    expect(live()).toBeNull();
  });

  it('the next game of a series stays live until it is saved', () => {
    repo.updateTournament(tournament.id, { semifinalGames: 3 });
    const m = match('semifinal');
    game(m.id, 1, a);
    mark(m, 2);
    expect(live()).toMatchObject({ gameNumber: 2 });
    game(m.id, 2, b);
    expect(live()).toBeNull();
  });

  it('correcting an earlier game so the series is decided, or the game is no longer next', () => {
    repo.updateTournament(tournament.id, { semifinalGames: 3 });
    const m = match('semifinal');
    game(m.id, 1, a);
    game(m.id, 2, b);
    mark(m, 3);
    game(m.id, 2, a); // 2-0: decided, game 3 is not played
    expect(live()).toBeNull();
    repo.deleteGame(m.id, 2);
    mark(m, 2);
    repo.deleteGame(m.id, 1); // game 1 is next again
    expect(live()).toBeNull();
  });

  it('results of other matches do not matter, and a result clears only its own match', () => {
    const m1 = match('group', 1);
    const m2 = match('group', 2);
    mark(m1);
    mark(m2);
    game(m2.id, 1, a);
    expect(lives()).toMatchObject([{ matchId: m1.id }]);
  });

  it('clearing the result of the match, or resetting it', () => {
    repo.updateTournament(tournament.id, { semifinalGames: 3 });
    const m = match('semifinal');
    game(m.id, 1, a);
    mark(m, 2);
    repo.clearResult(m.id);
    expect(live()).toBeNull();
  });

  it('changing the teams of the match (a different pairing is a different match)', () => {
    const m = match('group');
    mark(m);
    repo.updateMatchTeams(m.id, a.id, b.id);
    expect(live()).not.toBeNull(); // same teams: still the same match
    repo.updateMatchTeams(m.id, a.id, c.id);
    expect(live()).toBeNull();
    mark(m);
    repo.updateMatchTeams(m.id, null, null);
    expect(live()).toBeNull();
  });

  it('editing the match through the fixture editor with other teams', () => {
    const m = match('group');
    mark(m);
    repo.updateMatch(m.id, { round: 1, scheduledDate: null, startTime: null, endTime: null, team1Id: a.id, team2Id: c.id });
    expect(live()).toBeNull();
  });

  it('shortening the series so the live game no longer exists', () => {
    repo.updateTournament(tournament.id, { semifinalGames: 3 });
    const m = match('semifinal');
    game(m.id, 1, a);
    mark(m, 2);
    repo.updateTournament(tournament.id, { semifinalGames: 1 }); // game 1 already decided a best of 1
    expect(live()).toBeNull();
  });
});

describe('migration 010', () => {
  it('adds the per-match live columns and the stream match; user_version is at least 10', () => {
    const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols('matches')).toEqual(expect.arrayContaining(['live_game_number', 'live_started_at']));
    expect(cols('tournaments')).toEqual(expect.arrayContaining(['stream_match_id']));
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(10);
  });

  it('moves a tournament live mark (009) onto its match and empties the old columns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    try {
      for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f < '010')) copyFileSync(join(MIGRATIONS_DIR, f), join(dir, f));
      const old = new Database(':memory:');
      old.pragma('foreign_keys = ON');
      migrate(old, dir);
      old.exec(`INSERT INTO tournaments (name, slug) VALUES ('Cup', 'cup'), ('Quiet', 'quiet');
        INSERT INTO matches (tournament_id, phase, round, match_number) VALUES (1, 'group', 1, 1), (1, 'group', 1, 2);
        UPDATE tournaments SET live_match_id = 2, live_game_number = 1, live_started_at = '2026-10-03T19:00:00.000Z' WHERE id = 1`);
      migrate(old, MIGRATIONS_DIR);
      expect(old.prepare('SELECT id, live_game_number AS g, live_started_at AS s FROM matches ORDER BY id').all()).toEqual([
        { id: 1, g: null, s: null },
        { id: 2, g: 1, s: '2026-10-03T19:00:00.000Z' },
      ]);
      expect(old.prepare('SELECT live_match_id AS m, stream_match_id AS s FROM tournaments ORDER BY id').all()).toEqual([
        { m: null, s: null },
        { m: null, s: null },
      ]);
      old.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
