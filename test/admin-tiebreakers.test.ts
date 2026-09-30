import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Tournament } from '../src/db/repository.js';
import { flashText, makeApp, type TestApp } from './helpers/app.js';

let t: TestApp;
let cookie: string;
let tournament: Tournament;
let url: string;
beforeEach(async () => {
  t = await makeApp();
  cookie = await t.login();
  tournament = t.repo.createTournament({ name: 'Torneo Oct', slug: 'torneo-oct' });
  url = `/admin/t/${tournament.id}/reglas`;
});
afterEach(() => t.db.close());

const base = { action: 'save', points_win: '1', points_loss: '0', group_legs: '1', tiebreakers: 'kd,kills', rules_text: '' };
const saved = () => t.repo.getTournamentById(tournament.id)!.tiebreakers;
const page = async () => (await t.get(url, cookie)).text();
const tbList = (html: string) => html.slice(html.indexOf('<ol class="tb-list">'), html.indexOf('</ol>', html.indexOf('<ol class="tb-list">')));

describe('storing the criteria', () => {
  it('accepts head-to-head as a known criterion and keeps the order', () => {
    t.repo.updateTournament(tournament.id, { tiebreakers: ['kd', 'h2h', 'kills'] });
    expect(saved()).toEqual(['kd', 'h2h', 'kills']);
  });

  it('keeps an empty list empty (it does not fall back to the default)', () => {
    t.repo.updateTournament(tournament.id, { tiebreakers: [] });
    expect(saved()).toEqual([]);
    expect(t.repo.getTournamentBySlug('torneo-oct')!.tiebreakers).toEqual([]);
  });

  it('leaves existing tournaments with their stored values', () => {
    t.db.prepare("UPDATE tournaments SET tiebreakers = 'kills,kd' WHERE id = ?").run(tournament.id);
    expect(saved()).toEqual(['kills', 'kd']);
  });
});

describe('the Desempate editor', () => {
  it('lists the configured criteria in order with their labels', async () => {
    t.repo.updateTournament(tournament.id, { tiebreakers: ['kd', 'h2h'] });
    const list = tbList(await page());
    expect(list.indexOf('Diferencia K − D')).toBeGreaterThan(-1);
    expect(list.indexOf('Resultado directo')).toBeGreaterThan(list.indexOf('Diferencia K − D'));
    expect(list).not.toContain('Más kills');
  });

  it('no longer promises a tiebreak match; explains what happens instead', async () => {
    const html = await page();
    expect(html).not.toContain('Si siguen empatados: partida de desempate');
    expect(html).toContain('Si siguen empatados, el torneo queda con empate sin resolver y los cruces de semifinales se eligen a mano.');
  });

  it('offers a remove button per criterion', async () => {
    const list = tbList(await page());
    expect(list).toContain('aria-label="Quitar Diferencia K − D"');
    expect(list).toContain('aria-label="Quitar Más kills"');
    expect(list).toMatch(/name="action"\s+value="remove:kd"/);
  });

  it('offers only the criteria not in use in the "add" select, and hides it when none is left', async () => {
    let html = await page(); // kd, kills in use
    expect(html).toMatch(/<select[^>]*name="new_tiebreaker"[\s\S]*?<option value="h2h"[\s\S]*?<option value="extra"/);
    expect(html.match(/<option value="(kd|kills)">/g) ?? []).toHaveLength(0);
    t.repo.updateTournament(tournament.id, { tiebreakers: ['kd', 'kills', 'h2h', 'extra'] });
    html = await page();
    expect(html).not.toContain('name="new_tiebreaker"');
    expect(html).not.toContain('value="add"');
  });

  it('shows the note and an add control when the list is empty', async () => {
    t.repo.updateTournament(tournament.id, { tiebreakers: [] });
    const html = await page();
    expect(html).not.toContain('<ol class="tb-list">');
    expect(html).toContain('Sin criterios');
    expect(html).toContain('empate sin resolver');
    expect(html.match(/<option value="(kd|kills|h2h|extra)">/g)).toHaveLength(4);
  });

  it('uses the same control heights and styles as the rest of the admin', async () => {
    const list = tbList(await page());
    expect(list).toContain('class="btn sm');
  });
});

