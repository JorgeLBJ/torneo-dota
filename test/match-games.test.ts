import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
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

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = createRepository(db);
  tournament = repo.createTournament({ name: 'Copa', slug: 'copa' });
  a = repo.createTeam(tournament.id, { code: 'A', name: 'Alpha' });
  b = repo.createTeam(tournament.id, { code: 'B', name: 'Bravo' });
});
afterEach(() => db.close());

const match = (phase: Match['phase'], extra: { isTiebreak?: boolean } = {}) =>
  repo.createMatch({ tournamentId: tournament.id, phase, round: 1, matchNumber: 1, team1Id: a.id, team2Id: b.id, ...extra });
const game = (gameNumber: number, winnerId: number, stats: [number, number, number, number] = [20, 10, 10, 20]) => ({
  gameNumber,
  winnerId,
  team1Kills: stats[0],
  team1Deaths: stats[1],
  team2Kills: stats[2],
  team2Deaths: stats[3],
});

describe('series length per phase', () => {
  it('defaults to 1 / 3 / 5 and can be changed', () => {
    expect([tournament.groupGames, tournament.semifinalGames, tournament.finalGames]).toEqual([1, 3, 5]);
    const changed = repo.updateTournament(tournament.id, { groupGames: 3, finalGames: 1 });
    expect([changed.groupGames, changed.semifinalGames, changed.finalGames]).toEqual([3, 3, 1]);
  });

  it('the database refuses lengths other than 1, 3 and 5', () => {
    expect(() => repo.updateTournament(tournament.id, { groupGames: 2 as never })).toThrow();
  });
});

describe('the match aggregate is derived from its games', () => {
  it('best of 1: one game decides the match and gives its kills and deaths', () => {
    const m = match('group');
    const saved = repo.saveGame(m.id, game(1, a.id, [25, 12, 12, 25]));
    expect(saved).toMatchObject({ winnerId: a.id, team1Kills: 25, team1Deaths: 12, team2Kills: 12, team2Deaths: 25 });
  });

  it('best of 3: no winner until one team has two games; kills and deaths are the sums', () => {
    const m = match('semifinal');
    let current = repo.saveGame(m.id, game(1, a.id, [30, 10, 10, 30]));
    expect(current).toMatchObject({ winnerId: null, team1Kills: 30, team2Kills: 10 });
    current = repo.saveGame(m.id, game(2, b.id, [5, 20, 20, 5]));
    expect(current).toMatchObject({ winnerId: null, team1Kills: 35, team1Deaths: 30, team2Kills: 30, team2Deaths: 35 });
    current = repo.saveGame(m.id, game(3, b.id, [8, 15, 15, 8]));
    expect(current).toMatchObject({ winnerId: b.id, team1Kills: 43, team1Deaths: 45, team2Kills: 45, team2Deaths: 43 });
  });

  it('replacing a game re-derives the winner; deleting it un-decides the series', () => {
    const m = match('semifinal');
    repo.saveGame(m.id, game(1, a.id));
    repo.saveGame(m.id, game(2, a.id));
    expect(repo.getMatch(m.id)!.winnerId).toBe(a.id);
    expect(repo.saveGame(m.id, game(2, b.id)).winnerId).toBeNull();
    expect(repo.deleteGame(m.id, 2).winnerId).toBeNull();
    expect(repo.deleteGame(m.id, 1)).toMatchObject({ winnerId: null, team1Kills: null, team1Deaths: null, team2Kills: null, team2Deaths: null });
  });

  it('the final is a best of 5: three wins', () => {
    const m = match('final');
    for (const [n, w] of [[1, a.id], [2, b.id], [3, a.id], [4, b.id]] as const) repo.saveGame(m.id, game(n, w));
    expect(repo.getMatch(m.id)!.winnerId).toBeNull();
    expect(repo.saveGame(m.id, game(5, a.id)).winnerId).toBe(a.id);
  });

  it('an extra tiebreak game is a single game even if the group stage is longer', () => {
    repo.updateTournament(tournament.id, { groupGames: 5 });
    const extra = match('group', { isTiebreak: true });
    expect(repo.saveGame(extra.id, game(1, b.id)).winnerId).toBe(b.id);
  });

  it('changing the series length of a phase re-derives the matches that already have games', () => {
    const m = match('semifinal');
    repo.saveGame(m.id, game(1, a.id));
    expect(repo.getMatch(m.id)!.winnerId).toBeNull();
    repo.updateTournament(tournament.id, { semifinalGames: 1 });
    expect(repo.getMatch(m.id)!.winnerId).toBe(a.id);
    repo.updateTournament(tournament.id, { semifinalGames: 5 });
    expect(repo.getMatch(m.id)!.winnerId).toBeNull();
  });

  it('stays in one transaction: a game the database refuses leaves the aggregate untouched', () => {
    const m = match('group');
    repo.saveGame(m.id, game(1, a.id));
    expect(() => repo.saveGame(m.id, { ...game(1, b.id), team1Kills: -1 })).toThrow();
    expect(repo.getMatch(m.id)).toMatchObject({ winnerId: a.id, team1Kills: 20 });
    expect(repo.listGames(m.id)).toHaveLength(1);
  });

  it('refuses a winner that is not one of the match teams', () => {
    const c = repo.createTeam(tournament.id, { code: 'C', name: 'Charlie' });
    expect(() => repo.saveGame(match('group').id, game(1, c.id))).toThrow(/winner must be one of/);
  });
});

