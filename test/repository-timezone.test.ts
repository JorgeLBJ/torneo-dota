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

const local = { scheduledDate: '2026-10-03', startTime: '14:00', endTime: '15:00' };

describe('tournament time zone', () => {
  it('defaults to America/Lima and only accepts valid IANA names', () => {
    const t = repo.createTournament({ name: 'Cup', slug: 'cup' });
    expect(t.timezone).toBe('America/Lima');
    expect(repo.updateTournament(t.id, { timezone: 'Europe/Madrid' }).timezone).toBe('Europe/Madrid');
    expect(() => repo.updateTournament(t.id, { timezone: 'Mars/Olympus' })).toThrow(/time zone/);
    expect(repo.getTournamentById(t.id)!.timezone).toBe('Europe/Madrid');
  });
});

describe('match schedule as UTC', () => {
  it('reads wall-clock input in the tournament zone and stores UTC instants', () => {
    const lima = repo.createTournament({ name: 'Lima', slug: 'lima' });
    const madrid = repo.createTournament({ name: 'Madrid', slug: 'madrid' });
    repo.updateTournament(madrid.id, { timezone: 'Europe/Madrid' });
    const a = repo.createMatch({ tournamentId: lima.id, phase: 'group', round: 1, matchNumber: 1, ...local });
    const b = repo.createMatch({ tournamentId: madrid.id, phase: 'group', round: 1, matchNumber: 1, ...local });
    expect(a).toMatchObject({ startsAt: '2026-10-03T19:00:00Z', endsAt: '2026-10-03T20:00:00Z', ...local });
    expect(b).toMatchObject({ startsAt: '2026-10-03T12:00:00Z', endsAt: '2026-10-03T13:00:00Z', ...local });
  });

  it('stores nothing without both a date and a start time', () => {
    const t = repo.createTournament({ name: 'Cup', slug: 'cup' });
    const m = repo.createMatch({ tournamentId: t.id, phase: 'group', round: 1, matchNumber: 1, scheduledDate: '2026-10-03' });
    expect(m).toMatchObject({ startsAt: null, endsAt: null, scheduledDate: null, startTime: null });
  });

  it('moves an end that is not after the start to the next day', () => {
    const t = repo.createTournament({ name: 'Cup', slug: 'cup' });
    const m = repo.createMatch({ tournamentId: t.id, phase: 'group', round: 1, matchNumber: 1, scheduledDate: '2026-10-03', startTime: '23:30', endTime: '00:30' });
    expect(m).toMatchObject({ startsAt: '2026-10-04T04:30:00Z', endsAt: '2026-10-04T05:30:00Z', endTime: '00:30' });
  });

  it('applies edits and schedule updates in the zone', () => {
    const t = repo.createTournament({ name: 'Cup', slug: 'cup' });
    repo.updateTournament(t.id, { timezone: 'Europe/Madrid' });
    const m = repo.createMatch({ tournamentId: t.id, phase: 'group', round: 1, matchNumber: 1 });
    expect(repo.updateMatch(m.id, { round: 1, team1Id: null, team2Id: null, ...local }).startsAt).toBe('2026-10-03T12:00:00Z');
    expect(repo.updateMatchSchedule(m.id, { scheduledDate: '2026-12-01', startTime: '12:00', endTime: '13:00' }).startsAt).toBe('2026-12-01T11:00:00Z');
  });

  it('keeps the instants when the zone changes: the local reading moves', () => {
    const t = repo.createTournament({ name: 'Cup', slug: 'cup' });
    const m = repo.createMatch({ tournamentId: t.id, phase: 'group', round: 1, matchNumber: 1, ...local });
    repo.updateTournament(t.id, { timezone: 'Europe/Madrid' });
    expect(repo.getMatch(m.id)).toMatchObject({ startsAt: '2026-10-03T19:00:00Z', scheduledDate: '2026-10-03', startTime: '21:00', endTime: '22:00' });
    expect(repo.listMatches(t.id)[0]!.startTime).toBe('21:00');
  });
});
