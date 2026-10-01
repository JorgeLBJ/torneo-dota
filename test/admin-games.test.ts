import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Match, Team, Tournament } from '../src/db/repository.js';
import { mapOpenDotaMatch } from '../src/dota/opendota.js';
import { DotaLookupError, type DotaMatchSource } from '../src/dota/source.js';
import { flashText, makeApp, type TestApp } from './helpers/app.js';

const snapshot = mapOpenDotaMatch(JSON.parse(readFileSync(new URL('./fixtures/opendota-9023462170.json', import.meta.url), 'utf8')));
const deaths = (side: 'radiant' | 'dire') => snapshot.players.filter((p) => p.side === side).reduce((n, p) => n + p.deaths, 0);

let t: TestApp;
let cookie: string;
let tournament: Tournament;
let a: Team;
let b: Team;
let asked: number[];
let failWith: DotaLookupError | null;
let direWins = false;

const source: DotaMatchSource = {
  fetch: async (id) => {
    asked.push(id);
    if (failWith) throw failWith;
    return { ...snapshot, matchId: id, radiantWin: !direWins };
  },
};

beforeEach(async () => {
  asked = [];
  failWith = null;
  direWins = false;
  t = await makeApp({ dotaSource: source });
  cookie = await t.login();
  tournament = t.repo.createTournament({ name: 'Copa', slug: 'copa' });
  t.repo.setActiveTournament(tournament.id);
  a = t.repo.createTeam(tournament.id, { code: 'AA', name: 'Alpha' });
  b = t.repo.createTeam(tournament.id, { code: 'BB', name: 'Bravo' });
});
afterEach(() => t.db.close());

const base = () => `/admin/t/${tournament.id}`;
const groupMatch = (): Match => t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: 1, matchNumber: 1, team1Id: a.id, team2Id: b.id });
const result = (winner: Team, stats = { t1_kills: '20', t1_deaths: '10', t2_kills: '10', t2_deaths: '20' }) => ({ winner: String(winner.id), ...stats });
const setFormat = (over: Record<string, number>) => t.repo.updateTournament(tournament.id, over);
const page = async (path = '/resultados?fecha=todos') => (await t.get(`${base()}${path}`, cookie)).text();
const postJson = async (path: string, form: Record<string, string>, headers: Record<string, string> = {}) =>
  t.send('POST', `${base()}${path}`, { form, cookie, headers: { accept: 'application/json', ...headers } });

describe('Reglas: partidas por partido', () => {
  const post = (form: Record<string, string>) =>
    t.post(`${base()}/reglas`, { points_win: '1', points_loss: '0', group_legs: '1', tiebreakers: 'kd,h2h', rules_html: '', ...form }, cookie);

  it('shows the three selects with the current values (1 / 3 / 5 by default)', async () => {
    const html = await (await t.get(`${base()}/reglas`, cookie)).text();
    expect(html).toContain('Partidas por partido');
    for (const name of ['group_games', 'semifinal_games', 'final_games']) expect(html).toContain(`name="${name}"`);
    expect(html).toMatch(/<option value="1" selected="">\s*Al mejor de 1/);
    expect(html).toMatch(/<option value="3" selected="">\s*Al mejor de 3/);
    expect(html).toMatch(/<option value="5" selected="">\s*Al mejor de 5/);
  });

  it('saves the lengths, and a form without them keeps the current ones', async () => {
    await post({ group_games: '3', semifinal_games: '5', final_games: '1' });
    expect(t.repo.getTournamentById(tournament.id)).toMatchObject({ groupGames: 3, semifinalGames: 5, finalGames: 1 });
    await post({});
    expect(t.repo.getTournamentById(tournament.id)).toMatchObject({ groupGames: 3, semifinalGames: 5, finalGames: 1 });
  });

  it('only 1, 3 or 5', async () => {
    const res = await post({ group_games: '2' });
    expect(await flashText(t, res, cookie)).toContain('Elige 1, 3 o 5 partidas por partido.');
    expect(t.repo.getTournamentById(tournament.id)!.groupGames).toBe(1);
  });

  it('cannot shrink a phase below the games already loaded in it', async () => {
    setFormat({ groupGames: 3 });
    const m = groupMatch();
    t.repo.saveGame(m.id, { gameNumber: 1, winnerId: a.id, team1Kills: 1, team1Deaths: 1, team2Kills: 1, team2Deaths: 1 });
    t.repo.saveGame(m.id, { gameNumber: 2, winnerId: b.id, team1Kills: 1, team1Deaths: 1, team2Kills: 1, team2Deaths: 1 });
    const res = await post({ group_games: '1' });
    expect(await flashText(t, res, cookie)).toContain('Hay juegos cargados hasta el juego 2 en la fase de grupos');
    expect(t.repo.getTournamentById(tournament.id)!.groupGames).toBe(3);
    expect((await post({ group_games: '5' })).status).toBe(303);
    expect(t.repo.getTournamentById(tournament.id)!.groupGames).toBe(5);
  });
});