describe('games storage', () => {
  it('keeps the Dota import data with the game and lists games in order, per match and per tournament', () => {
    const m = match('semifinal');
    repo.saveGame(m.id, { ...game(2, b.id), radiantTeamId: a.id, dotaMatchId: 9023462170, dotaSnapshot: '{"matchId":9023462170}', importedAt: '2026-10-01 12:00:00' });
    repo.saveGame(m.id, game(1, a.id));
    const games = repo.listGames(m.id);
    expect(games.map((g) => g.gameNumber)).toEqual([1, 2]);
    expect(games[1]).toMatchObject({ radiantTeamId: a.id, dotaMatchId: 9023462170, dotaSnapshot: '{"matchId":9023462170}' });
    expect(games[0]).toMatchObject({ radiantTeamId: null, dotaMatchId: null, dotaSnapshot: null });
    expect(repo.listTournamentGames(tournament.id).map((g) => [g.matchId, g.gameNumber])).toEqual([[m.id, 1], [m.id, 2]]);
  });

  it('game numbers are unique per match and games die with their match', () => {
    const m = match('group');
    repo.saveGame(m.id, game(1, a.id));
    repo.saveGame(m.id, game(1, b.id)); // upsert, not a second row
    expect(repo.listGames(m.id)).toHaveLength(1);
    repo.deleteMatch(m.id);
    expect(repo.listTournamentGames(tournament.id)).toEqual([]);
  });

  it('recordResult (a single result) replaces every game by game 1; clearResult removes them all', () => {
    const m = match('semifinal');
    repo.saveGame(m.id, game(1, a.id));
    repo.saveGame(m.id, game(2, b.id));
    repo.updateTournament(tournament.id, { semifinalGames: 1 });
    const saved = repo.recordResult(m.id, { winnerId: b.id, team1Kills: 1, team1Deaths: 2, team2Kills: 2, team2Deaths: 1 });
    expect(saved).toMatchObject({ winnerId: b.id, team1Kills: 1 });
    expect(repo.listGames(m.id)).toHaveLength(1);
    expect(repo.clearResult(m.id)).toMatchObject({ winnerId: null, team1Kills: null });
    expect(repo.listGames(m.id)).toEqual([]);
  });
});

describe('migration 008 backfill', () => {
  it('every existing result becomes game 1 with the same winner, kills and deaths; unplayed matches get none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    try {
      const old = new Database(':memory:');
      old.pragma('foreign_keys = ON');
      const versions = ['001_init.sql', '002_rules_heroes.sql', '003_timezone.sql', '004_stream.sql', '005_tiebreak_matches.sql', '006_team_images.sql', '007_exclusive_emblem.sql'];
      for (const f of versions) copyFileSync(join(MIGRATIONS_DIR, f), join(dir, f));
      migrate(old, dir);
      old.exec(`
        INSERT INTO tournaments (name, slug) VALUES ('Cup', 'cup'), ('Played', 'played'), ('Fresh', 'fresh');
        INSERT INTO teams (tournament_id, code, name) VALUES (1,'A','A'),(1,'B','B'),(2,'A','A'),(2,'B','B');
        INSERT INTO matches (tournament_id, phase, round, match_number, team1_id, team2_id, winner_id, team1_kills, team1_deaths, team2_kills, team2_deaths) VALUES
          (1,'group',1,1,1,2,2,10,20,20,10),
          (1,'group',1,2,1,2,NULL,NULL,NULL,NULL,NULL),
          (2,'semifinal',1,1,3,4,3,30,10,10,30);`);
      migrate(old, MIGRATIONS_DIR);
      expect(old.prepare('SELECT match_id AS matchId, game_number AS n, winner_id AS w, team1_kills AS k1, team1_deaths AS d1, team2_kills AS k2, team2_deaths AS d2 FROM match_games ORDER BY match_id').all()).toEqual([
        { matchId: 1, n: 1, w: 2, k1: 10, d1: 20, k2: 20, d2: 10 },
        { matchId: 3, n: 1, w: 3, k1: 30, d1: 10, k2: 10, d2: 30 },
      ]);
      // the aggregate on the match is untouched
      expect(old.prepare('SELECT winner_id, team1_kills FROM matches WHERE id = 1').get()).toEqual({ winner_id: 2, team1_kills: 10 });
      // a tournament whose semifinals were already decided as single games stays best of 1; the others get the defaults
      const lengths = old.prepare('SELECT slug, group_games g, semifinal_games s, final_games f FROM tournaments ORDER BY id').all();
      expect(lengths).toEqual([
        { slug: 'cup', g: 1, s: 3, f: 5 },
        { slug: 'played', g: 1, s: 1, f: 5 },
        { slug: 'fresh', g: 1, s: 3, f: 5 },
      ]);
      old.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
