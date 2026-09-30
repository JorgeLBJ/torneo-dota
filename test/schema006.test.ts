import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { MIGRATIONS_DIR, openDatabase } from '../src/db/open.js';
import { createRepository } from '../src/db/repository.js';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('006_team_images', () => {
  it('leaves existing teams without a custom image', () => {
    dir = mkdtempSync(join(tmpdir(), 'mig-'));
    for (const f of ['001_init.sql', '002_rules_heroes.sql', '003_timezone.sql', '004_stream.sql', '005_tiebreak_matches.sql']) copyFileSync(join(MIGRATIONS_DIR, f), join(dir, f));
    const db = new Database(':memory:');
    migrate(db, dir);
    db.exec("INSERT INTO tournaments (name, slug) VALUES ('Cup', 'cup'); INSERT INTO teams (tournament_id, code, name, hero) VALUES (1, 'A', 'Alpha', 'axe')");
    migrate(db, MIGRATIONS_DIR);
    expect(db.prepare('SELECT image_key FROM teams').pluck().get()).toBeNull();
    db.close();
  });

  it('the repository stores, replaces and clears the key, independently of the hero', () => {
    const db = openDatabase(':memory:');
    const repo = createRepository(db);
    const t = repo.createTournament({ name: 'Cup', slug: 'cup' });
    const team = repo.createTeam(t.id, { code: 'A', name: 'Alpha', hero: 'axe' });
    expect(team.imageKey).toBeNull();
    expect(repo.updateTeam(team.id, { imageKey: 'teams/1/1-aa.webp' })).toMatchObject({ imageKey: 'teams/1/1-aa.webp', hero: 'axe' });
    expect(repo.updateTeam(team.id, { name: 'Renamed' }).imageKey).toBe('teams/1/1-aa.webp');
    expect(repo.updateTeam(team.id, { hero: null }).imageKey).toBe('teams/1/1-aa.webp');
    expect(repo.updateTeam(team.id, { imageKey: null }).imageKey).toBeNull();
    // Two teams can share the same hero rule only when heroes differ; images have no uniqueness rule.
    const other = repo.createTeam(t.id, { code: 'B', name: 'Bravo' });
    repo.updateTeam(team.id, { imageKey: 'teams/1/1-bb.webp' });
    expect(repo.updateTeam(other.id, { imageKey: 'teams/1/2-cc.webp' }).imageKey).toBe('teams/1/2-cc.webp');
    db.close();
  });
});
