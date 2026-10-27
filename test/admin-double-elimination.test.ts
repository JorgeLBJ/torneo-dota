import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateObserverToken } from '../src/auth/observer-token.js';
import type { Team, Tournament } from '../src/db/repository.js';
import { DE_SLOTS, type DeSlotKey } from '../src/domain/double-elimination.js';
import { regenerateFixture } from '../src/services/fixture.js';
import { flashText, makeApp, type TestApp } from './helpers/app.js';

let t: TestApp;
let cookie: string;
let tournament: Tournament;
let league: Tournament;
let base: string;
let teams: Team[];
const NOW = new Date('2026-11-07T16:00:00Z');

beforeEach(async () => {
  t = await makeApp({ now: () => NOW });
  cookie = await t.login();
  tournament = t.repo.createTournament({ name: 'Relámpago', slug: 'relampago', format: 'double_elimination' });
  league = t.repo.createTournament({ name: 'Liga Oct', slug: 'liga-oct' });
  base = `/admin/t/${tournament.id}/playoffs`;
  teams = ['Alpha', 'Bravo', 'Corsarios', 'Delta', 'Eclipse', 'Fénix'].map((name, i) =>
    t.repo.createTeam(tournament.id, { code: String.fromCharCode(65 + i), name }),
  );
});
afterEach(() => t.db.close());

const id = (i: number) => teams[i]!.id;
const positionsForm = (order = [0, 1, 2, 3, 4, 5]) =>
  Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((p, i) => [`pos_${p}`, String(id(order[i]!))]));
const form = (winner: number) => ({ action: 'save', winner: String(winner), t1_kills: '15', t1_deaths: '8', t2_kills: '8', t2_deaths: '15' });
const stored = (key: DeSlotKey) => {
  const slot = DE_SLOTS.find((s) => s.key === key)!;
  return t.repo.listMatches(tournament.id, slot.phase).find((m) => m.matchNumber === slot.matchNumber);
};
const page = async (path = base) => (await t.get(path, cookie)).text();

