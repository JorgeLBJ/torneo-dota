import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { MIGRATIONS_DIR } from '../src/db/open.js';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('007_exclusive_emblem', () => {
  it('drops the hero of teams that have a custom image (the image wins) and frees that hero', () => {
    dir = mkdtempSync(join(tmpdir(), 'mig-'));
    for (const f of ['001_init.sql', '002_rules_heroes.sql', '003_timezone.sql', '004_stream.sql', '005_tiebreak_matches.sql', '006_team_images.sql']) {
      copyFileSync(join(MIGRATIONS_DIR, f), join(dir, f));
    }
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db, dir);
    db.exec(`
      INSERT INTO tournaments (name, slug) VALUES ('Cup', 'cup');
      INSERT INTO teams (tournament_id, code, name, hero, image_key) VALUES
        (1, 'A', 'Both', 'chaos_knight', 'teams/1/1-aa.webp'),
        (1, 'B', 'Hero only', 'axe', NULL),
        (1, 'C', 'Image only', NULL, 'teams/1/3-cc.webp'),
        (1, 'D', 'Neither', NULL, NULL)`);
    migrate(db, MIGRATIONS_DIR);
    const rows = db.prepare('SELECT code, hero, image_key AS imageKey FROM teams ORDER BY code').all();
    expect(rows).toEqual([
      { code: 'A', hero: null, imageKey: 'teams/1/1-aa.webp' },
      { code: 'B', hero: 'axe', imageKey: null },
      { code: 'C', hero: null, imageKey: 'teams/1/3-cc.webp' },
      { code: 'D', hero: null, imageKey: null },
    ]);
    // The freed hero can be taken by another team right away.
    db.exec("UPDATE teams SET hero = 'chaos_knight' WHERE code = 'D'");
    expect(db.pragma('user_version', { simple: true })).toBe(7);
    db.close();
  });
});
