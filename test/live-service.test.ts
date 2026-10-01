import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/open.js';
import { createRepository, type Match, type Repository, type Team, type Tournament } from '../src/db/repository.js';
import { saveGameResult } from '../src/services/games.js';
import { clearLive, clearStream, markLive, setStream } from '../src/services/live.js';
import { assignSemifinalTeams, clearPlayoffResult, markPlayoffLive, resetPlayoffs } from '../src/services/playoffs.js';
import { loadState } from '../src/services/state.js';

let db: Database.Database;
let repo: Repository;
let tournament: Tournament;
let teams: Team[];
const NOW = new Date('2026-10-03T19:00:00.000Z');
const LATER = new Date('2026-10-03T19:30:00.000Z');

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = createRepository(db);
  tournament = repo.createTournament({ name: 'Cup', slug: 'cup' });
  teams = ['A', 'B', 'C', 'D'].map((code) => repo.createTeam(tournament.id, { code, name: `Team ${code}` }));
});
afterEach(() => db.close());

const fresh = () => repo.getTournamentById(tournament.id)!;
const lives = () => repo.listLive(tournament.id);
const live = () => lives()[0] ?? null;
const groupMatch = (n = 1, t1: number | null = teams[0]!.id, t2: number | null = teams[1]!.id): Match =>
  repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: n, matchNumber: n, team1Id: t1, team2Id: t2 });
const raw = (winner: number) => ({ winner: String(winner), t1Kills: '20', t1Deaths: '10', t2Kills: '10', t2Deaths: '20' });
const save = (m: Match, n: number, winner: Team) => saveGameResult(repo, fresh(), repo.getMatch(m.id)!, n, raw(winner.id));

describe('markLive', () => {
  it('marks the first game of a match with the time it was marked', () => {
    const m = groupMatch();
    expect(markLive(repo, fresh(), m, 1, NOW)).toEqual({ ok: true, value: undefined });
    expect(live()).toEqual({ matchId: m.id, gameNumber: 1, startedAt: '2026-10-03T19:00:00.000Z' });
  });

  it('marking another match keeps the others live: several games at once', () => {
    const m1 = groupMatch(1);
    const m2 = groupMatch(2, teams[2]!.id, teams[3]!.id);
    markLive(repo, fresh(), m1, 1, NOW);
    markLive(repo, fresh(), m2, 1, LATER);
    expect(lives()).toEqual([
      { matchId: m1.id, gameNumber: 1, startedAt: '2026-10-03T19:00:00.000Z' },
      { matchId: m2.id, gameNumber: 1, startedAt: '2026-10-03T19:30:00.000Z' },
    ]);
  });

  it('marking the game that is already live keeps its start time', () => {
    const m = groupMatch();
    markLive(repo, fresh(), m, 1, NOW);
    markLive(repo, fresh(), m, 1, LATER);
    expect(live()!.startedAt).toBe('2026-10-03T19:00:00.000Z');
  });

  it('refuses a match without both teams, a played game, a decided series and an out-of-order game', () => {
    const open = groupMatch(1, teams[0]!.id, null);
    expect(markLive(repo, fresh(), open, 1, NOW)).toEqual({ ok: false, error: 'El partido todavía no tiene los dos equipos definidos.' });
    const m = groupMatch(2, teams[2]!.id, teams[3]!.id);
    save(m, 1, teams[2]!);
    expect(markLive(repo, fresh(), repo.getMatch(m.id)!, 1, NOW)).toEqual({ ok: false, error: 'Ese juego ya tiene resultado.' });
    repo.updateTournament(tournament.id, { groupGames: 3 });
    const series = groupMatch(3, teams[0]!.id, teams[2]!.id);
    expect(markLive(repo, fresh(), series, 3, NOW)).toEqual({ ok: false, error: 'Marca primero el juego 1: los juegos se juegan en orden.' });
    save(series, 1, teams[0]!);
    save(series, 2, teams[0]!);
    expect(markLive(repo, fresh(), repo.getMatch(series.id)!, 3, NOW)).toEqual({ ok: false, error: 'La serie ya está decidida.' });
    expect(live()).toBeNull();
  });

  it('a refused mark leaves the current live game alone', () => {
    const m1 = groupMatch(1);
    markLive(repo, fresh(), m1, 1, NOW);
    const open = groupMatch(2, teams[0]!.id, null);
    markLive(repo, fresh(), open, 1, LATER);
    expect(live()).toMatchObject({ matchId: m1.id });
  });

  it('only a match of this tournament', () => {
    const other = repo.createTournament({ name: 'Otra', slug: 'otra' });
    const x = repo.createTeam(other.id, { code: 'X', name: 'X' });
    const y = repo.createTeam(other.id, { code: 'Y', name: 'Y' });
    const foreign = repo.createMatch({ tournamentId: other.id, phase: 'group', round: 1, matchNumber: 1, team1Id: x.id, team2Id: y.id });
    expect(markLive(repo, fresh(), foreign, 1, NOW)).toEqual({ ok: false, error: 'Partido no encontrado.' });
  });
});