describe('Llaves screen', () => {
  it('shows the positions form and the empty bracket with its placeholders', async () => {
    const html = await page();
    expect(html).toContain('<h1>Llaves</h1>');
    for (const p of ['A', 'B', 'C', 'D', 'E', 'F']) expect(html).toContain(`name="pos_${p.toLowerCase()}"`);
    expect(html).toContain('Bracket superior');
    expect(html).toContain('Bracket inferior');
    expect(html).toContain('S1 · Superior · Ronda 1');
    expect(html).toContain('S5 · Final superior');
    expect(html).toContain('I4 · Final inferior');
    expect(html).toContain('GF · Gran final');
    expect(html).toContain('Posición A');
    expect(html).toContain('Ganador S1');
    expect(html).toContain('Perdedor S4');
    expect(html).toContain('Al mejor de 3');
    expect(html).not.toContain('Semifinal 1');
    expect(html).not.toContain('Elegir equipos de las semifinales');
  });

  it('saves the six positions and shows the teams in their series', async () => {
    const res = await t.post(`${base}/posiciones`, positionsForm(), cookie);
    expect(res.status).toBe(303);
    expect(await flashText(t, res, cookie)).toContain('Posiciones guardadas');
    expect(stored('U1')).toMatchObject({ team1Id: id(0), team2Id: id(1) });
    expect(stored('U3')).toMatchObject({ team1Id: null, team2Id: id(4) });
    expect(stored('U4')).toMatchObject({ team1Id: id(5), team2Id: null });
    const html = await page();
    expect(html).toMatch(/<option value="\d+" selected="">A · Alpha<\/option>/);
    expect(html).toContain('action="/admin/t/' + tournament.id + '/playoffs/llave/U1/juego/1"');
  });

  it('validates the positions: six distinct teams of this tournament', async () => {
    const dup = await t.post(`${base}/posiciones`, positionsForm([0, 0, 2, 3, 4, 5]), cookie);
    expect(await flashText(t, dup, cookie)).toContain('distintos');
    const partial = await t.post(`${base}/posiciones`, { ...positionsForm(), pos_f: '' }, cookie);
    expect(await flashText(t, partial, cookie)).toContain('Elige los seis equipos');
    const stranger = t.repo.createTeam(league.id, { code: 'X', name: 'Extraño' });
    const foreign = await t.post(`${base}/posiciones`, { ...positionsForm(), pos_f: String(stranger.id) }, cookie);
    expect(await flashText(t, foreign, cookie)).toContain('equipos de este torneo');
    expect(t.repo.listMatches(tournament.id).every((m) => m.team1Id === null && m.team2Id === null)).toBe(true);
  });

  it('records results: the winner advances and the loser drops to the lower bracket', async () => {
    await t.post(`${base}/posiciones`, positionsForm(), cookie);
    let fired = 0;
    t.events.onTournamentChanged(tournament.id, () => fired++);
    const res = await t.post(`${base}/llave/U1/juego/1`, form(id(1)), cookie);
    expect(res.status).toBe(303);
    expect(await flashText(t, res, cookie)).toContain('Resultado guardado');
    expect(fired).toBe(1);
    expect(stored('U1')!.winnerId).toBe(id(1));
    const html = await page();
    // U3: Bravo vs Eclipse is playable now; L1 shows Alpha and waits for the loser of S4.
    expect(html).toContain(`action="/admin/t/${tournament.id}/playoffs/llave/U3/juego/1"`);
    expect(html).toContain('Perdedor S4');
    await t.post(`${base}/llave/U3/juego/1`, form(id(4)), cookie);
    expect(stored('U3')).toMatchObject({ team1Id: id(1), team2Id: id(4), winnerId: id(4) });
  });

  it('refuses a result before both teams are known', async () => {
    await t.post(`${base}/posiciones`, positionsForm(), cookie);
    const res = await t.post(`${base}/llave/U3/juego/1`, form(id(4)), cookie);
    expect(await flashText(t, res, cookie)).toContain('equipos');
    expect(t.repo.listTournamentGames(tournament.id)).toHaveLength(0);
  });

  it('changing an upper result clears the dependent lower and grand final series', async () => {
    await t.post(`${base}/posiciones`, positionsForm(), cookie);
    const play: [DeSlotKey, number][] = [['U1', 0], ['U2', 2], ['U3', 0], ['U4', 5], ['U5', 0], ['L1', 1], ['L2', 4], ['L3', 1], ['L4', 1]];
    for (const [key, i] of play) expect((await t.post(`${base}/llave/${key}/juego/1`, form(id(i)), cookie)).status).toBe(303);
    await t.post(`${base}/llave/GF/juego/1`, form(id(0)), cookie);
    expect(stored('GF')!.winnerId).toBeNull(); // best of 3: one win is not enough
    await t.post(`${base}/llave/GF/juego/2`, form(id(0)), cookie);
    expect(stored('GF')!.winnerId).toBe(id(0));
    expect(await page()).toContain('Alpha');
    // U1 is now Bravo's: everything downstream of it is cleared.
    await t.post(`${base}/llave/U1/juego/1`, form(id(1)), cookie);
    for (const key of ['U3', 'U5', 'L1', 'L2', 'L3', 'L4', 'GF'] as const) expect(stored(key)!.winnerId, key).toBeNull();
    expect(stored('U2')!.winnerId).toBe(id(2));
    expect(stored('U4')!.winnerId).toBe(id(5));
    const gfGames = t.repo.listGames(stored('GF')!.id);
    expect(gfGames).toHaveLength(0);
  });

  it('deletes the last game of a series and clears its dependents', async () => {
    await t.post(`${base}/posiciones`, positionsForm(), cookie);
    await t.post(`${base}/llave/U1/juego/1`, form(id(0)), cookie);
    await t.post(`${base}/llave/U3/juego/1`, form(id(0)), cookie);
    const res = await t.post(`${base}/llave/U1/juego/1`, { action: 'clear' }, cookie);
    expect(await flashText(t, res, cookie)).toContain('Resultado borrado');
    expect(stored('U1')!.winnerId).toBeNull();
    expect(stored('U3')).toMatchObject({ team1Id: null, winnerId: null });
  });

  it('marks a series live and moves it to the stream', async () => {
    await t.post(`${base}/posiciones`, positionsForm(), cookie);
    const res = await t.post(`${base}/llave/U2/juego/1/en-vivo`, { action: 'mark' }, cookie);
    expect(await flashText(t, res, cookie)).toContain('Partida marcada en vivo');
    expect(t.repo.listLive(tournament.id).map((m) => m.matchId)).toEqual([stored('U2')!.id]);
    await t.post(`${base}/llave/U2/juego/1/en-vivo`, { action: 'stream' }, cookie);
    expect(t.repo.getTournamentById(tournament.id)!.streamMatchId).toBe(stored('U2')!.id);
    expect(await page()).toContain('EN TRANSMISIÓN');
    await t.post(`${base}/llave/U2/juego/1/en-vivo`, { action: 'clear' }, cookie);
    expect(t.repo.listLive(tournament.id)).toHaveLength(0);
  });

  it('resets the bracket', async () => {
    await t.post(`${base}/posiciones`, positionsForm(), cookie);
    await t.post(`${base}/llave/U1/juego/1`, form(id(0)), cookie);
    const res = await t.post(`${base}/posiciones`, { action: 'reset' }, cookie);
    expect(await flashText(t, res, cookie)).toContain('Llaves reiniciadas');
    expect(t.repo.listMatches(tournament.id)).toHaveLength(0);
    expect(t.repo.listTournamentGames(tournament.id)).toHaveLength(0);
  });

  it('rejects unknown series', async () => {
    expect((await t.post(`${base}/llave/U9/juego/1`, form(id(0)), cookie)).status).toBe(404);
    expect((await t.post(`${base}/llave/U1/juego/9`, form(id(0)), cookie)).status).toBe(303);
  });
});

