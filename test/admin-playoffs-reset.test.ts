import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Team, Tournament } from '../src/db/repository.js';
import { regenerateFixture } from '../src/services/fixture.js';
import { loadState } from '../src/services/state.js';
import { flashText, makeApp, type TestApp } from './helpers/app.js';

let t: TestApp;
let cookie: string;
let tournament: Tournament;
let base: string;
let teams: Team[];

beforeEach(async () => {
  t = await makeApp();
  cookie = await t.login();
  tournament = t.repo.createTournament({ name: 'Torneo Oct', slug: 'torneo-oct' });
  // These tests are about the bracket, not about series: playoffs are single games here.
  tournament = t.repo.updateTournament(tournament.id, { semifinalGames: 1, finalGames: 1 });
  t.repo.setActiveTournament(tournament.id);
  base = `/admin/t/${tournament.id}/playoffs`;
  teams = ['Alpha', 'Bravo', 'Corsarios', 'Delta', 'Eclipse'].map((name, i) => t.repo.createTeam(tournament.id, { code: String.fromCharCode(65 + i), name }));
  t.repo.replaceScheduleDays(tournament.id, [
    { date: '2026-10-03', phase: 'group', startTimes: ['14:00', '15:00', '16:00', '17:00', '18:00'], slotMinutes: 60 },
    { date: '2026-10-11', phase: 'semifinal', startTimes: ['14:00', '15:00'], slotMinutes: 60 },
    { date: '2026-10-17', phase: 'final', startTimes: ['14:00'], slotMinutes: 60 },
  ]);
  regenerateFixture(t.repo, tournament);
});
afterEach(() => t.db.close());

const picks = (order: number[]) => ({ sf1_a: String(teams[order[0]!]!.id), sf1_b: String(teams[order[1]!]!.id), sf2_a: String(teams[order[2]!]!.id), sf2_b: String(teams[order[3]!]!.id) });
const EMPTY = { sf1_a: '', sf1_b: '', sf2_a: '', sf2_b: '' };
const playoffMatches = () => t.repo.listMatches(tournament.id).filter((m) => m.phase !== 'group');
const playGroup = () => {
  for (const m of t.repo.listMatches(tournament.id, 'group')) {
    const first = teams.findIndex((x) => x.id === m.team1Id) < teams.findIndex((x) => x.id === m.team2Id);
    t.repo.recordResult(m.id, { winnerId: first ? m.team1Id! : m.team2Id!, team1Kills: first ? 20 : 10, team1Deaths: first ? 10 : 20, team2Kills: first ? 10 : 20, team2Deaths: first ? 20 : 10 });
  }
};