describe('clearLive and the automatic clearing', () => {
  it('clears by hand, and clearing nothing is fine', () => {
    const m = groupMatch();
    markLive(repo, fresh(), m, 1, NOW);
    expect(clearLive(repo, fresh(), m.id, 1)).toBe(true);
    expect(live()).toBeNull();
    expect(clearLive(repo, fresh(), m.id, 1)).toBe(false);
  });

  it('a stale clear (another match or game) leaves the live games alone', () => {
    repo.updateTournament(tournament.id, { groupGames: 3 });
    const m1 = groupMatch(1);
    const m2 = groupMatch(2, teams[2]!.id, teams[3]!.id);
    markLive(repo, fresh(), m1, 1, NOW);
    markLive(repo, fresh(), m2, 1, NOW);
    expect(clearLive(repo, fresh(), m1.id, 2)).toBe(false);
    expect(clearLive(repo, fresh(), m1.id, 1)).toBe(true);
    expect(lives()).toMatchObject([{ matchId: m2.id }]);
    expect(clearLive(repo, fresh(), 9999, 1)).toBe(false);
  });

  it('saving the result of the live game turns it off through the normal save', () => {
    const m = groupMatch();
    markLive(repo, fresh(), m, 1, NOW);
    expect(save(m, 1, teams[0]!)).toMatchObject({ ok: true });
    expect(live()).toBeNull();
  });

  it('the next game of a series is live after the previous one is saved, and turns off with its own result', () => {
    repo.updateTournament(tournament.id, { groupGames: 3 });
    const m = groupMatch();
    save(m, 1, teams[0]!);
    markLive(repo, fresh(), repo.getMatch(m.id)!, 2, NOW);
    expect(live()).toMatchObject({ gameNumber: 2 });
    save(m, 2, teams[1]!);
    expect(live()).toBeNull();
  });
});

describe('the match on the stream', () => {
  it('only a live match of the tournament can be put on the stream; the new one replaces the old', () => {
    const m1 = groupMatch(1);
    const m2 = groupMatch(2, teams[2]!.id, teams[3]!.id);
    expect(setStream(repo, fresh(), m1.id)).toEqual({ ok: false, error: 'Solo se puede pasar al stream una partida en vivo.' });
    markLive(repo, fresh(), m1, 1, NOW);
    markLive(repo, fresh(), m2, 1, NOW);
    expect(setStream(repo, fresh(), m1.id)).toEqual({ ok: true, value: undefined });
    expect(fresh().streamMatchId).toBe(m1.id);
    setStream(repo, fresh(), m2.id);
    expect(fresh().streamMatchId).toBe(m2.id);
    clearStream(repo, fresh());
    expect(fresh().streamMatchId).toBeNull();
    expect(lives()).toHaveLength(2);
  });

  it('a foreign match is refused', () => {
    const other = repo.createTournament({ name: 'Otra', slug: 'otra' });
    const x = repo.createTeam(other.id, { code: 'X', name: 'X' });
    const y = repo.createTeam(other.id, { code: 'Y', name: 'Y' });
    const foreign = repo.createMatch({ tournamentId: other.id, phase: 'group', round: 1, matchNumber: 1, team1Id: x.id, team2Id: y.id });
    repo.setLive(foreign.id, { gameNumber: 1, startedAt: NOW.toISOString() });
    expect(setStream(repo, fresh(), foreign.id)).toMatchObject({ ok: false });
  });

  it('clearing the live mark of the stream match, or saving its result, takes it off the stream', () => {
    const m = groupMatch();
    markLive(repo, fresh(), m, 1, NOW);
    setStream(repo, fresh(), m.id);
    clearLive(repo, fresh(), m.id, 1);
    expect(fresh().streamMatchId).toBeNull();
    markLive(repo, fresh(), m, 1, NOW);
    setStream(repo, fresh(), m.id);
    save(m, 1, teams[0]!);
    expect(fresh().streamMatchId).toBeNull();
  });
});