describe('format guards', () => {
  it('league playoff routes refuse a double-elimination tournament', async () => {
    expect((await t.post(`${base}/semifinal/1`, form(id(0)), cookie)).status).toBe(404);
    expect((await t.post(`${base}/final/1/juego/1/en-vivo`, { action: 'mark' }, cookie)).status).toBe(404);
    expect((await t.post(`${base}/cruces`, { sf1_a: String(id(0)), sf1_b: String(id(1)), sf2_a: String(id(2)), sf2_b: String(id(3)) }, cookie)).status).toBe(404);
    expect(t.repo.listMatches(tournament.id)).toHaveLength(0);
  });

  it('double-elimination routes refuse a league tournament, which keeps its playoffs page', async () => {
    const lbase = `/admin/t/${league.id}/playoffs`;
    const lteams = ['A', 'B', 'C', 'D', 'E', 'F'].map((code) => t.repo.createTeam(league.id, { code, name: `Liga ${code}` }));
    const lform = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((p, i) => [`pos_${p}`, String(lteams[i]!.id)]));
    expect((await t.post(`${lbase}/posiciones`, lform, cookie)).status).toBe(404);
    expect((await t.post(`${lbase}/llave/U1/juego/1`, form(lteams[0]!.id), cookie)).status).toBe(404);
    expect((await t.post(`${lbase}/llave/U1/juego/1/en-vivo`, { action: 'mark' }, cookie)).status).toBe(404);
    expect(t.repo.listMatches(league.id)).toHaveLength(0);
    const html = await page(lbase);
    expect(html).toContain('<h1>Playoffs</h1>');
    expect(html).toContain('Semifinal 1');
    expect(html).not.toContain('name="pos_a"');
  });
});