describe('Resultados: games of a series', () => {
  it('best of 1 looks like it always did: one form, no game headings', async () => {
    groupMatch();
    const html = await page();
    expect(html.match(/data-game-form/g)).toHaveLength(1);
    expect(html).not.toContain('Juego 1');
    expect(html).not.toContain('class="series-line"');
    expect(html).toContain('Deshacer cambios');
  });

  it('best of 3: one form for the next game, the later ones waiting, and the series score on the card', async () => {
    setFormat({ groupGames: 3 });
    const m = groupMatch();
    let html = await page();
    expect(html).toContain('Al mejor de 3 · gana quien llegue a 2');
    expect(html.match(/data-game-form/g)).toHaveLength(1);
    expect(html).toContain('Carga primero el juego 2.');
    await t.post(`${base()}/resultados/${m.id}/juego/1`, { ...result(a), fecha: 'todos' }, cookie);
    html = await page();
    expect(html).toContain('Serie 1 – 0 · en juego');
    expect(html.match(/data-game-form/g)).toHaveLength(2);
    expect(html).toContain('Borrar juego');
  });

  it('after the deciding game the series says who won and the rest do not play', async () => {
    setFormat({ groupGames: 3 });
    const m = groupMatch();
    await t.post(`${base()}/resultados/${m.id}/juego/1`, result(a), cookie);
    await t.post(`${base()}/resultados/${m.id}/juego/2`, result(a), cookie);
    const html = await page();
    expect(html).toContain('Serie 2 – 0 · gana Alpha');
    expect(html).toContain('No se juega: la serie ya está decidida.');
    expect(t.repo.getMatch(m.id)).toMatchObject({ winnerId: a.id, team1Kills: 40 });
  });

  it('a game after the decider is refused with the reason', async () => {
    setFormat({ groupGames: 3 });
    const m = groupMatch();
    await t.post(`${base()}/resultados/${m.id}/juego/1`, result(a), cookie);
    await t.post(`${base()}/resultados/${m.id}/juego/2`, result(a), cookie);
    const res = await t.post(`${base()}/resultados/${m.id}/juego/3`, result(b), cookie);
    expect(await flashText(t, res, cookie)).toContain('La serie ya estaba decidida: el juego 3 sobra.');
    expect(t.repo.listGames(m.id)).toHaveLength(2);
  });

  it('games must be loaded in order, and game numbers are 1 to 5', async () => {
    setFormat({ groupGames: 3 });
    const m = groupMatch();
    expect(await flashText(t, await t.post(`${base()}/resultados/${m.id}/juego/2`, result(a), cookie), cookie)).toContain('Carga los juegos en orden: falta el juego 1.');
    expect(await flashText(t, await t.post(`${base()}/resultados/${m.id}/juego/9`, result(a), cookie), cookie)).toContain('Ese juego no existe.');
  });

  it('deleting a game un-decides the series; the last game goes first', async () => {
    setFormat({ groupGames: 3 });
    const m = groupMatch();
    await t.post(`${base()}/resultados/${m.id}/juego/1`, result(a), cookie);
    await t.post(`${base()}/resultados/${m.id}/juego/2`, result(a), cookie);
    const first = await t.post(`${base()}/resultados/${m.id}/juego/1`, { action: 'clear' }, cookie);
    expect(await flashText(t, first, cookie)).toContain('Borra primero los juegos siguientes.');
    await t.post(`${base()}/resultados/${m.id}/juego/2`, { action: 'clear' }, cookie);
    expect(t.repo.getMatch(m.id)!.winnerId).toBeNull();
  });

  it('the old URL without a game still saves and clears game 1', async () => {
    const m = groupMatch();
    await t.post(`${base()}/resultados/${m.id}`, result(b), cookie);
    expect(t.repo.getMatch(m.id)).toMatchObject({ winnerId: b.id });
    const cleared = await t.post(`${base()}/resultados/${m.id}`, { action: 'clear' }, cookie);
    expect(await flashText(t, cleared, cookie)).toContain('Resultado borrado.');
    expect(t.repo.getMatch(m.id)!.winnerId).toBeNull();
  });

  it('the table counts the series winner and the summed kills and deaths', async () => {
    setFormat({ groupGames: 3 });
    const m = groupMatch();
    await t.post(`${base()}/resultados/${m.id}/juego/1`, result(a, { t1_kills: '30', t1_deaths: '10', t2_kills: '10', t2_deaths: '30' }), cookie);
    await t.post(`${base()}/resultados/${m.id}/juego/2`, result(b, { t1_kills: '5', t1_deaths: '20', t2_kills: '20', t2_deaths: '5' }), cookie);
    await t.post(`${base()}/resultados/${m.id}/juego/3`, result(a, { t1_kills: '25', t1_deaths: '5', t2_kills: '5', t2_deaths: '25' }), cookie);
    const row = t.repo.getMatch(m.id)!;
    expect([row.winnerId, row.team1Kills, row.team1Deaths, row.team2Kills, row.team2Deaths]).toEqual([a.id, 60, 35, 35, 60]);
  });
});

