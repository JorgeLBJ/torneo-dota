import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/open.js';

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(':memory:');
  db.exec(`
    INSERT INTO tournaments (name, slug) VALUES ('Cup', 'cup'), ('Other', 'other');
    INSERT INTO teams (tournament_id, code, name) VALUES (1, 'A', 'Alpha'), (1, 'B', 'Bravo'), (1, 'C', 'Charlie'), (2, 'A', 'Alpha 2');
  `);
});
afterEach(() => db.close());

describe('002_rules_heroes: tournament rules', () => {
  it('adds rule columns with the documented defaults', () => {
    const row = db.prepare('SELECT * FROM tournaments WHERE id = 1').get() as Record<string, unknown>;
    expect(row).toMatchObject({
      game: 'Dota 2',
      points_win: 1,
      points_loss: 0,
      tiebreakers: 'kd,kills',
      group_legs: 1,
      rules_text: '',
    });
  });

  it('only allows one or two group legs', () => {
    expect(() => db.exec('UPDATE tournaments SET group_legs = 3 WHERE id = 1')).toThrow();
    db.exec('UPDATE tournaments SET group_legs = 2 WHERE id = 1');
  });

  it('stores calendar days per tournament and cascades on delete', () => {
    db.exec(`INSERT INTO schedule_days (tournament_id, position, date, phase, start_times)
             VALUES (1, 0, '2026-10-03', 'group', '14:00,15:00')`);
    const day = db.prepare('SELECT slot_minutes AS m, phase FROM schedule_days').get() as { m: number; phase: string };
    expect(day).toEqual({ m: 60, phase: 'group' });
    expect(() =>
      db.exec(`INSERT INTO schedule_days (tournament_id, position, date, phase, start_times)
               VALUES (1, 1, '2026-10-04', 'bogus', '14:00')`),
    ).toThrow();
    db.exec('DELETE FROM tournaments WHERE id = 1');
    expect(db.prepare('SELECT COUNT(*) FROM schedule_days').pluck().get()).toBe(0);
  });
});

describe('002_rules_heroes: team heroes', () => {
  it('allows many teams without a hero', () => {
    db.exec("UPDATE teams SET hero = NULL WHERE tournament_id = 1");
  });

  it('rejects the same hero twice in one tournament but allows it across tournaments', () => {
    db.exec("UPDATE teams SET hero = 'axe' WHERE id = 1");
    expect(() => db.exec("UPDATE teams SET hero = 'axe' WHERE id = 2")).toThrow(/UNIQUE/);
    db.exec("UPDATE teams SET hero = 'axe' WHERE id = 4");
  });
});

describe('002_rules_heroes: winner triggers', () => {
  const insert = (t1: number | null, t2: number | null, winner: number | null) =>
    db.exec(`INSERT INTO matches (tournament_id, phase, round, match_number, team1_id, team2_id, winner_id)
             VALUES (1, 'group', 1, 1, ${t1}, ${t2}, ${winner})`);

  it('rejects a winner when a team slot is NULL (CHECK bypass in 001)', () => {
    expect(() => insert(1, null, 1)).toThrow(/winner/);
    expect(() => insert(null, null, 1)).toThrow(/winner/);
  });

  it('rejects a winner that is not one of the two teams on insert', () => {
    expect(() => insert(1, 2, 3)).toThrow(/winner/);
  });

  it('accepts a valid winner and a match without winner', () => {
    insert(1, 2, 2);
    db.exec('DELETE FROM matches');
    insert(1, null, null);
  });

  it('rejects invalid winners on update', () => {
    insert(1, 2, null);
    expect(() => db.exec('UPDATE matches SET winner_id = 3')).toThrow(/winner/);
    db.exec('UPDATE matches SET winner_id = 1');
    expect(() => db.exec('UPDATE matches SET team2_id = NULL')).toThrow(/winner/);
    expect(() => db.exec('UPDATE matches SET team1_id = 3, team2_id = 2')).toThrow(/winner/);
  });
});

describe('002_rules_heroes: single active tournament', () => {
  it('defaults to inactive and allows at most one active tournament', () => {
    expect(db.prepare('SELECT is_active FROM tournaments WHERE id = 1').pluck().get()).toBe(0);
    db.exec('UPDATE tournaments SET is_active = 1 WHERE id = 1');
    expect(() => db.exec('UPDATE tournaments SET is_active = 1 WHERE id = 2')).toThrow(/UNIQUE/);
    db.exec('UPDATE tournaments SET is_active = 0 WHERE id = 1');
    db.exec('UPDATE tournaments SET is_active = 1 WHERE id = 2');
  });
});
