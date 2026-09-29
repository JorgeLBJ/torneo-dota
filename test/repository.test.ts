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

const setup = () => {
  const t = repo.createTournament({ name: 'Cup', slug: 'cup' });
  const a = repo.createTeam(t.id, { code: 'A', name: 'Alpha', captain: 'Ann' });
  const b = repo.createTeam(t.id, { code: 'B', name: 'Bravo' });
  const c = repo.createTeam(t.id, { code: 'C', name: 'Charlie' });
  return { t, a, b, c };
};

describe('tournaments', () => {
  it('creates with default qualifiers and fetches by slug', () => {
    const t = repo.createTournament({ name: 'Cup', slug: 'cup' });
    expect(t).toMatchObject({ name: 'Cup', slug: 'cup', qualifiers: 4 });
    expect(repo.getTournamentBySlug('cup')).toEqual(t);
    expect(repo.getTournamentBySlug('nope')).toBeUndefined();
  });

  it('lists and updates', () => {
    const t = repo.createTournament({ name: 'Cup', slug: 'cup' });
    repo.createTournament({ name: 'Other', slug: 'other', qualifiers: 2 });
    expect(repo.listTournaments().map((x) => x.slug)).toEqual(['cup', 'other']);
    const updated = repo.updateTournament(t.id, { name: 'Renamed', qualifiers: 8 });
    expect(updated).toMatchObject({ name: 'Renamed', slug: 'cup', qualifiers: 8 });
  });

  it('rejects duplicate slugs', () => {
    repo.createTournament({ name: 'Cup', slug: 'cup' });
    expect(() => repo.createTournament({ name: 'Again', slug: 'cup' })).toThrow();
  });
});

describe('teams', () => {
  it('supports CRUD', () => {
    const { t, a } = setup();
    expect(a).toMatchObject({ tournamentId: t.id, code: 'A', name: 'Alpha', captain: 'Ann' });
    expect(repo.listTeams(t.id).map((x) => x.code)).toEqual(['A', 'B', 'C']);
    expect(repo.updateTeam(a.id, { name: 'Alpha 2', captain: null })).toMatchObject({
      name: 'Alpha 2',
      captain: null,
    });
    repo.deleteTeam(a.id);
    expect(repo.getTeam(a.id)).toBeUndefined();
  });

  it('rejects duplicate codes within a tournament', () => {
    const { t } = setup();
    expect(() => repo.createTeam(t.id, { code: 'A', name: 'Dup' })).toThrow();
  });
});