describe('Dota lookups for the forms', () => {
  it('buscar answers the summary of the found match', async () => {
    const res = await postJson('/dota/buscar', { dota_match_id: '9023462170' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      summary: 'Partida encontrada · 66:06 · 42 – 41',
      matchId: 9023462170,
      radiantWin: true,
      radiantScore: 42,
      direScore: 41,
      durationSec: 3966,
    });
    expect(asked).toEqual([9023462170]);
  });

  it('a bad id is refused before asking the provider; a failed lookup is a readable 400', async () => {
    const bad = await postJson('/dota/buscar', { dota_match_id: 'x1' });
    expect(bad.status).toBe(400);
    expect(asked).toEqual([]);
    failWith = new DotaLookupError('not_found', 'Partida no encontrada. Revisa el Match ID.');
    const missing = await postJson('/dota/buscar', { dota_match_id: '123' });
    expect(await missing.json()).toEqual({ error: 'Partida no encontrada. Revisa el Match ID.' });
  });

  it('needs a login and a same-origin request, and is limited per admin', async () => {
    const anon = await t.send('POST', `${base()}/dota/buscar`, { form: { dota_match_id: '1' }, headers: { accept: 'application/json' } });
    expect(anon.status).toBe(303);
    const foreign = await postJson('/dota/buscar', { dota_match_id: '1' }, { origin: 'http://evil.example' });
    expect(foreign.status).toBe(403);
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await postJson('/dota/buscar', { dota_match_id: '1' })).status;
    expect(last).toBe(429);
  });

  it('autocompletar computes kills and deaths from who won the Dota match', async () => {
    const res = await postJson('/dota/autocompletar', { dota_match_id: '9023462170', winner: String(b.id), team1_id: String(a.id), team2_id: String(b.id) });
    expect(await res.json()).toEqual({
      ok: true,
      summary: 'Partida encontrada · 66:06 · 42 – 41',
      winnerId: b.id,
      team1Kills: 41,
      team1Deaths: deaths('dire'),
      team2Kills: 42,
      team2Deaths: deaths('radiant'),
    });
  });

  it('autocompletar when Dire won: the winner is the Dire side and the other team was Radiant', async () => {
    direWins = true;
    const res = await postJson('/dota/autocompletar', { dota_match_id: '9023462170', winner: String(a.id), team1_id: String(a.id), team2_id: String(b.id) });
    expect(await res.json()).toEqual({
      ok: true,
      summary: 'Partida encontrada · 66:06 · 41 – 42',
      winnerId: a.id,
      team1Kills: 41,
      team1Deaths: deaths('dire'),
      team2Kills: 42,
      team2Deaths: deaths('radiant'),
    });
  });

  it('autocompletar refuses teams of another tournament or a winner that is neither team', async () => {
    const other = t.repo.createTournament({ name: 'Otra', slug: 'otra' });
    const foreign = t.repo.createTeam(other.id, { code: 'ZZ', name: 'Foreign' });
    const teams = { team1_id: String(a.id), team2_id: String(foreign.id) };
    expect((await postJson('/dota/autocompletar', { dota_match_id: '1', winner: String(a.id), ...teams })).status).toBe(400);
    const res = await postJson('/dota/autocompletar', { dota_match_id: '1', winner: '999999', team1_id: String(a.id), team2_id: String(b.id) });
    expect(res.status).toBe(400);
    expect(asked).toEqual([]);
  });
});

