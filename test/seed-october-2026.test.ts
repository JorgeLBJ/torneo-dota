import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/open.js';
import { createRepository, type Repository } from '../src/db/repository.js';
import { loadState } from '../src/services/state.js';
import { SLUG, seedOctober2026 } from '../scripts/seed-october-2026.js';

let db: Database.Database;
let repo: Repository;

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = createRepository(db);
});
afterEach(() => db.close());

// The stakeholder's sheet, verbatim: [round, date, start, [pairs], bye].
const SHEET: [number, string, string, string[], string][] = [
  [1, '2026-10-03', '14:00', ['A-B', 'C-D', 'E-F'], 'G'],
  [2, '2026-10-03', '15:00', ['B-G', 'C-F', 'D-E'], 'A'],
  [3, '2026-10-03', '16:00', ['A-E', 'C-G', 'D-F'], 'B'],
  [4, '2026-10-03', '17:00', ['A-F', 'B-E', 'D-G'], 'C'],
  [5, '2026-10-10', '14:00', ['A-G', 'B-F', 'C-E'], 'D'],
  [6, '2026-10-10', '15:00', ['A-D', 'B-C', 'F-G'], 'E'],
  [7, '2026-10-10', '16:00', ['A-C', 'B-D', 'E-G'], 'F'],
];

const seeded = () => {
  const result = seedOctober2026(repo);
  const tournament = repo.getTournamentBySlug(SLUG)!;
  const teams = repo.listTeams(tournament.id);
  const code = new Map(teams.map((t) => [t.id, t.code]));
  const matches = repo.listMatches(tournament.id, 'group');
  return { result, tournament, teams, code, matches };
};

describe('seedOctober2026', () => {
  it('creates the active tournament with the confirmed rules', () => {
    const { result, tournament } = seeded();
    expect(result.created).toBe(true);
    expect(tournament).toMatchObject({
      name: 'Torneo All vs All · Oct 2026',
      slug: 'torneo-oct-2026',
      game: 'Dota 2',
      pointsWin: 1,
      pointsLoss: 0,
      tiebreakers: ['kd', 'kills'],
      groupLegs: 1,
      qualifiers: 4,
      timezone: 'America/Lima',
      isActive: true,
    });
    expect(repo.getActiveTournament()!.id).toBe(tournament.id);
  });

  it('creates teams A to G without heroes or captains', () => {
    const { teams } = seeded();
    expect(teams.map((t) => [t.code, t.name, t.hero, t.captain])).toEqual(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((c) => [c, `Equipo ${c}`, null, null]),
    );
  });

  it('sets the calendar: two group days, the semifinal day and the final day, 60-minute slots', () => {
    const { tournament } = seeded();
    expect(repo.listScheduleDays(tournament.id)).toEqual([
      { date: '2026-10-03', phase: 'group', startTimes: ['14:00', '15:00', '16:00', '17:00'], slotMinutes: 60 },
      { date: '2026-10-10', phase: 'group', startTimes: ['14:00', '15:00', '16:00'], slotMinutes: 60 },
      { date: '2026-10-11', phase: 'semifinal', startTimes: ['14:00', '15:00'], slotMinutes: 60 },
      { date: '2026-10-17', phase: 'final', startTimes: ['14:00'], slotMinutes: 60 },
    ]);
  });

  it('reproduces the stakeholder fixture exactly: 21 matches, numbered 1 to 21, on the sheet schedule', () => {
    const { code, matches } = seeded();
    expect(matches).toHaveLength(21);
    expect(matches.map((m) => m.matchNumber)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    const actual = matches.map((m) => [m.round, m.scheduledDate, m.startTime, m.endTime, `${code.get(m.team1Id!)}-${code.get(m.team2Id!)}`]);
    const expected = SHEET.flatMap(([round, date, start, pairs]) => {
      const [h, min] = start.split(':').map(Number) as [number, number];
      const end = `${String(h! + 1).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      return pairs.map((pair) => [round, date, start, end, pair]);
    });
    expect(actual).toEqual(expected);
  });

  it('stores the schedule as UTC instants (Lima is UTC-5)', () => {
    const { matches } = seeded();
    expect(matches[0]).toMatchObject({ startsAt: '2026-10-03T19:00:00Z', endsAt: '2026-10-03T20:00:00Z' });
    expect(matches[9]).toMatchObject({ startsAt: '2026-10-03T22:00:00Z' });
    expect(matches[20]).toMatchObject({ startsAt: '2026-10-10T21:00:00Z', endsAt: '2026-10-10T22:00:00Z' });
  });

  it('has every pair exactly once and exactly one bye per team', () => {
    const { teams, code, matches } = seeded();
    const pairs = matches.map((m) => [code.get(m.team1Id!)!, code.get(m.team2Id!)!].sort().join('-'));
    const allPairs = new Set(pairs);
    expect(pairs).toHaveLength(21);
    expect(allPairs.size).toBe(21);

    const byes = new Map<string, number>();
    for (const [round, , , , bye] of SHEET) {
      const playing = new Set(matches.filter((m) => m.round === round).flatMap((m) => [code.get(m.team1Id!), code.get(m.team2Id!)]));
      const resting = teams.map((t) => t.code).filter((c) => !playing.has(c));
      expect(resting).toEqual([bye]);
      byes.set(bye, (byes.get(bye) ?? 0) + 1);
    }
    expect([...byes.entries()].sort()).toEqual(teams.map((t) => [t.code, 1]).sort());
  });

  it('starts with an empty table and no playoff matches', () => {
    const { tournament } = seeded();
    const state = loadState(repo, tournament);
    expect(state.pendingGroup).toBe(21);
    expect(state.standings.every((row) => row.played === 0)).toBe(true);
    expect(repo.listMatches(tournament.id).filter((m) => m.phase !== 'group')).toEqual([]);
  });

  it('is idempotent: a second run changes nothing', () => {
    const first = seeded();
    const again = seedOctober2026(repo);
    expect(again.created).toBe(false);
    expect(repo.listTournaments()).toHaveLength(1);
    expect(repo.listTeams(first.tournament.id)).toEqual(first.teams);
    expect(repo.listMatches(first.tournament.id, 'group')).toEqual(first.matches);
  });

  it('leaves an existing tournament with that slug untouched, even if it was edited', () => {
    const mine = repo.createTournament({ name: 'Custom', slug: SLUG });
    expect(seedOctober2026(repo).created).toBe(false);
    expect(repo.getTournamentById(mine.id)!.name).toBe('Custom');
    expect(repo.listTeams(mine.id)).toEqual([]);
  });

  it('takes over the active flag from another tournament', () => {
    const old = repo.createTournament({ name: 'Old', slug: 'old' });
    repo.setActiveTournament(old.id);
    const { tournament } = seeded();
    expect(repo.getTournamentById(old.id)!.isActive).toBe(false);
    expect(repo.getActiveTournament()!.id).toBe(tournament.id);
  });
});
