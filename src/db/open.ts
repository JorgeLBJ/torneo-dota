import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { migrate } from './migrate.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

/** Opens a SQLite database, applies pragmas and runs pending migrations. */
export function openDatabase(path: string, migrationsDir: string = MIGRATIONS_DIR): Database.Database {
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  try {
    migrate(db, migrationsDir);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
