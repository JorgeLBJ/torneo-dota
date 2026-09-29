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
  const a = repo.createTeam(t.id, { code: 'A', name: 'Alpha' });
  const b = repo.createTeam(t.id, { code: 'B', name: 'Bravo' });
  const c = repo.createTeam(t.id, { code: 'C', name: 'Charlie' });
  return { t, a, b, c };
};

describe('tournament rules', () => {
  it('exposes defaults', () => {
    const t = repo.createTournament({ name: 'Cup', slug: 'cup' });
    expect(t).toMatchObject({
      game: 'Dota 2',
      pointsWin: 1,
      pointsLoss: 0,
      tiebreakers: ['kd', 'kills'],
      groupLegs: 1,
      rulesText: '',
    });
  });

  it('updates rules including the tiebreaker order', () => {
    const t = repo.createTournament({ name: 'Cup', slug: 'cup' });
    const updated = repo.updateTournament(t.id, {
      game: 'Counter-Strike',
      pointsWin: 3,
      pointsLoss: 1,
      tiebreakers: ['kills', 'kd'],
      groupLegs: 2,
      rulesText: '## Rules\n- one',
    });
    expect(updated).toMatchObject({
      game: 'Counter-Strike',
      pointsWin: 3,
      pointsLoss: 1,
      tiebreakers: ['kills', 'kd'],
      groupLegs: 2,
      rulesText: '## Rules\n- one',
    });
    expect(repo.getTournamentById(t.id)).toEqual(updated);
  });

  it('rejects an invalid number of legs', () => {
    const t = repo.createTournament({ name: 'Cup', slug: 'cup' });
    expect(() => repo.updateTournament(t.id, { groupLegs: 3 as 1 })).toThrow();
  });
});

describe('schedule days', () => {
  it('replaces and lists days in order', () => {
    const { t } = setup();
    repo.replaceScheduleDays(t.id, [
      { date: '2026-10-03', phase: 'group', startTimes: ['14:00', '15:00'], slotMinutes: 60 },
      { date: '2026-10-11', phase: 'semifinal', startTimes: ['14:00'], slotMinutes: 45 },
    ]);
    expect(repo.listScheduleDays(t.id)).toEqual([
      { date: '2026-10-03', phase: 'group', startTimes: ['14:00', '15:00'], slotMinutes: 60 },
      { date: '2026-10-11', phase: 'semifinal', startTimes: ['14:00'], slotMinutes: 45 },
    ]);
    repo.replaceScheduleDays(t.id, [{ date: '2026-10-17', phase: 'final', startTimes: ['14:00'], slotMinutes: 60 }]);
    expect(repo.listScheduleDays(t.id)).toHaveLength(1);
  });
});

describe('team heroes', () => {
  it('stores a hero and rejects duplicates within a tournament', () => {
    const { t, a, b } = setup();
    expect(repo.updateTeam(a.id, { hero: 'axe' }).hero).toBe('axe');
    expect(() => repo.updateTeam(b.id, { hero: 'axe' })).toThrow(/UNIQUE/);
    expect(repo.createTeam(t.id, { code: 'D', name: 'Delta', hero: 'lina' }).hero).toBe('lina');
    expect(repo.createTeam(t.id, { code: 'E', name: 'Echo' }).hero).toBeNull();
  });

  it('refuses a hero that is not in the predefined list', () => {
    const { t, a } = setup();
    expect(() => repo.createTeam(t.id, { code: 'D', name: 'Delta', hero: 'not_a_hero' })).toThrow(/hero/i);
    expect(() => repo.updateTeam(a.id, { hero: '../etc/passwd' })).toThrow(/hero/i);
    expect(repo.getTeam(a.id)!.hero).toBeNull();
  });
});

