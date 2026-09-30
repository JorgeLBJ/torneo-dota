import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/open.js';

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(':memory:');
});
afterEach(() => db.close());

const seed = () => {
  db.exec(`
    INSERT INTO tournaments (name, slug) VALUES ('Cup', 'cup');
    INSERT INTO teams (tournament_id, code, name) VALUES (1, 'A', 'Alpha'), (1, 'B', 'Bravo'), (1, 'C', 'Charlie');
  `);
};

describe('001_init schema', () => {
  it('enables foreign keys and sets user_version 9', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('user_version', { simple: true })).toBe(9);
  });

  it('defaults qualifiers to 4 and enforces unique slug', () => {
    seed();
    expect(db.prepare('SELECT qualifiers FROM tournaments').pluck().get()).toBe(4);
    expect(() => db.exec("INSERT INTO tournaments (name, slug) VALUES ('Other', 'cup')")).toThrow();
  });

  it('enforces unique team code per tournament', () => {
    seed();
    expect(() => db.exec("INSERT INTO teams (tournament_id, code, name) VALUES (1, 'A', 'Dup')")).toThrow();
  });

  it('rejects an unknown phase', () => {
    seed();
    expect(() =>
      db.exec("INSERT INTO matches (tournament_id, phase, round, match_number) VALUES (1, 'quarter', 1, 1)"),
    ).toThrow();
  });

  it('allows playoff slots without teams', () => {
    seed();
    expect(() =>
      db.exec("INSERT INTO matches (tournament_id, phase, round, match_number) VALUES (1, 'semifinal', 1, 1)"),
    ).not.toThrow();
  });

  it('rejects a winner that is neither team', () => {
    seed();
    expect(() =>
      db.exec(
        "INSERT INTO matches (tournament_id, phase, round, match_number, team1_id, team2_id, winner_id) VALUES (1, 'group', 1, 1, 1, 2, 3)",
      ),
    ).toThrow();
  });

  it('rejects a match of a team against itself', () => {
    seed();
    expect(() =>
      db.exec(
        "INSERT INTO matches (tournament_id, phase, round, match_number, team1_id, team2_id) VALUES (1, 'group', 1, 1, 1, 1)",
      ),
    ).toThrow();
  });

  it('cascades tournament deletion to teams and matches', () => {
    seed();
    db.exec(
      "INSERT INTO matches (tournament_id, phase, round, match_number, team1_id, team2_id) VALUES (1, 'group', 1, 1, 1, 2)",
    );
    db.exec('DELETE FROM tournaments WHERE id = 1');
    expect(db.prepare('SELECT COUNT(*) FROM teams').pluck().get()).toBe(0);
    expect(db.prepare('SELECT COUNT(*) FROM matches').pluck().get()).toBe(0);
  });

  it('cascades admin deletion to sessions', () => {
    db.exec("INSERT INTO admins (username, password_hash) VALUES ('root', 'x')");
    db.exec("INSERT INTO sessions (id, admin_id, expires_at) VALUES ('tok', 1, '2099-01-01T00:00:00Z')");
    db.exec('DELETE FROM admins WHERE id = 1');
    expect(db.prepare('SELECT COUNT(*) FROM sessions').pluck().get()).toBe(0);
  });
});