describe('sidebar', () => {
  it('a double-elimination tournament has Llaves and no Fixture or Resultados', async () => {
    const html = await page(`/admin/t/${tournament.id}/config`);
    expect(html).toContain(`href="/admin/t/${tournament.id}/playoffs"`);
    expect(html).toMatch(/playoffs"[^>]*>Llaves/);
    expect(html).not.toContain(`href="/admin/t/${tournament.id}/fixture"`);
    expect(html).not.toContain(`href="/admin/t/${tournament.id}/resultados"`);
  });

  it('a league tournament keeps Fixture, Resultados and Playoffs', async () => {
    const html = await page(`/admin/t/${league.id}/config`);
    expect(html).toContain(`href="/admin/t/${league.id}/fixture"`);
    expect(html).toContain(`href="/admin/t/${league.id}/resultados"`);
    expect(html).toMatch(/playoffs"[^>]*>Playoffs/);
  });
});

describe('Configuración', () => {
  it('shows the format read-only and offers only bracket phases in the calendar', async () => {
    const html = await page(`/admin/t/${tournament.id}/config`);
    expect(html).toContain('Doble eliminación');
    expect(html).toContain('Llaves superior e inferior desde el inicio');
    expect(html).not.toContain('name="format"');
    t.repo.replaceScheduleDays(tournament.id, [{ date: '2026-11-07', phase: 'semifinal', startTimes: ['11:00'], slotMinutes: 60 }]);
    const withDay = await page(`/admin/t/${tournament.id}/config`);
    expect(withDay).toContain('>Llaves</option>');
    expect(withDay).not.toContain('>Grupos</option>');
  });

  it('a league tournament shows its format and saves its calendar as before', async () => {
    const html = await page(`/admin/t/${league.id}/config`);
    expect(html).toContain('Liga + Playoffs');
    expect(html).toContain('Todos contra todos con tabla');
    const res = await t.post(
      `/admin/t/${league.id}/config`,
      { action: 'save', name: 'Liga Oct', slug: 'liga-oct', game: 'Dota 2', timezone: 'America/Lima', day_phase: 'group', day_date: '2026-10-03', day_times: '14:00, 15:00', day_minutes: '60' },
      cookie,
    );
    expect(await flashText(t, res, cookie)).toContain('Configuración guardada');
    expect(t.repo.listScheduleDays(league.id)).toEqual([{ date: '2026-10-03', phase: 'group', startTimes: ['14:00', '15:00'], slotMinutes: 60 }]);
    expect(await page(`/admin/t/${league.id}/config`)).toContain('>Grupos</option>');
  });
});

describe('Reglas', () => {
  it('double elimination hides the group-stage rules and names the bracket series lengths', async () => {
    const html = await page(`/admin/t/${tournament.id}/reglas`);
    expect(html).toContain('Partidas por serie (llaves)');
    expect(html).toContain('Partidas en la gran final');
    expect(html).not.toContain('Puntuación');
    expect(html).not.toContain('Desempate</h2>');
    expect(html).not.toContain('Fase de grupos');
    expect(html).not.toContain('name="group_games"');
    // The hidden group values ride along so saving keeps them.
    const res = await t.post(
      `/admin/t/${tournament.id}/reglas`,
      { action: 'save', points_win: '3', points_loss: '0', group_legs: '1', tiebreakers: 'kd,h2h', semifinal_games: '1', final_games: '5' },
      cookie,
    );
    expect(await flashText(t, res, cookie)).toContain('Reglas guardadas');
    expect(t.repo.getTournamentById(tournament.id)).toMatchObject({ semifinalGames: 1, finalGames: 5 });
  });

  it('double elimination names the series when a length cannot shrink', async () => {
    t.repo.updateTournament(tournament.id, { semifinalGames: 3 });
    tournament = t.repo.getTournamentById(tournament.id)!;
    await t.post(`${base}/posiciones`, positionsForm(), cookie);
    await t.post(`${base}/llave/U1/juego/1`, form(id(0)), cookie);
    await t.post(`${base}/llave/U1/juego/2`, form(id(0)), cookie);
    const res = await t.post(
      `/admin/t/${tournament.id}/reglas`,
      { action: 'save', points_win: '3', points_loss: '0', group_legs: '1', tiebreakers: '', semifinal_games: '1', final_games: '3' },
      cookie,
    );
    expect(await flashText(t, res, cookie)).toContain('en las llaves');
  });

  it('a league tournament keeps its scoring, tiebreakers and phase lengths', async () => {
    const html = await page(`/admin/t/${league.id}/reglas`);
    expect(html).toContain('Puntuación');
    expect(html).toContain('name="group_games"');
    expect(html).toContain('Semifinales');
    expect(html).not.toContain('Partidas por serie (llaves)');
  });
});

describe('Capturas GSI labels', () => {
  const SAMPLE = () => readFileSync(new URL('./fixtures/gsi-spectator-sample.json', import.meta.url), 'utf8');
  const capture = (dotaId: number) => {
    const gen = generateObserverToken();
    const observerId = t.repo.createObserverToken('Mati', gen.hash, gen.prefix).id;
    t.repo.upsertGsiCapture(dotaId, observerId, 'DOTA_GAMERULES_STATE_POST_GAME', true, SAMPLE());
  };

  it('names a double-elimination series by its bracket label', async () => {
    await t.post(`${base}/posiciones`, positionsForm(), cookie);
    const u1 = stored('U1')!;
    t.repo.saveGame(u1.id, { gameNumber: 1, winnerId: id(0), team1Kills: 1, team1Deaths: 1, team2Kills: 1, team2Deaths: 1, radiantTeamId: id(0), dotaMatchId: 555, dotaSnapshot: null });
    capture(555);
    const html = await page('/admin/capturas');
    expect(html).toContain('Superior · Ronda 1 · Alpha vs Bravo');
    expect(html).not.toContain('Semifinal 1');
  });

  it('a league semifinal keeps its label', async () => {
    const a = t.repo.createTeam(league.id, { code: 'A', name: 'Liga A' });
    const b = t.repo.createTeam(league.id, { code: 'B', name: 'Liga B' });
    const m = t.repo.createMatch({ tournamentId: league.id, phase: 'semifinal', round: 1, matchNumber: 1, team1Id: a.id, team2Id: b.id });
    t.repo.saveGame(m.id, { gameNumber: 1, winnerId: a.id, team1Kills: 1, team1Deaths: 1, team2Kills: 1, team2Deaths: 1, radiantTeamId: a.id, dotaMatchId: 556, dotaSnapshot: null });
    capture(556);
    expect(await page('/admin/capturas')).toContain('Semifinal 1 · Liga A vs Liga B');
  });
});

describe('league regression', () => {
  it('the league playoffs screen still renders from its fixture', async () => {
    const lteams = ['A', 'B', 'C', 'D', 'E'].map((code) => t.repo.createTeam(league.id, { code, name: `Liga ${code}` }));
    void lteams;
    regenerateFixture(t.repo, league);
    const html = await page(`/admin/t/${league.id}/playoffs`);
    expect(html).toContain('Fase de grupos: faltan');
  });
});

describe('league-only screens on a double elimination tournament', () => {
  it('lands the admin root and the Torneos "Abrir" link on Llaves', async () => {
    t.repo.setActiveTournament(tournament.id);
    const res = await t.get('/admin', cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/admin/t/${tournament.id}/playoffs`);
    const list = await page('/admin/torneos');
    expect(list).toContain(`href="/admin/t/${tournament.id}/playoffs"`);
    expect(list).toContain(`href="/admin/t/${league.id}/resultados"`);
  });

  it('keeps the league landing on Resultados', async () => {
    t.repo.setActiveTournament(league.id);
    const res = await t.get('/admin', cookie);
    expect(res.headers.get('location')).toBe(`/admin/t/${league.id}/resultados`);
  });

  it('redirects the Fixture and Resultados pages to Llaves', async () => {
    for (const path of ['fixture', 'resultados']) {
      const res = await t.get(`/admin/t/${tournament.id}/${path}`, cookie);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(base);
    }
  });

  it('refuses fixture and result commands without creating matches', async () => {
    const before = t.repo.listMatches(tournament.id).length;
    const regenerate = await t.post(`/admin/t/${tournament.id}/fixture/regenerar`, { confirm: 'on' }, cookie);
    expect(regenerate.status).toBe(404);
    const round = await t.post(`/admin/t/${tournament.id}/fixture/rondas`, {}, cookie);
    expect(round.status).toBe(404);
    expect(t.repo.listMatches(tournament.id)).toHaveLength(before);
    expect(t.repo.listMatches(tournament.id, 'group')).toHaveLength(0);
  });

  it('keeps Fixture and Resultados available for a league tournament', async () => {
    expect((await t.get(`/admin/t/${league.id}/fixture`, cookie)).status).toBe(200);
    expect((await t.get(`/admin/t/${league.id}/resultados`, cookie)).status).toBe(200);
  });
});
