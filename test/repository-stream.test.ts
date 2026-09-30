import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/open.js';
import { createRepository, type Repository } from '../src/db/repository.js';

let db: Database.Database;
let repo: Repository;
beforeEach(() => {
  db = openDatabase(':memory:');
  repo = createRepository(db);
});
afterEach(() => db.close());

describe('tournament stream_url (migration 004)', () => {
  it('is empty by default, can be set, changed and cleared', () => {
    const t = repo.createTournament({ name: 'Cup', slug: 'cup' });
    expect(db.pragma('user_version', { simple: true })).toBe(9);
    expect(t.streamUrl).toBeNull();
    expect(repo.updateTournament(t.id, { streamUrl: 'https://kick.com/mychannel' }).streamUrl).toBe('https://kick.com/mychannel');
    expect(repo.updateTournament(t.id, { name: 'Renamed' }).streamUrl).toBe('https://kick.com/mychannel');
    expect(repo.updateTournament(t.id, { streamUrl: null }).streamUrl).toBeNull();
    expect(repo.getTournamentBySlug('cup')!.streamUrl).toBeNull();
  });
});
