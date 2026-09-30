import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { MIGRATIONS_DIR, openDatabase } from '../src/db/open.js';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('005_tiebreak_matches', () => {
  it('leaves every existing match as a regular one', () => {
    dir = mkdtempSync(join(tmpdir(), 'mig-'));
    for (const file of ['001_init.sql', '002_rules_heroes.sql', '003_timezone.sql', '004_stream.sql']) copyFileSync(join(MIGRATIONS_DIR, file), join(dir, file));
    const db = new Database(':memory:');
    migrate(db, dir);
    db.exec(`
      INSERT INTO tournaments (name, slug) VALUES ('Cup', 'cup');
      INSERT INTO teams (tournament_id, code, name) VALUES (1, 'A', 'A'), (1, 'B', 'B');
      INSERT INTO matches (tournament_id, phase, round, match_number, team1_id, team2_id) VALUES (1, 'group', 1, 1, 1, 2), (1, 'group', 2, 2, 2, 1);
    `);
    migrate(db, MIGRATIONS_DIR);
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(5);
    expect(db.prepare('SELECT is_tiebreak FROM matches ORDER BY id').pluck().all()).toEqual([0, 0]);
    db.close();
  });

  it('defaults to 0 and only accepts 0 or 1', () => {
    const db = openDatabase(':memory:');
    db.exec("INSERT INTO tournaments (name, slug) VALUES ('Cup', 'cup')");
    db.exec("INSERT INTO matches (tournament_id, phase, round, match_number) VALUES (1, 'group', 1, 1)");
    expect(db.prepare('SELECT is_tiebreak FROM matches').pluck().get()).toBe(0);
    expect(() => db.exec("INSERT INTO matches (tournament_id, phase, round, match_number, is_tiebreak) VALUES (1, 'group', 2, 2, 2)")).toThrow();
    db.close();
  });
});