describe('editing and saving', () => {
  it('removes a criterion', async () => {
    await t.post(url, { ...base, action: 'remove:kd' }, cookie);
    expect(saved()).toEqual(['kills']);
  });

  it('allows removing every criterion', async () => {
    await t.post(url, { ...base, action: 'remove:kd' }, cookie);
    await t.post(url, { ...base, tiebreakers: 'kills', action: 'remove:kills' }, cookie);
    expect(saved()).toEqual([]);
    // ...and saving with an empty list is valid, not an error.
    const res = await t.post(url, { ...base, tiebreakers: '' }, cookie);
    expect(await flashText(t, res, cookie)).toContain('Reglas guardadas');
    expect(saved()).toEqual([]);
  });

  it('adds a criterion at the end', async () => {
    await t.post(url, { ...base, action: 'add', new_tiebreaker: 'h2h' }, cookie);
    expect(saved()).toEqual(['kd', 'kills', 'h2h']);
    await t.post(url, { ...base, tiebreakers: '', action: 'add', new_tiebreaker: 'h2h' }, cookie);
    expect(saved()).toEqual(['h2h']);
  });

  it('refuses to add something unknown, already used, or nothing at all', async () => {
    for (const choice of ['evil', 'kd', '']) {
      const res = await t.post(url, { ...base, action: 'add', new_tiebreaker: choice }, cookie);
      expect(await flashText(t, res, cookie)).toContain('criterio');
    }
    expect(saved()).toEqual(['kd', 'kills']);
  });

  it('reorders all three, including from the ends', async () => {
    t.repo.updateTournament(tournament.id, { tiebreakers: ['kd', 'kills', 'h2h'] });
    await t.post(url, { ...base, tiebreakers: 'kd,kills,h2h', action: 'up:h2h' }, cookie);
    expect(saved()).toEqual(['kd', 'h2h', 'kills']);
    await t.post(url, { ...base, tiebreakers: 'kd,h2h,kills', action: 'up:h2h' }, cookie);
    expect(saved()).toEqual(['h2h', 'kd', 'kills']);
    await t.post(url, { ...base, tiebreakers: 'h2h,kd,kills', action: 'up:h2h' }, cookie);
    expect(saved()).toEqual(['h2h', 'kd', 'kills']);
  });

  it('rejects duplicated or unknown submitted orders and saves nothing', async () => {
    for (const bad of ['kd,kd', 'kd,evil', 'h2h,h2h,kd']) {
      const res = await t.post(url, { ...base, tiebreakers: bad }, cookie);
      expect(await flashText(t, res, cookie)).toContain('desempate');
    }
    expect(saved()).toEqual(['kd', 'kills']);
  });

  it('tells the public page to refresh', async () => {
    let changes = 0;
    t.events.onTournamentChanged(tournament.id, () => changes++);
    await t.post(url, { ...base, action: 'remove:kills' }, cookie);
    expect(changes).toBe(1);
  });
});

describe('the standings follow the saved criteria', () => {
  it('puts the direct-match winner first once head-to-head is configured', async () => {
    const [a, b, c] = ['A', 'B', 'C'].map((code) => t.repo.createTeam(tournament.id, { code, name: `Equipo ${code}` }));
    const mk = (n: number, x: number, y: number) => t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: n, matchNumber: n, team1Id: x, team2Id: y });
    const m1 = mk(1, b!.id, a!.id); // B beats A narrowly
    const m2 = mk(2, a!.id, c!.id); // A crushes C
    t.repo.recordResult(m1.id, { winnerId: b!.id, team1Kills: 10, team1Deaths: 8, team2Kills: 8, team2Deaths: 10 });
    t.repo.recordResult(m2.id, { winnerId: a!.id, team1Kills: 30, team1Deaths: 1, team2Kills: 1, team2Deaths: 30 });
    t.repo.setActiveTournament(tournament.id);
    const order = async () => {
      const html = await (await t.get('/')).text();
      const std = html.slice(html.indexOf('<tbody>', html.indexOf('id="p-posiciones"')));
      return [...std.matchAll(/<strong title="Equipo [ABC]">Equipo ([ABC])<\/strong>/g)].map((m) => m[1]).join('');
    };
    t.repo.updateTournament(tournament.id, { tiebreakers: ['kd', 'h2h'] });
    expect((await order()).slice(0, 2)).toBe('AB');
    t.repo.updateTournament(tournament.id, { tiebreakers: ['h2h', 'kd'] });
    expect((await order()).slice(0, 2)).toBe('BA');
  });
});
