import { readFileSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/open.js';
import { createRepository, type Match, type Repository, type Team, type Tournament } from '../src/db/repository.js';
import { gameFromSnapshot } from '../src/dota/import.js';
import { mapOpenDotaMatch } from '../src/dota/opendota.js';
import { DotaLookupError, type DotaMatchSource } from '../src/dota/source.js';
import { deleteGameResult, prepareGameImport, saveGameResult } from '../src/services/games.js';
import { assignSemifinalTeams, clearPlayoffResult, deletePlayoffGame, recordPlayoffResult } from '../src/services/playoffs.js';
import { loadState } from '../src/services/state.js';

let db: Database.Database;
let repo: Repository;
let tournament: Tournament;
let teams: Team[];

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = createRepository(db);
  tournament = repo.createTournament({ name: 'Cup', slug: 'cup' });
  teams = ['A', 'B', 'C', 'D'].map((code) => repo.createTeam(tournament.id, { code, name: `Team ${code}` }));
});
afterEach(() => db.close());

const raw = (winner: number, stats: [number, number, number, number] = [20, 10, 10, 20]) => ({
  winner: String(winner),
  t1Kills: String(stats[0]),
  t1Deaths: String(stats[1]),
  t2Kills: String(stats[2]),
  t2Deaths: String(stats[3]),
});
const groupMatch = (): Match =>
  repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: 1, matchNumber: 1, team1Id: teams[0]!.id, team2Id: teams[1]!.id });

describe('saveGameResult', () => {
  it('best of 1: game 1 decides the match, like a plain result', () => {
    const match = groupMatch();
    const saved = saveGameResult(repo, tournament, match, 1, raw(teams[1]!.id));
    expect(saved).toMatchObject({ ok: true });
    expect(repo.getMatch(match.id)).toMatchObject({ winnerId: teams[1]!.id, team1Kills: 20 });
  });

  it('keeps the existing validation messages (winner, numbers, teams)', () => {
    const match = groupMatch();
    expect(saveGameResult(repo, tournament, match, 1, raw(999))).toEqual({ ok: false, error: 'Elige el equipo ganador.' });
    expect(saveGameResult(repo, tournament, match, 1, { ...raw(teams[0]!.id), t1Kills: 'x' })).toMatchObject({
      ok: false,
      error: 'Carga kills y deaths de ambos equipos como números enteros entre 0 y 999.',
    });
    const open = repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: 1, matchNumber: 2, team1Id: teams[0]!.id });
    expect(saveGameResult(repo, tournament, open, 1, raw(teams[0]!.id))).toMatchObject({ ok: false });
  });

  it('refuses a game number outside the series and one that skips a game', () => {
    const match = groupMatch();
    expect(saveGameResult(repo, tournament, match, 2, raw(teams[0]!.id))).toEqual({
      ok: false,
      error: 'El juego 2 no existe en una serie al mejor de 1.',
    });
    const t3 = repo.updateTournament(tournament.id, { groupGames: 3 });
    expect(saveGameResult(repo, t3, match, 2, raw(teams[0]!.id))).toEqual({ ok: false, error: 'Carga los juegos en orden: falta el juego 1.' });
  });

  it('refuses a game after the series was decided, and lets an earlier game be corrected', () => {
    const t3 = repo.updateTournament(tournament.id, { groupGames: 3 });
    const match = groupMatch();
    saveGameResult(repo, t3, match, 1, raw(teams[0]!.id));
    saveGameResult(repo, t3, match, 2, raw(teams[0]!.id));
    expect(repo.getMatch(match.id)!.winnerId).toBe(teams[0]!.id);
    expect(saveGameResult(repo, t3, match, 3, raw(teams[1]!.id))).toEqual({
      ok: false,
      error: 'La serie ya estaba decidida: el juego 3 sobra.',
    });
    // correcting game 2 to the other team is fine: it makes the series 1-1
    expect(saveGameResult(repo, t3, match, 2, raw(teams[1]!.id))).toMatchObject({ ok: true });
    expect(repo.getMatch(match.id)!.winnerId).toBeNull();
  });

  it('storing the import data with the game: radiant side, Dota match id and snapshot', () => {
    const match = groupMatch();
    const saved = saveGameResult(repo, tournament, match, 1, raw(teams[0]!.id), {
      radiantTeamId: teams[0]!.id,
      dotaMatchId: 9023462170,
      snapshot: '{"matchId":9023462170}',
    });
    expect(saved).toMatchObject({ ok: true });
    expect(repo.listGames(match.id)[0]).toMatchObject({ radiantTeamId: teams[0]!.id, dotaMatchId: 9023462170, dotaSnapshot: '{"matchId":9023462170}' });
    expect(repo.listGames(match.id)[0]!.importedAt).not.toBeNull();
  });

  it('the radiant team must be one of the two teams', () => {
    const match = groupMatch();
    expect(saveGameResult(repo, tournament, match, 1, raw(teams[0]!.id), { radiantTeamId: teams[3]!.id, dotaMatchId: 1, snapshot: '{}' })).toEqual({
      ok: false,
      error: 'El equipo Radiant debe ser uno de los dos equipos del partido.',
    });
  });

  it('saving a game by hand over an imported one drops the import (the numbers no longer match the snapshot)', () => {
    const match = groupMatch();
    saveGameResult(repo, tournament, match, 1, raw(teams[0]!.id), { radiantTeamId: teams[0]!.id, dotaMatchId: 5, snapshot: '{}' });
    saveGameResult(repo, tournament, match, 1, raw(teams[1]!.id));
    expect(repo.listGames(match.id)[0]).toMatchObject({ dotaMatchId: null, dotaSnapshot: null, radiantTeamId: null });
  });
});