describe('saving a game with its Dota import', () => {
  const importForm = (over: Record<string, string> = {}) => ({
    winner: String(a.id),
    t1_kills: '42',
    t1_deaths: String(deaths('radiant')),
    t2_kills: '41',
    t2_deaths: String(deaths('dire')),
    dota_match_id: '9023462170',
    dota_winner: String(a.id),
    ...over,
  });

  it('stores the compact snapshot, the radiant side and the Match ID with the game', async () => {
    const m = groupMatch();
    await t.post(`${base()}/resultados/${m.id}/juego/1`, importForm(), cookie);
    const game = t.repo.listGames(m.id)[0]!;
    expect(game).toMatchObject({ dotaMatchId: 9023462170, radiantTeamId: a.id, winnerId: a.id });
    expect(JSON.parse(game.dotaSnapshot!)).toMatchObject({ matchId: 9023462170, radiantScore: 42, direScore: 41 });
    expect(game.importedAt).not.toBeNull();
  });

  it('when Dire won, the team chosen as the winner was Dire: the other one is stored as Radiant', async () => {
    direWins = true;
    const m = groupMatch();
    // team A won as Dire: A scored the Dire 41 and died as often as the Dire players did
    const form = importForm({ t1_kills: '41', t1_deaths: String(deaths('dire')), t2_kills: '42', t2_deaths: String(deaths('radiant')) });
    await t.post(`${base()}/resultados/${m.id}/juego/1`, form, cookie);
    expect(t.repo.listGames(m.id)[0]).toMatchObject({ winnerId: a.id, radiantTeamId: b.id, dotaMatchId: 9023462170 });
  });

  it('numbers that differ from the Dota match are refused, nothing is saved', async () => {
    const m = groupMatch();
    const res = await t.post(`${base()}/resultados/${m.id}/juego/1`, importForm({ t1_kills: '99' }), cookie);
    expect(await flashText(t, res, cookie)).toContain('Los datos no coinciden con la partida de Dota');
    expect(t.repo.listGames(m.id)).toEqual([]);
  });

  it('a Match ID without saying who won is refused', async () => {
    const m = groupMatch();
    const res = await t.post(`${base()}/resultados/${m.id}/juego/1`, importForm({ dota_winner: '' }), cookie);
    expect(await flashText(t, res, cookie)).toContain('Indica quién ganó la partida (pulsa «Buscar» y elige).');
  });

  it('a lookup that fails at save time is reported and nothing is saved', async () => {
    const m = groupMatch();
    failWith = new DotaLookupError('unavailable', 'OpenDota no responde ahora. Inténtalo de nuevo en unos minutos o carga los datos a mano.');
    const res = await t.post(`${base()}/resultados/${m.id}/juego/1`, importForm(), cookie);
    expect(await flashText(t, res, cookie)).toContain('OpenDota no responde');
    expect(t.repo.listGames(m.id)).toEqual([]);
  });

  it('saving again with the Match ID untouched keeps the import without asking the provider', async () => {
    const m = groupMatch();
    await t.post(`${base()}/resultados/${m.id}/juego/1`, importForm(), cookie);
    asked.length = 0;
    await t.post(`${base()}/resultados/${m.id}/juego/1`, importForm({ dota_keep: '1' }), cookie);
    expect(asked).toEqual([]);
    expect(t.repo.listGames(m.id)[0]!.dotaSnapshot).not.toBeNull();
  });

  it('clearing the Match ID is the one way to drop an import (and it is explicit)', async () => {
    const m = groupMatch();
    await t.post(`${base()}/resultados/${m.id}/juego/1`, importForm(), cookie);
    await t.post(`${base()}/resultados/${m.id}/juego/1`, importForm({ dota_keep: '1', dota_match_id: '' }), cookie);
    expect(t.repo.listGames(m.id)[0]).toMatchObject({ dotaMatchId: null, dotaSnapshot: null });
  });

  it('changing the numbers of an imported game by hand is refused, not a silent drop of the import', async () => {
    const m = groupMatch();
    await t.post(`${base()}/resultados/${m.id}/juego/1`, importForm(), cookie);
    const res = await t.post(`${base()}/resultados/${m.id}/juego/1`, importForm({ dota_keep: '1', t1_kills: '43' }), cookie);
    expect(await flashText(t, res, cookie)).toContain('importado de Dota');
    expect(t.repo.listGames(m.id)[0]).toMatchObject({ dotaMatchId: 9023462170, team1Kills: 42 });
    expect(t.repo.listGames(m.id)[0]!.dotaSnapshot).not.toBeNull();
  });

  it('re-saving an untouched imported game keeps the whole import: snapshot, Match ID and Radiant side', async () => {
    const m = groupMatch();
    await t.post(`${base()}/resultados/${m.id}/juego/1`, importForm(), cookie);
    const before = t.repo.listGames(m.id)[0]!;
    asked.length = 0;
    // the form of an imported game posts its Match ID and the winner select as they were
    const res = await t.post(`${base()}/resultados/${m.id}/juego/1`, importForm({ dota_keep: '1' }), cookie);
    expect(res.status).toBe(303);
    const after = t.repo.listGames(m.id)[0]!;
    expect(after).toMatchObject({ dotaMatchId: 9023462170, radiantTeamId: a.id, dotaSnapshot: before.dotaSnapshot });
    expect(asked).toEqual([]);
  });

  it('the same holds for a game in a series', async () => {
    setFormat({ groupGames: 3 });
    const m = groupMatch();
    await t.post(`${base()}/resultados/${m.id}/juego/1`, result(a), cookie);
    await t.post(`${base()}/resultados/${m.id}/juego/2`, importForm({ winner: String(a.id) }), cookie);
    await t.post(`${base()}/resultados/${m.id}/juego/2`, importForm({ dota_keep: '1' }), cookie);
    expect(t.repo.listGames(m.id)[1]).toMatchObject({ dotaMatchId: 9023462170, radiantTeamId: a.id });
    expect(t.repo.listGames(m.id)[1]!.dotaSnapshot).not.toBeNull();
  });

  it('an untouched Match ID with a different winner is a re-import: it must match the new numbers', async () => {
    const m = groupMatch();
    await t.post(`${base()}/resultados/${m.id}/juego/1`, importForm(), cookie);
    // same numbers, but the admin now says team B won: the numbers no longer fit, so it is refused
    const refused = await t.post(`${base()}/resultados/${m.id}/juego/1`, importForm({ dota_keep: '1', dota_winner: String(b.id) }), cookie);
    expect(await flashText(t, refused, cookie)).toContain('Los datos no coinciden con la partida de Dota');
    expect(t.repo.listGames(m.id)[0]).toMatchObject({ radiantTeamId: a.id });
    // with the numbers autocompleted for B as the winner, the import is replaced
    const swapped = importForm({
      dota_keep: '1',
      dota_winner: String(b.id),
      winner: String(b.id),
      t1_kills: '41',
      t1_deaths: String(deaths('dire')),
      t2_kills: '42',
      t2_deaths: String(deaths('radiant')),
    });
    await t.post(`${base()}/resultados/${m.id}/juego/1`, swapped, cookie);
    expect(t.repo.listGames(m.id)[0]).toMatchObject({ radiantTeamId: b.id, winnerId: b.id, dotaMatchId: 9023462170 });
  });

  it('the form of an imported game shows the Match ID, the OpenDota link and keeps the import on save', async () => {
    const m = groupMatch();
    await t.post(`${base()}/resultados/${m.id}/juego/1`, importForm(), cookie);
    const html = await page();
    expect(html).toContain('value="9023462170"');
    expect(html).toContain('href="https://www.opendota.com/matches/9023462170"');
    expect(html).toContain('name="dota_keep"');
    expect(html).toContain('Importado de Dota');
  });
});