describe('undoing manual semifinal picks', () => {
  it('shows "Quitar cruces manuales" only while semifinal teams are stored', async () => {
    let html = await (await t.get(base, cookie)).text();
    expect(html).not.toContain('Quitar cruces manuales');
    await t.post(`${base}/cruces`, picks([0, 1, 2, 3]), cookie);
    html = await (await t.get(base, cookie)).text();
    expect(html).toContain('Quitar cruces manuales');
    expect(html).toContain('id="resetCrossesDialog"');
  });

  it('asks for confirmation in the themed dialog, with the right text', async () => {
    await t.post(`${base}/cruces`, picks([0, 1, 2, 3]), cookie);
    const html = await (await t.get(base, cookie)).text();
    expect(html).toMatch(/<button class="btn danger" type="submit" name="action" value="reset" data-confirm-open="resetCrossesDialog">/);
    expect(html).toContain('Los cruces volverán a calcularse automáticamente desde la tabla.');
    expect(html).not.toContain('Se borrarán los resultados de semifinales y final.');
  });

  it('warns that results will be deleted when there are playoff results', async () => {
    playGroup();
    await t.post(`${base}/cruces`, picks([0, 1, 2, 3]), cookie);
    await t.post(`${base}/semifinal/1`, { action: 'save', winner: String(teams[0]!.id), t1_kills: '10', t1_deaths: '5', t2_kills: '5', t2_deaths: '10' }, cookie);
    const html = await (await t.get(base, cookie)).text();
    expect(html).toContain('Se borrarán los resultados de semifinales y final.');
  });

  it('resets with the button (action=reset)', async () => {
    await t.post(`${base}/cruces`, picks([3, 0, 1, 2]), cookie);
    expect(playoffMatches().length).toBeGreaterThan(0);
    const res = await t.post(`${base}/cruces`, { ...EMPTY, action: 'reset' }, cookie);
    expect(res.status).toBe(303);
    expect(await flashText(t, res, cookie)).toContain('Cruces manuales quitados');
    expect(playoffMatches()).toHaveLength(0);
  });

  it('resets when the manual form is submitted with all four selects empty', async () => {
    await t.post(`${base}/cruces`, picks([3, 0, 1, 2]), cookie);
    const res = await t.post(`${base}/cruces`, EMPTY, cookie);
    expect(await flashText(t, res, cookie)).toContain('Cruces manuales quitados');
    expect(playoffMatches()).toHaveLength(0);
  });

  it('an all-empty submit does NOT delete playoff results: only the confirmed button does', async () => {
    playGroup();
    await t.post(`${base}/cruces`, picks([0, 1, 2, 3]), cookie);
    await t.post(`${base}/semifinal/1`, { action: 'save', winner: String(teams[0]!.id), t1_kills: '10', t1_deaths: '5', t2_kills: '5', t2_deaths: '10' }, cookie);
    let changes = 0;
    t.events.onTournamentChanged(tournament.id, () => changes++);
    const res = await t.post(`${base}/cruces`, EMPTY, cookie);
    expect(res.status).toBe(303);
    expect(await flashText(t, res, cookie)).toContain('Hay resultados de playoffs cargados: usa «Quitar cruces manuales» para confirmar el borrado.');
    expect(playoffMatches().length).toBeGreaterThan(0);
    expect(t.repo.listMatches(tournament.id, 'semifinal')[0]!.winnerId).toBe(teams[0]!.id);
    expect(changes).toBe(0);
    // The button (with its confirm dialog) is still the way to do it.
    await t.post(`${base}/cruces`, { ...EMPTY, action: 'reset' }, cookie);
    expect(playoffMatches()).toHaveLength(0);
  });

  it('an all-empty submit still resets when there are manual picks but no results', async () => {
    playGroup();
    await t.post(`${base}/cruces`, picks([0, 1, 2, 3]), cookie);
    await t.post(`${base}/cruces`, EMPTY, cookie);
    expect(playoffMatches()).toHaveLength(0);
  });

  it('an all-empty submit with nothing stored is harmless', async () => {
    const res = await t.post(`${base}/cruces`, EMPTY, cookie);
    expect(res.status).toBe(303);
    expect(playoffMatches()).toHaveLength(0);
  });

  it('keeps the error for a partial selection, reworded', async () => {
    await t.post(`${base}/cruces`, picks([0, 1, 2, 3]), cookie);
    for (const partial of [{ ...EMPTY, sf1_a: String(teams[0]!.id) }, { ...picks([0, 1, 2, 3]), sf2_b: '' }, { ...EMPTY, sf1_a: String(teams[0]!.id), sf1_b: String(teams[1]!.id), sf2_a: String(teams[2]!.id) }]) {
      const res = await t.post(`${base}/cruces`, partial, cookie);
      expect(await flashText(t, res, cookie)).toContain('Elige los cuatro equipos o deja los cuatro vacíos para volver al cálculo automático.');
    }
    // A failed partial submit changes nothing.
    expect(t.repo.listMatches(tournament.id, 'semifinal')[0]).toMatchObject({ team1Id: teams[0]!.id, team2Id: teams[1]!.id });
  });

  it('clears semifinal and final results too, and tells the public page', async () => {
    playGroup();
    await t.post(`${base}/cruces`, picks([0, 1, 2, 3]), cookie);
    await t.post(`${base}/semifinal/1`, { action: 'save', winner: String(teams[0]!.id), t1_kills: '10', t1_deaths: '5', t2_kills: '5', t2_deaths: '10' }, cookie);
    await t.post(`${base}/semifinal/2`, { action: 'save', winner: String(teams[2]!.id), t1_kills: '10', t1_deaths: '5', t2_kills: '5', t2_deaths: '10' }, cookie);
    await t.post(`${base}/final/1`, { action: 'save', winner: String(teams[0]!.id), t1_kills: '10', t1_deaths: '5', t2_kills: '5', t2_deaths: '10' }, cookie);
    expect(loadState(t.repo, t.repo.getTournamentById(tournament.id)!).bracket.championId).toBe(teams[0]!.id);
    let changes = 0;
    t.events.onTournamentChanged(tournament.id, () => changes++);
    await t.post(`${base}/cruces`, { ...EMPTY, action: 'reset' }, cookie);
    expect(playoffMatches()).toHaveLength(0);
    expect(loadState(t.repo, t.repo.getTournamentById(tournament.id)!).bracket.championId).toBeNull();
    expect(changes).toBe(1);
  });

  it('leaves the bracket TBD while the group stage is open, and seeds automatically once it ends', async () => {
    await t.post(`${base}/cruces`, picks([3, 0, 1, 2]), cookie);
    await t.post(`${base}/cruces`, { ...EMPTY, action: 'reset' }, cookie);
    let bracket = loadState(t.repo, t.repo.getTournamentById(tournament.id)!).bracket;
    expect(bracket.semifinals.map((s) => [s.team1Id, s.team2Id])).toEqual([[null, null], [null, null]]);
    playGroup();
    bracket = loadState(t.repo, t.repo.getTournamentById(tournament.id)!).bracket;
    // Automatic seeding: 1st v 4th, 2nd v 3rd (A > B > C > D > E).
    expect(bracket.semifinals.map((s) => [s.team1Id, s.team2Id])).toEqual([[teams[0]!.id, teams[3]!.id], [teams[1]!.id, teams[2]!.id]]);
    // ...and the public page shows it.
    const html = await (await t.get('/')).text();
    expect(html).toContain('Cruces confirmados');
  });

  it('can pick manual teams again after a reset', async () => {
    await t.post(`${base}/cruces`, picks([0, 1, 2, 3]), cookie);
    await t.post(`${base}/cruces`, { ...EMPTY, action: 'reset' }, cookie);
    await t.post(`${base}/cruces`, picks([3, 2, 1, 0]), cookie);
    expect(t.repo.listMatches(tournament.id, 'semifinal')[0]).toMatchObject({ team1Id: teams[3]!.id, team2Id: teams[2]!.id });
  });

  it('needs a login and a same-origin request', async () => {
    expect((await t.post(`${base}/cruces`, { ...EMPTY, action: 'reset' })).headers.get('location')).toBe('/admin/login');
    const res = await t.send('POST', `${base}/cruces`, { form: { ...EMPTY, action: 'reset' }, cookie, headers: { origin: 'http://evil.example' } });
    expect(res.status).toBe(403);
  });
});

describe('the per-card "Limpiar" button', () => {
  it('is now "Deshacer cambios" on result cards, and "Borrar resultado" stays for saved results', async () => {
    // Unplayed group matches: their cards offer to undo unsaved edits.
    const results = await (await t.get(`/admin/t/${tournament.id}/resultados?fecha=todos`, cookie)).text();
    expect(results).not.toContain('Limpiar');
    expect(results).toContain('Deshacer cambios');
    // Playoff cards behave the same, and a saved one shows "Borrar resultado".
    playGroup();
    await t.post(`${base}/cruces`, picks([0, 1, 2, 3]), cookie);
    let html = await (await t.get(base, cookie)).text();
    expect(html).not.toContain('Limpiar');
    expect(html).toContain('Deshacer cambios');
    await t.post(`${base}/semifinal/1`, { action: 'save', winner: String(teams[0]!.id), t1_kills: '10', t1_deaths: '5', t2_kills: '5', t2_deaths: '10' }, cookie);
    html = await (await t.get(base, cookie)).text();
    expect(html).toContain('Borrar resultado');
  });
});