describe('match editing', () => {
  it('creates, updates and deletes a single match', () => {
    const { t, a, b } = setup();
    const m = repo.createMatch({ tournamentId: t.id, phase: 'group', round: 1, matchNumber: 1 });
    expect(m).toMatchObject({ team1Id: null, team2Id: null, round: 1 });
    const edited = repo.updateMatch(m.id, {
      round: 2,
      scheduledDate: '2026-10-03',
      startTime: '14:00',
      endTime: '15:00',
      team1Id: a.id,
      team2Id: b.id,
    });
    expect(edited).toMatchObject({ round: 2, scheduledDate: '2026-10-03', team1Id: a.id, team2Id: b.id });
    repo.deleteMatch(m.id);
    expect(repo.getMatch(m.id)).toBeUndefined();
  });

  it('replaces group matches atomically and keeps playoff matches', () => {
    const { t, a, b } = setup();
    repo.insertMatches([
      { tournamentId: t.id, phase: 'group', round: 1, matchNumber: 1, team1Id: a.id, team2Id: b.id },
      { tournamentId: t.id, phase: 'semifinal', round: 1, matchNumber: 1 },
    ]);
    repo.replaceGroupMatches(t.id, [{ tournamentId: t.id, phase: 'group', round: 1, matchNumber: 1 }]);
    expect(repo.listMatches(t.id, 'group')[0]).toMatchObject({ team1Id: null });
    expect(repo.listMatches(t.id, 'semifinal')).toHaveLength(1);
    expect(() =>
      repo.replaceGroupMatches(t.id, [
        { tournamentId: t.id, phase: 'group', round: 1, matchNumber: 1 },
        { tournamentId: t.id, phase: 'nope' as 'group', round: 1, matchNumber: 2 },
      ]),
    ).toThrow();
    expect(repo.listMatches(t.id, 'group')).toHaveLength(1);
  });

  it('renumbers group matches by round and reports the highest round', () => {
    const { t } = setup();
    repo.insertMatches([
      { tournamentId: t.id, phase: 'group', round: 2, matchNumber: 1 },
      { tournamentId: t.id, phase: 'group', round: 1, matchNumber: 2 },
      { tournamentId: t.id, phase: 'group', round: 1, matchNumber: 3 },
    ]);
    repo.renumberGroupMatches(t.id);
    expect(repo.listMatches(t.id, 'group').map((m) => [m.round, m.matchNumber])).toEqual([
      [1, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(repo.maxRound(t.id, 'group')).toBe(2);
    expect(repo.maxRound(t.id, 'final')).toBe(0);
  });

  it('knows about teams with matches and tournaments with results', () => {
    const { t, a, b, c } = setup();
    repo.insertMatches([{ tournamentId: t.id, phase: 'group', round: 1, matchNumber: 1, team1Id: a.id, team2Id: b.id }]);
    expect(repo.teamHasMatches(a.id)).toBe(true);
    expect(repo.teamHasMatches(c.id)).toBe(false);
    expect(repo.hasResults(t.id)).toBe(false);
    const [m] = repo.listMatches(t.id);
    repo.recordResult(m!.id, { winnerId: a.id, team1Kills: 1, team1Deaths: 0, team2Kills: 0, team2Deaths: 1 });
    expect(repo.hasResults(t.id)).toBe(true);
  });
});

describe('admin management', () => {
  it('counts, lists, finds and deletes admins', () => {
    expect(repo.countAdmins()).toBe(0);
    const a = repo.createAdmin('root', 'h1');
    const b = repo.createAdmin('second', 'h2');
    expect(repo.countAdmins()).toBe(2);
    expect(repo.listAdmins().map((x) => x.username)).toEqual(['root', 'second']);
    expect(repo.getAdminById(b.id)).toEqual(b);
    repo.createSession('s', b.id, '2030-01-01T00:00:00.000Z');
    repo.deleteAdmin(b.id);
    expect(repo.getAdminById(b.id)).toBeUndefined();
    expect(repo.getValidSession('s', '2026-01-01T00:00:00.000Z')).toBeUndefined();
    expect(repo.getAdminById(a.id)).toBeDefined();
  });
});

describe('active tournament', () => {
  it('has none until one is set, then switches atomically', () => {
    const a = repo.createTournament({ name: 'A', slug: 'a' });
    const b = repo.createTournament({ name: 'B', slug: 'b' });
    expect(a.isActive).toBe(false);
    expect(repo.getActiveTournament()).toBeUndefined();
    repo.setActiveTournament(a.id);
    expect(repo.getActiveTournament()?.id).toBe(a.id);
    repo.setActiveTournament(b.id);
    expect(repo.getActiveTournament()?.id).toBe(b.id);
    expect(repo.getTournamentById(a.id)?.isActive).toBe(false);
    expect(repo.listTournaments().filter((t) => t.isActive)).toHaveLength(1);
  });

  it('keeps the previous active tournament when the target does not exist', () => {
    const a = repo.createTournament({ name: 'A', slug: 'a' });
    repo.setActiveTournament(a.id);
    expect(() => repo.setActiveTournament(999)).toThrow(/not found/);
    expect(repo.getActiveTournament()?.id).toBe(a.id);
  });
});

describe('stored tiebreakers', () => {
  it('drops unknown and repeated criteria when reading a tournament', () => {
    const { t } = setup();
    db.prepare('UPDATE tournaments SET tiebreakers = ? WHERE id = ?').run('kd,bogus,kills,kd', t.id);
    expect(repo.getTournamentById(t.id)!.tiebreakers).toEqual(['kd', 'kills']);
  });
});