describe('deleteGameResult', () => {
  it('removes the last game; refuses to remove one that has later games', () => {
    const t3 = repo.updateTournament(tournament.id, { groupGames: 3 });
    const match = groupMatch();
    saveGameResult(repo, t3, match, 1, raw(teams[0]!.id));
    saveGameResult(repo, t3, match, 2, raw(teams[1]!.id));
    expect(deleteGameResult(repo, t3, match, 1)).toEqual({ ok: false, error: 'Borra primero los juegos siguientes.' });
    expect(deleteGameResult(repo, t3, match, 2)).toMatchObject({ ok: true });
    expect(repo.listGames(match.id)).toHaveLength(1);
    expect(deleteGameResult(repo, t3, match, 5)).toEqual({ ok: false, error: 'Ese juego no tiene resultado.' });
  });
});

describe('playoff series', () => {
  const setup = () => {
    assignSemifinalTeams(repo, tournament, [teams[0]!.id, teams[3]!.id, teams[1]!.id, teams[2]!.id]);
    return loadState(repo, tournament);
  };
  const record = (phase: 'semifinal' | 'final', number: number, game: number, winner: number) =>
    recordPlayoffResult(repo, tournament, loadState(repo, tournament), phase, number, raw(winner), { gameNumber: game });

  it('a semifinal is a best of 3 by default: two wins and the winner advances to the final', () => {
    setup();
    const a = teams[0]!.id;
    const d = teams[3]!.id;
    expect(record('semifinal', 1, 1, a)).toMatchObject({ ok: true });
    expect(loadState(repo, tournament).bracket.semifinals[0].winnerId).toBeNull();
    expect(record('semifinal', 1, 2, d)).toMatchObject({ ok: true });
    expect(loadState(repo, tournament).bracket.semifinals[0].winnerId).toBeNull();
    expect(record('semifinal', 1, 3, a)).toMatchObject({ ok: true });
    const state = loadState(repo, tournament);
    expect(state.bracket.semifinals[0].winnerId).toBe(a);
    expect(state.bracket.final.team1Id).toBe(a);
  });

  it('changing the result of a game so a different team wins the semifinal resets the final', () => {
    setup();
    const [a, b, c, d] = teams.map((t) => t.id) as [number, number, number, number];
    record('semifinal', 1, 1, a);
    record('semifinal', 1, 2, a);
    record('semifinal', 2, 1, b);
    record('semifinal', 2, 2, b);
    expect(loadState(repo, tournament).bracket.final).toMatchObject({ team1Id: a, team2Id: b });
    record('final', 1, 1, a);
    expect(repo.listMatches(tournament.id, 'final')[0]!.team1Kills).toBe(20);
    // SF1: game 2 goes to D instead -> 1-1, no winner, the final loses its team and its games
    record('semifinal', 1, 2, d);
    const state = loadState(repo, tournament);
    expect(state.bracket.semifinals[0].winnerId).toBeNull();
    expect(state.bracket.final.team1Id).toBeNull();
    expect(repo.listMatches(tournament.id, 'final')[0]!.team1Kills).toBeNull();
    expect(repo.listGames(repo.listMatches(tournament.id, 'final')[0]!.id)).toEqual([]);
    void c;
  });

  it('the final is a best of 5: the champion needs three wins', () => {
    setup();
    const [a, b] = teams.map((t) => t.id) as [number, number];
    for (const g of [1, 2]) record('semifinal', 1, g, a);
    for (const g of [1, 2]) record('semifinal', 2, g, b);
    for (const [g, w] of [[1, a], [2, b], [3, a], [4, b]] as const) record('final', 1, g, w);
    expect(loadState(repo, tournament).bracket.championId).toBeNull();
    record('final', 1, 5, b);
    expect(loadState(repo, tournament).bracket.championId).toBe(b);
    expect(record('final', 1, 6, a)).toMatchObject({ ok: false });
  });

  it('deleting a playoff game un-decides the series and, for a semifinal, resets the final', () => {
    setup();
    const [a, b] = teams.map((t) => t.id) as [number, number];
    for (const g of [1, 2]) record('semifinal', 1, g, a);
    for (const g of [1, 2]) record('semifinal', 2, g, b);
    record('final', 1, 1, a);
    deletePlayoffGame(repo, tournament, 'semifinal', 1, 2);
    const state = loadState(repo, tournament);
    expect(state.bracket.semifinals[0].winnerId).toBeNull();
    expect(state.bracket.final.team1Id).toBeNull();
  });

  it('clearing a playoff match removes all of its games', () => {
    setup();
    record('semifinal', 1, 1, teams[0]!.id);
    clearPlayoffResult(repo, tournament, 'semifinal', 1);
    expect(repo.listTournamentGames(tournament.id)).toEqual([]);
  });

  it('best of 1 playoffs behave like before', () => {
    const t1 = repo.updateTournament(tournament.id, { semifinalGames: 1, finalGames: 1 });
    assignSemifinalTeams(repo, t1, [teams[0]!.id, teams[3]!.id, teams[1]!.id, teams[2]!.id]);
    recordPlayoffResult(repo, t1, loadState(repo, t1), 'semifinal', 1, raw(teams[0]!.id));
    expect(loadState(repo, t1).bracket.semifinals[0].winnerId).toBe(teams[0]!.id);
  });
});