describe('playoffs', () => {
  const setup = () => {
    assignSemifinalTeams(repo, tournament, [teams[0]!.id, teams[3]!.id, teams[1]!.id, teams[2]!.id]);
  };
  const mark = (phase: 'semifinal' | 'final', number: number, game: number, at = NOW) =>
    markPlayoffLive(repo, tournament, loadState(repo, tournament), phase, number, game, at);

  it('marks a semifinal, which stores its teams even before any result', () => {
    setup();
    expect(mark('semifinal', 2, 1)).toEqual({ ok: true, value: undefined });
    const sf2 = repo.listMatches(tournament.id, 'semifinal').find((m) => m.matchNumber === 2)!;
    expect(live()).toMatchObject({ matchId: sf2.id, gameNumber: 1 });
  });

  it('the final cannot be marked until both finalists are known', () => {
    setup();
    expect(mark('final', 1, 1)).toEqual({ ok: false, error: 'El partido todavía no tiene los dos equipos definidos.' });
    expect(live()).toBeNull();
  });

  it('a semifinal game is live until its result is saved', async () => {
    setup();
    mark('semifinal', 1, 1);
    const sf1 = repo.listMatches(tournament.id, 'semifinal').find((m) => m.matchNumber === 1)!;
    saveGameResult(repo, fresh(), sf1, 1, raw(teams[0]!.id));
    expect(live()).toBeNull();
  });

  it('resetting the playoffs or clearing a playoff result turns it off', () => {
    setup();
    mark('semifinal', 1, 1);
    resetPlayoffs(repo, tournament);
    expect(live()).toBeNull();
    setup();
    saveGameResult(repo, fresh(), repo.listMatches(tournament.id, 'semifinal')[0]!, 1, raw(teams[0]!.id));
    mark('semifinal', 1, 2);
    clearPlayoffResult(repo, tournament, 'semifinal', 1);
    expect(live()).toBeNull();
  });

  it('assigning other semifinal teams turns it off', () => {
    setup();
    mark('semifinal', 1, 1);
    assignSemifinalTeams(repo, tournament, [teams[1]!.id, teams[2]!.id, teams[0]!.id, teams[3]!.id]);
    expect(live()).toBeNull();
  });
});

describe('markPlayoffLive validates before it mutates', () => {
  it('a refused mark leaves the stored match, its teams and its games untouched', async () => {
    const { makeApp } = await import('./helpers/app.js');
    const { loadState } = await import('../src/services/state.js');
    const { assignSemifinalTeams, markPlayoffLive } = await import('../src/services/playoffs.js');
    const t = await makeApp({});
    const tournament = t.repo.createTournament({ name: 'C', slug: 'c' });
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((code) => t.repo.createTeam(tournament.id, { code, name: code })) as { id: number }[] as { id: number }[];
    assignSemifinalTeams(t.repo, tournament, [a!.id, d!.id, b!.id, c!.id]);
    const sf1 = t.repo.listMatches(tournament.id, 'semifinal').find((m) => m.matchNumber === 1)!;
    t.repo.saveGame(sf1.id, { gameNumber: 1, winnerId: a!.id, team1Kills: 20, team1Deaths: 10, team2Kills: 10, team2Deaths: 20 });
    const state = loadState(t.repo, tournament);
    // the derived bracket now says a different pairing for this slot
    state.bracket.semifinals[0] = { ...state.bracket.semifinals[0]!, team1Id: a!.id, team2Id: c!.id };
    // game 2 of a realigned (empty) series is not the next game: refused
    const result = markPlayoffLive(t.repo, tournament, state, 'semifinal', 1, 2, new Date());
    expect(result.ok).toBe(false);
    const after = t.repo.listMatches(tournament.id, 'semifinal').find((m) => m.matchNumber === 1)!;
    expect([after.team1Id, after.team2Id]).toEqual([a!.id, d!.id]);
    expect(t.repo.listGames(sf1.id)).toHaveLength(1);
    expect(t.repo.listLive(tournament.id)).toEqual([]);
    t.db.close();
  });
});
