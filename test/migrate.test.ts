import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';

let dir: string;
let db: Database.Database;

const version = () => db.pragma('user_version', { simple: true });
const write = (name: string, sql: string) => writeFileSync(join(dir, name), sql);
const tables = () =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(
    (r) => r.name,
  );

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'migrate-'));
  db = new Database(':memory:');
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('migrate', () => {
  it('applies migrations in version order and sets user_version', () => {
    write('002_b.sql', 'CREATE TABLE b (id INTEGER); INSERT INTO b VALUES ((SELECT COUNT(*) FROM a));');
    write('001_a.sql', 'CREATE TABLE a (id INTEGER);');
    migrate(db, dir);
    expect(version()).toBe(2);
    expect(tables()).toEqual(['a', 'b']);
  });

  it('skips migrations that were already applied', () => {
    write('001_a.sql', 'CREATE TABLE a (id INTEGER);');
    migrate(db, dir);
    write('002_b.sql', 'CREATE TABLE b (id INTEGER);');
    migrate(db, dir);
    expect(version()).toBe(2);
    expect(tables()).toEqual(['a', 'b']);
  });

  it('is idempotent', () => {
    write('001_a.sql', 'CREATE TABLE a (id INTEGER);');
    migrate(db, dir);
    expect(() => migrate(db, dir)).not.toThrow();
    expect(version()).toBe(1);
  });

  it('rolls back a failing file, keeps the prior version and throws', () => {
    write('001_a.sql', 'CREATE TABLE a (id INTEGER);');
    write('002_bad.sql', 'CREATE TABLE b (id INTEGER); INSERT INTO missing VALUES (1);');
    expect(() => migrate(db, dir)).toThrow();
    expect(version()).toBe(1);
    expect(tables()).toEqual(['a']);
  });

  it('ignores files that do not match NNN_name.sql', () => {
    write('001_a.sql', 'CREATE TABLE a (id INTEGER);');
    write('notes.txt', 'nope');
    write('02_short.sql', 'CREATE TABLE short (id INTEGER);');
    write('003_x.txt', 'nope');
    migrate(db, dir);
    expect(version()).toBe(1);
    expect(tables()).toEqual(['a']);
  });

  it('rejects duplicate version numbers', () => {
    write('001_a.sql', 'CREATE TABLE a (id INTEGER);');
    write('001_other.sql', 'CREATE TABLE o (id INTEGER);');
    expect(() => migrate(db, dir)).toThrow(/duplicate/i);
    expect(version()).toBe(0);
    expect(tables()).toEqual([]);
  });
});