describe('prepareGameImport', () => {
  const snapshot = mapOpenDotaMatch(JSON.parse(readFileSync(new URL('./fixtures/opendota-9023462170.json', import.meta.url), 'utf8')));
  const source = (fail?: DotaLookupError): DotaMatchSource => ({
    fetch: async () => {
      if (fail) throw fail;
      return snapshot;
    },
  });
  const deathsOf = (side: 'radiant' | 'dire') => snapshot.players.filter((p) => p.side === side).reduce((n, p) => n + p.deaths, 0);
  // team 1 was Radiant and won 42-41
  const imported = (over: Record<string, string> = {}) => ({
    ...raw(0),
    winner: '1',
    t1Kills: '42',
    t1Deaths: String(deathsOf('radiant')),
    t2Kills: '41',
    t2Deaths: String(deathsOf('dire')),
    ...over,
  });
  const teamsOf = (): [number, number] => [1, 2];

  it('no Match ID: a manual game, or keep the import the game already has', async () => {
    expect(await prepareGameImport(source(), teamsOf(), imported(), { dotaMatchId: '', winner: '', keep: false })).toEqual({ ok: true, value: undefined });
    expect(await prepareGameImport(source(), teamsOf(), imported(), { dotaMatchId: '', winner: '', keep: true })).toEqual({ ok: true, value: 'keep' });
  });

  it('a Match ID with who won and matching numbers becomes an import with the compact snapshot', async () => {
    const result = await prepareGameImport(source(), teamsOf(), imported(), { dotaMatchId: '9023462170', winner: '1', keep: false });
    expect(result).toMatchObject({ ok: true, value: { radiantTeamId: 1, dotaMatchId: 9023462170 } });
    if (!result.ok || result.value === undefined || result.value === 'keep') throw new Error('expected an import');
    expect(JSON.parse(result.value.snapshot)).toMatchObject({ matchId: 9023462170, radiantScore: 42 });
  });

  it('refuses numbers that do not match the Dota match (the detail would contradict the score)', async () => {
    const result = await prepareGameImport(source(), teamsOf(), imported({ t1Kills: '50' }), { dotaMatchId: '9023462170', winner: '1', keep: false });
    expect(result).toEqual({ ok: false, error: 'Los datos no coinciden con la partida de Dota: pulsa «Autocompletar» de nuevo o quita el Match ID.' });
    const wrongWinner = await prepareGameImport(source(), teamsOf(), imported({ winner: '2' }), { dotaMatchId: '9023462170', winner: '1', keep: false });
    expect(wrongWinner).toMatchObject({ ok: false });
  });

  it('needs who won, which must be one of the two teams', async () => {
    const message = 'Indica quién ganó la partida (pulsa «Buscar» y elige).';
    expect(await prepareGameImport(source(), teamsOf(), imported(), { dotaMatchId: '9023462170', winner: '', keep: false })).toEqual({ ok: false, error: message });
    expect(await prepareGameImport(source(), teamsOf(), imported(), { dotaMatchId: '9023462170', winner: '9', keep: false })).toEqual({ ok: false, error: message });
  });

  it('the Radiant side is derived from who won: the winner was Radiant when Radiant won, the other team when Dire won', async () => {
    // Radiant won (the real match): choosing team 2 as the winner means team 2 was Radiant
    const asTeam2 = gameFromSnapshot(snapshot, 2, 1, 2);
    const raw2 = { winner: String(asTeam2.winnerId), t1Kills: String(asTeam2.team1Kills), t1Deaths: String(asTeam2.team1Deaths), t2Kills: String(asTeam2.team2Kills), t2Deaths: String(asTeam2.team2Deaths) };
    const radiantWon = await prepareGameImport(source(), teamsOf(), raw2, { dotaMatchId: '9023462170', winner: '2', keep: false });
    expect(radiantWon).toMatchObject({ ok: true, value: { radiantTeamId: 2 } });
    // Dire won: choosing team 1 as the winner means team 2 was Radiant
    const direWon: DotaMatchSource = { fetch: async () => ({ ...snapshot, radiantWin: false }) };
    const asTeam2Radiant = gameFromSnapshot({ ...snapshot, radiantWin: false }, 2, 1, 2);
    expect(asTeam2Radiant.winnerId).toBe(1);
    const raw1 = { winner: '1', t1Kills: String(asTeam2Radiant.team1Kills), t1Deaths: String(asTeam2Radiant.team1Deaths), t2Kills: String(asTeam2Radiant.team2Kills), t2Deaths: String(asTeam2Radiant.team2Deaths) };
    expect(await prepareGameImport(direWon, teamsOf(), raw1, { dotaMatchId: '9023462170', winner: '1', keep: false })).toMatchObject({ ok: true, value: { radiantTeamId: 2 } });
    expect(await prepareGameImport(direWon, teamsOf(), { ...raw1, winner: '2' }, { dotaMatchId: '9023462170', winner: '2', keep: false })).toMatchObject({ ok: false });
  });

  it('a bad id or a failed lookup is a readable error', async () => {
    expect(await prepareGameImport(source(), teamsOf(), imported(), { dotaMatchId: 'abc', winner: '1', keep: false })).toMatchObject({ ok: false });
    const notFound = new DotaLookupError('not_found', 'Partida no encontrada. Revisa el Match ID.');
    expect(await prepareGameImport(source(notFound), teamsOf(), imported(), { dotaMatchId: '9023462170', winner: '1', keep: false })).toEqual({
      ok: false,
      error: 'Partida no encontrada. Revisa el Match ID.',
    });
  });

  it('keep needs the normal result validation to pass first (a teamless match cannot import)', async () => {
    expect(await prepareGameImport(source(), [1, null], imported(), { dotaMatchId: '9023462170', winner: '1', keep: false })).toMatchObject({ ok: false });
  });
});