describe('Playoffs: series games', () => {
  it('a semifinal is best of 3 by default: the page shows its games and the winner advances after two', async () => {
    const c = t.repo.createTeam(tournament.id, { code: 'CC', name: 'Charlie' });
    const d = t.repo.createTeam(tournament.id, { code: 'DD', name: 'Delta' });
    await t.post(`${base()}/playoffs/cruces`, { sf1_a: String(a.id), sf1_b: String(d.id), sf2_a: String(b.id), sf2_b: String(c.id) }, cookie);
    let html = await (await t.get(`${base()}/playoffs`, cookie)).text();
    expect(html).toContain('Al mejor de 3 · gana quien llegue a 2');
    expect(html).toContain('Gran final');
    await t.post(`${base()}/playoffs/semifinal/1/juego/1`, result(a), cookie);
    html = await (await t.get(`${base()}/playoffs`, cookie)).text();
    expect(html).toContain('Serie 1 – 0 · en juego');
    await t.post(`${base()}/playoffs/semifinal/1/juego/2`, result(a), cookie);
    html = await (await t.get(`${base()}/playoffs`, cookie)).text();
    expect(html).toContain('Serie 2 – 0 · gana Alpha');
    const refused = await t.post(`${base()}/playoffs/semifinal/1/juego/3`, result(d), cookie);
    expect(await flashText(t, refused, cookie)).toContain('La serie ya estaba decidida: el juego 3 sobra.');
  });
});