describe('matches', () => {
  const fixture = (tid: number, a: number, b: number, c: number) =>
    [
      {
        phase: 'group' as const,
        round: 1,
        matchNumber: 1,
        scheduledDate: '2026-10-03',
        startTime: '14:00',
        endTime: '14:45',
        team1Id: a,
        team2Id: b,
      },
      { phase: 'group' as const, round: 2, matchNumber: 2, team1Id: b, team2Id: c },
      { phase: 'semifinal' as const, round: 1, matchNumber: 3 },
    ].map((m) => ({ tournamentId: tid, ...m }));

  it('bulk inserts and lists ordered by match number, optionally by phase', () => {
    const { t, a, b, c } = setup();
    repo.insertMatches(fixture(t.id, a.id, b.id, c.id));
    const all = repo.listMatches(t.id);
    expect(all.map((m) => m.matchNumber)).toEqual([1, 2, 3]);
    expect(all[0]).toMatchObject({ scheduledDate: '2026-10-03', startTime: '14:00', winnerId: null, team1Kills: null });
    expect(all[2]).toMatchObject({ team1Id: null, team2Id: null });
    expect(repo.listMatches(t.id, 'group')).toHaveLength(2);
  });

  it('bulk insert is atomic', () => {
    const { t, a } = setup();
    const bad = [
      { tournamentId: t.id, phase: 'group' as const, round: 1, matchNumber: 1, team1Id: a.id, team2Id: null },
      { tournamentId: t.id, phase: 'group' as const, round: 1, matchNumber: 2, team1Id: a.id, team2Id: a.id },
    ];
    expect(() => repo.insertMatches(bad)).toThrow();
    expect(repo.listMatches(t.id)).toHaveLength(0);
  });

  it('updates schedule and teams', () => {
    const { t, a, b, c } = setup();
    repo.insertMatches(fixture(t.id, a.id, b.id, c.id));
    const [m1, , sf] = repo.listMatches(t.id);
    expect(
      repo.updateMatchSchedule(m1!.id, { scheduledDate: '2026-10-10', startTime: '15:00', endTime: '15:45' }),
    ).toMatchObject({ scheduledDate: '2026-10-10', startTime: '15:00' });
    expect(repo.updateMatchTeams(sf!.id, a.id, c.id)).toMatchObject({ team1Id: a.id, team2Id: c.id });
  });

  it('records and clears a result', () => {
    const { t, a, b, c } = setup();
    repo.insertMatches(fixture(t.id, a.id, b.id, c.id));
    const [m1] = repo.listMatches(t.id);
    const played = repo.recordResult(m1!.id, {
      winnerId: b.id,
      team1Kills: 10,
      team1Deaths: 20,
      team2Kills: 20,
      team2Deaths: 10,
    });
    expect(played).toMatchObject({ winnerId: b.id, team1Kills: 10, team1Deaths: 20, team2Kills: 20, team2Deaths: 10 });
    expect(repo.clearResult(m1!.id)).toMatchObject({
      winnerId: null,
      team1Kills: null,
      team1Deaths: null,
      team2Kills: null,
      team2Deaths: null,
    });
  });

  it('rejects a winner that is not one of the teams (CHECK constraint)', () => {
    const { t, a, b, c } = setup();
    repo.insertMatches(fixture(t.id, a.id, b.id, c.id));
    const [m1] = repo.listMatches(t.id);
    expect(() =>
      repo.recordResult(m1!.id, { winnerId: c.id, team1Kills: 1, team1Deaths: 1, team2Kills: 1, team2Deaths: 1 }),
    ).toThrow(/CHECK/);
  });

  it('deletes matches of a phase', () => {
    const { t, a, b, c } = setup();
    repo.insertMatches(fixture(t.id, a.id, b.id, c.id));
    repo.deleteMatches(t.id, 'group');
    expect(repo.listMatches(t.id).map((m) => m.phase)).toEqual(['semifinal']);
  });

  it('cascades tournament deletion to teams and matches', () => {
    const { t, a, b, c } = setup();
    repo.insertMatches(fixture(t.id, a.id, b.id, c.id));
    repo.deleteTournament(t.id);
    expect(repo.listTeams(t.id)).toHaveLength(0);
    expect(repo.listMatches(t.id)).toHaveLength(0);
    expect(repo.getTournamentBySlug('cup')).toBeUndefined();
  });
});

describe('admins and sessions', () => {
  it('creates and finds an admin by username', () => {
    const admin = repo.createAdmin('root', 'hash');
    expect(repo.getAdminByUsername('root')).toEqual(admin);
    expect(repo.getAdminByUsername('nobody')).toBeUndefined();
    expect(() => repo.createAdmin('root', 'other')).toThrow();
  });

  it('returns only unexpired sessions', () => {
    const admin = repo.createAdmin('root', 'hash');
    repo.createSession('live', admin.id, '2030-01-01T00:00:00.000Z');
    repo.createSession('dead', admin.id, '2020-01-01T00:00:00.000Z');
    const now = '2026-10-01T00:00:00.000Z';
    expect(repo.getValidSession('live', now)).toMatchObject({ id: 'live', adminId: admin.id });
    expect(repo.getValidSession('dead', now)).toBeUndefined();
    expect(repo.getValidSession('missing', now)).toBeUndefined();
  });

  it('deletes sessions and purges expired ones', () => {
    const admin = repo.createAdmin('root', 'hash');
    repo.createSession('live', admin.id, '2030-01-01T00:00:00.000Z');
    repo.createSession('dead', admin.id, '2020-01-01T00:00:00.000Z');
    repo.deleteExpiredSessions('2026-10-01T00:00:00.000Z');
    expect(db.prepare('SELECT COUNT(*) FROM sessions').pluck().get()).toBe(1);
    repo.deleteSession('live');
    expect(repo.getValidSession('live', '2026-10-01T00:00:00.000Z')).toBeUndefined();
  });
});
