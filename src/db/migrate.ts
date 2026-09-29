import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';

const MIGRATION_FILE = /^(\d{3})_.+\.sql$/;

interface Migration {
  version: number;
  file: string;
}

function listMigrations(dir: string): Migration[] {
  const migrations: Migration[] = [];
  const seen = new Map<number, string>();
  for (const file of readdirSync(dir).sort()) {
    const match = MIGRATION_FILE.exec(file);
    if (!match) continue;
    const version = Number(match[1]);
    const previous = seen.get(version);
    if (previous) {
      throw new Error(`Duplicate migration version ${version}: ${previous} and ${file}`);
    }
    seen.set(version, file);
    migrations.push({ version, file });
  }
  return migrations.sort((a, b) => a.version - b.version);
}

/**
 * Forward-only migrator. Applies every `NNN_name.sql` in `dir` whose version is
 * greater than `PRAGMA user_version`, one transaction per file. Throws on any
 * failure so the app never starts on a half-migrated database.
 */
export function migrate(db: Database.Database, dir: string): void {
  const migrations = listMigrations(dir);
  const current = db.pragma('user_version', { simple: true }) as number;
  for (const { version, file } of migrations) {
    if (version <= current) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    try {
      db.transaction(() => {
        db.exec(sql);
        db.pragma(`user_version = ${version}`);
      })();
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
    }
  }
}
