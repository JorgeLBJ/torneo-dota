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
  url = `/admin/t/${tournament.id}/equipos`;
});
afterEach(() => t.db.close());

describe('teams screen', () => {
  it('lists teams with their hero portrait and name', async () => {
    t.repo.createTeam(tournament.id, { code: 'A', name: 'Alpha', captain: 'Kelvin', hero: 'axe' });
    t.repo.createTeam(tournament.id, { code: 'B', name: 'Bravos' });
    const html = await (await t.get(url, cookie)).text();
    expect(html).toContain('Equipos');
    expect(html).toContain('value="Alpha"');
    expect(html).toContain('value="Kelvin"');
    expect(html).toContain('/assets/heroes/axe.png');
    expect(html).toContain('Axe');
    expect(html).toContain('Sin héroe');
    expect(html).toContain('Buscar héroe');
    expect(html).toContain('Fuerza');
  });

  it('exposes taken heroes to the picker as JSON', async () => {
    t.repo.createTeam(tournament.id, { code: 'A', name: 'Alpha', hero: 'axe' });
    const html = await (await t.get(url, cookie)).text();
    const json = /<script type="application\/json" id="heroes-data">(.*?)<\/script>/s.exec(html)?.[1];
    const data = JSON.parse(json!) as { heroes: unknown[]; taken: Record<string, string> };
    expect(data.heroes).toHaveLength(127);
    expect(data.taken).toEqual({ axe: 'A' });
  });

  it('adds a team with normalized code and hero', async () => {
    const res = await t.post(url, { code: ' ab ', name: 'Alpha Bravo', captain: 'Ann', hero: 'lina' }, cookie);
    expect(res.status).toBe(303);
    expect(t.repo.listTeams(tournament.id)).toMatchObject([
      { code: 'AB', name: 'Alpha Bravo', captain: 'Ann', hero: 'lina' },
    ]);
  });

  it('stores blank captain and hero as null', async () => {
    await t.post(url, { code: 'A', name: 'Alpha', captain: '', hero: '' }, cookie);
    expect(t.repo.listTeams(tournament.id)[0]).toMatchObject({ captain: null, hero: null });
  });

  it('validates new teams with Spanish messages', async () => {
    t.repo.createTeam(tournament.id, { code: 'A', name: 'Alpha', hero: 'axe' });
    const cases: [Record<string, string>, string][] = [
      [{ code: '', name: 'X' }, 'código'],
      [{ code: 'TOOLONG', name: 'X' }, 'código'],
      [{ code: 'x!', name: 'X' }, 'código'],
      [{ code: 'B', name: '' }, 'nombre'],
      [{ code: 'a', name: 'Dup' }, 'Ya existe'],
      [{ code: 'B', name: 'X', hero: 'not_a_hero' }, 'héroe'],
      [{ code: 'B', name: 'X', hero: 'axe' }, 'ya lo usa'],
      [{ code: 'B', name: 'x'.repeat(41) }, 'nombre'],
    ];
    for (const [form, message] of cases) {
      const res = await t.post(url, form, cookie);
      expect(res.status).toBe(303);
      expect(await flashText(t, res, cookie)).toContain(message);
    }
    expect(t.repo.listTeams(tournament.id)).toHaveLength(1);
  });

  it('updates a team and lets it keep its own hero', async () => {
    const team = t.repo.createTeam(tournament.id, { code: 'A', name: 'Alpha', hero: 'axe' });
    const res = await t.post(`${url}/${team.id}`, { code: 'A', name: 'Alpha 2', captain: 'Z', hero: 'axe' }, cookie);
    expect(res.status).toBe(303);
    expect(t.repo.getTeam(team.id)).toMatchObject({ name: 'Alpha 2', captain: 'Z', hero: 'axe' });
  });

  it('rejects taking another team hero on update', async () => {
    t.repo.createTeam(tournament.id, { code: 'A', name: 'Alpha', hero: 'axe' });
    const b = t.repo.createTeam(tournament.id, { code: 'B', name: 'Bravo' });
    const res = await t.post(`${url}/${b.id}`, { code: 'B', name: 'Bravo', hero: 'axe' }, cookie);
    expect(await flashText(t, res, cookie)).toContain('ya lo usa el equipo A');
    expect(t.repo.getTeam(b.id)!.hero).toBeNull();
  });

  it('does not touch teams of another tournament', async () => {
    const other = t.repo.createTournament({ name: 'Otro', slug: 'otro' });
    const foreign = t.repo.createTeam(other.id, { code: 'A', name: 'Foreign' });
    expect((await t.post(`${url}/${foreign.id}`, { code: 'A', name: 'Hacked' }, cookie)).status).toBe(404);
    expect((await t.post(`${url}/${foreign.id}/eliminar`, {}, cookie)).status).toBe(404);
    expect(t.repo.getTeam(foreign.id)!.name).toBe('Foreign');
  });

  it('deletes a team without matches', async () => {
    const team = t.repo.createTeam(tournament.id, { code: 'A', name: 'Alpha' });
    const res = await t.post(`${url}/${team.id}/eliminar`, {}, cookie);
    expect(res.status).toBe(303);
    expect(t.repo.getTeam(team.id)).toBeUndefined();
  });

  it('shows a clear Spanish error instead of a 500 when the team has matches', async () => {
    const a = t.repo.createTeam(tournament.id, { code: 'A', name: 'Alpha' });
    const b = t.repo.createTeam(tournament.id, { code: 'B', name: 'Bravo' });
    t.repo.insertMatches([
      { tournamentId: tournament.id, phase: 'group', round: 1, matchNumber: 1, team1Id: a.id, team2Id: b.id },
    ]);
    const res = await t.post(`${url}/${a.id}/eliminar`, {}, cookie);
    expect(res.status).toBe(303);
    const text = await flashText(t, res, cookie);
    expect(text).toContain('No se puede eliminar');
    expect(text).toContain('partidos');
    expect(t.repo.getTeam(a.id)).toBeDefined();
  });

  it('emits a change event after writes', async () => {
    let fired = 0;
    t.events.onTournamentChanged(tournament.id, () => fired++);
    await t.post(url, { code: 'A', name: 'Alpha' }, cookie);
    expect(fired).toBe(1);
  });
});
