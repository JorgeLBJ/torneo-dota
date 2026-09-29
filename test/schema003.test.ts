import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../src/db/open.js';
import { migrate } from '../src/db/migrate.js';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/** A database migrated to version 2 (before time zones), with schedule data in the old columns. */
function versionTwo(): Database.Database {
  dir = mkdtempSync(join(tmpdir(), 'mig-'));
  mkdirSync(dir, { recursive: true });
  for (const file of ['001_init.sql', '002_rules_heroes.sql']) copyFileSync(join(MIGRATIONS_DIR, file), join(dir, file));
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db, dir);
  db.exec(`
    INSERT INTO tournaments (name, slug) VALUES ('Cup', 'cup');
    INSERT INTO teams (tournament_id, code, name) VALUES (1, 'A', 'Alpha'), (1, 'B', 'Bravo');
    INSERT INTO matches (tournament_id, phase, round, match_number, scheduled_date, start_time, end_time, team1_id, team2_id) VALUES
      (1, 'group', 1, 1, '2026-10-03', '14:00', '15:00', 1, 2),
      (1, 'group', 2, 2, '2026-10-03', '23:30', '00:30', 1, 2),
      (1, 'group', 3, 3, NULL, NULL, NULL, 1, 2);
  `);
  return db;
}

describe('003_timezone', () => {
  it('adds the zone with the Lima default and converts the schedule to UTC instants', () => {
    const db = versionTwo();
    migrate(db, MIGRATIONS_DIR);
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(3);
    expect(db.prepare('SELECT timezone FROM tournaments').pluck().get()).toBe('America/Lima');
    const rows = db.prepare('SELECT match_number AS n, starts_at AS s, ends_at AS e FROM matches ORDER BY id').all();
    expect(rows).toEqual([
      { n: 1, s: '2026-10-03T19:00:00Z', e: '2026-10-03T20:00:00Z' },
      // Ends after midnight local: 04:30Z start, 05:30Z end on the following UTC day.
      { n: 2, s: '2026-10-04T04:30:00Z', e: '2026-10-04T05:30:00Z' },
      { n: 3, s: null, e: null },
    ]);
    db.close();
  });

  it('drops the old local columns so there is one source of truth', () => {
    const db = versionTwo();
    migrate(db, MIGRATIONS_DIR);
    const columns = (db.prepare('PRAGMA table_info(matches)').all() as { name: string }[]).map((c) => c.name);
    expect(columns).not.toContain('scheduled_date');
    expect(columns).not.toContain('start_time');
    expect(columns).not.toContain('end_time');
    expect(columns).toEqual(expect.arrayContaining(['starts_at', 'ends_at']));
    db.close();
  });

  it('keeps the winner integrity triggers working after the column drop', () => {
    const db = versionTwo();
    migrate(db, MIGRATIONS_DIR);
    expect(() => db.exec('UPDATE matches SET winner_id = 99 WHERE id = 1')).toThrow();
    db.exec('UPDATE matches SET winner_id = 1 WHERE id = 1');
    db.close();
  });
});
