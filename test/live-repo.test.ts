import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/open.js';
import { createRepository, type Match, type Repository, type Team, type Tournament } from '../src/db/repository.js';

let db: Database.Database;
let repo: Repository;
let tournament: Tournament;
let a: Team;
let b: Team;
let c: Team;

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = createRepository(db);
  tournament = repo.createTournament({ name: 'Copa', slug: 'copa' });
  a = repo.createTeam(tournament.id, { code: 'A', name: 'Alpha' });
  b = repo.createTeam(tournament.id, { code: 'B', name: 'Bravo' });
  c = repo.createTeam(tournament.id, { code: 'C', name: 'Charlie' });
});
afterEach(() => db.close());

const live = () => repo.getTournamentById(tournament.id)!.live;
const match = (phase: Match['phase'], n = 1, teams: [number | null, number | null] = [a.id, b.id]): Match =>
  repo.createMatch({ tournamentId: tournament.id, phase, round: 1, matchNumber: n, team1Id: teams[0], team2Id: teams[1] });
const game = (matchId: number, number: number, winner: Team) =>
  repo.saveGame(matchId, { gameNumber: number, winnerId: winner.id, team1Kills: 1, team1Deaths: 1, team2Kills: 1, team2Deaths: 1 });
const mark = (m: Match, gameNumber = 1, startedAt = '2026-10-03T19:00:00.000Z') => repo.setLive(tournament.id, { matchId: m.id, gameNumber, startedAt });

describe('the live game of a tournament', () => {
  it('is nothing by default, can be set, replaced by another and cleared', () => {
    expect(live()).toBeNull();
    const m1 = match('group', 1);
    const m2 = match('group', 2);
    mark(m1);
    expect(live()).toEqual({ matchId: m1.id, gameNumber: 1, startedAt: '2026-10-03T19:00:00.000Z' });
    mark(m2, 1, '2026-10-03T20:00:00.000Z');
    expect(live()).toEqual({ matchId: m2.id, gameNumber: 1, startedAt: '2026-10-03T20:00:00.000Z' });
    repo.setLive(tournament.id, null);
    expect(live()).toBeNull();
  });

  it('belongs to one tournament: another tournament has its own', () => {
    const other = repo.createTournament({ name: 'Otra', slug: 'otra' });
    mark(match('group'));
    expect(repo.getTournamentById(other.id)!.live).toBeNull();
  });

  it('is not touched by saving the rules', () => {
    mark(match('group'));
    repo.updateTournament(tournament.id, { pointsWin: 3 });
    expect(live()).not.toBeNull();
  });

  it('disappears with its match', () => {
    const m = match('group');
    mark(m);
    repo.deleteMatch(m.id);
    expect(live()).toBeNull();
    const m2 = match('group', 2);
    mark(m2);
    repo.replaceGroupMatches(tournament.id, []);
    expect(live()).toBeNull();
  });
});

describe('the live mark turns itself off when it stops being true', () => {
  it('saving the result of the live game', () => {
    const m = match('group');
    mark(m);
    game(m.id, 1, a);
    expect(live()).toBeNull();
  });

  it('a single result recorded over the match, and clearing it', () => {
    const m = match('group');
    mark(m);
    repo.recordResult(m.id, { winnerId: a.id, team1Kills: 1, team1Deaths: 1, team2Kills: 1, team2Deaths: 1 });
    expect(live()).toBeNull();
  });

  it('the next game of a series stays live until it is saved', () => {
    repo.updateTournament(tournament.id, { semifinalGames: 3 });
    const m = match('semifinal');
    game(m.id, 1, a);
    mark(m, 2);
    expect(live()).toMatchObject({ gameNumber: 2 });
    game(m.id, 2, b);
    expect(live()).toBeNull();
  });

  it('correcting an earlier game so the series is decided, or the game is no longer next', () => {
    repo.updateTournament(tournament.id, { semifinalGames: 3 });
    const m = match('semifinal');
    game(m.id, 1, a);
    game(m.id, 2, b);
    mark(m, 3);
    game(m.id, 2, a); // 2-0: decided, game 3 is not played
    expect(live()).toBeNull();
    repo.deleteGame(m.id, 2);
    mark(m, 2);
    repo.deleteGame(m.id, 1); // game 1 is next again
    expect(live()).toBeNull();
  });

  it('results of other matches do not matter', () => {
    const m1 = match('group', 1);
    const m2 = match('group', 2);
    mark(m1);
    game(m2.id, 1, a);
    expect(live()).toMatchObject({ matchId: m1.id });
  });

  it('clearing the result of the match, or resetting it', () => {
    repo.updateTournament(tournament.id, { semifinalGames: 3 });
    const m = match('semifinal');
    game(m.id, 1, a);
    mark(m, 2);
    repo.clearResult(m.id);
    expect(live()).toBeNull();
  });

  it('changing the teams of the match (a different pairing is a different match)', () => {
    const m = match('group');
    mark(m);
    repo.updateMatchTeams(m.id, a.id, b.id);
    expect(live()).not.toBeNull(); // same teams: still the same match
    repo.updateMatchTeams(m.id, a.id, c.id);
    expect(live()).toBeNull();
    mark(m);
    repo.updateMatchTeams(m.id, null, null);
    expect(live()).toBeNull();
  });

  it('editing the match through the fixture editor with other teams', () => {
    const m = match('group');
    mark(m);
    repo.updateMatch(m.id, { round: 1, scheduledDate: null, startTime: null, endTime: null, team1Id: a.id, team2Id: c.id });
    expect(live()).toBeNull();
  });

  it('shortening the series so the live game no longer exists', () => {
    repo.updateTournament(tournament.id, { semifinalGames: 3 });
    const m = match('semifinal');
    game(m.id, 1, a);
    mark(m, 2);
    repo.updateTournament(tournament.id, { semifinalGames: 1 }); // game 1 already decided a best of 1
    expect(live()).toBeNull();
  });
});

describe('migration 009', () => {
  it('adds the live columns to tournaments with no live game', () => {
    const columns = (db.prepare('PRAGMA table_info(tournaments)').all() as { name: string }[]).map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(['live_match_id', 'live_game_number', 'live_started_at']));
    expect(db.pragma('user_version', { simple: true })).toBe(9);
  });
});
