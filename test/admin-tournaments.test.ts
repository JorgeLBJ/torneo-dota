import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FORMAT_INFO, TOURNAMENT_FORMATS } from '../src/domain/formats.js';
import { flashText, makeApp, type TestApp } from './helpers/app.js';

let t: TestApp;
let cookie: string;
beforeEach(async () => {
  t = await makeApp();
  cookie = await t.login();
});
afterEach(() => t.db.close());

describe('tournaments screen', () => {
  it('shows an empty state', async () => {
    const html = await (await t.get('/admin/torneos', cookie)).text();
    expect(html).toContain('Todavía no hay torneos');
  });

  it('creates a tournament and makes the first one active', async () => {
    const res = await t.post('/admin/torneos', { name: 'Torneo Oct', slug: 'torneo-oct' }, cookie);
    expect(res.status).toBe(303);
    const created = t.repo.getTournamentBySlug('torneo-oct')!;
    expect(res.headers.get('location')).toBe(`/admin/t/${created.id}/config`);
    expect(created.isActive).toBe(true);
    await t.post('/admin/torneos', { name: 'Copa', slug: 'copa' }, cookie);
    expect(t.repo.getTournamentBySlug('copa')!.isActive).toBe(false);
    expect(t.repo.getActiveTournament()!.slug).toBe('torneo-oct');
  });

  it('validates name and slug with Spanish messages', async () => {
    t.repo.createTournament({ name: 'Existing', slug: 'existing' });
    const cases: [Record<string, string>, string][] = [
      [{ name: '', slug: 'ok' }, 'nombre'],
      [{ name: 'X', slug: 'Bad Slug' }, 'URL pública'],
      [{ name: 'X', slug: '-bad-' }, 'URL pública'],
      [{ name: 'X', slug: 'existing' }, 'Ya existe'],
      [{ name: 'X', slug: 'admin' }, 'reservad'],
    ];
    for (const [form, message] of cases) {
      const res = await t.post('/admin/torneos', form, cookie);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/admin/torneos');
      expect(await flashText(t, res, cookie)).toContain(message);
    }
    expect(t.repo.listTournaments()).toHaveLength(1);
  });

  it('marks exactly one tournament active and shows the badge', async () => {
    const a = t.repo.createTournament({ name: 'Alpha Cup', slug: 'alpha' });
    const b = t.repo.createTournament({ name: 'Beta Cup', slug: 'beta' });
    t.repo.setActiveTournament(a.id);
    let html = await (await t.get('/admin/torneos', cookie)).text();
    expect(html).toContain('Activo');
    expect(html.match(/Marcar como activo/g)).toHaveLength(1);
    const res = await t.post(`/admin/t/${b.id}/activar`, {}, cookie);
    expect(res.status).toBe(303);
    expect(t.repo.getActiveTournament()!.id).toBe(b.id);
    html = await (await t.get('/admin/torneos', cookie)).text();
    expect(html.match(/Marcar como activo/g)).toHaveLength(1);
  });

  it('answers 404 for an unknown tournament', async () => {
    expect((await t.post('/admin/t/999/activar', {}, cookie)).status).toBe(404);
  });

  it('emits a change event when the active tournament changes', async () => {
    const a = t.repo.createTournament({ name: 'Alpha Cup', slug: 'alpha' });
    let fired = 0;
    t.events.onTournamentChanged(a.id, () => fired++);
    await t.post(`/admin/t/${a.id}/activar`, {}, cookie);
    expect(fired).toBe(1);
  });

  it('labels the sidebar selector as the current tournament, not the active one', async () => {
    const tournament = t.repo.createTournament({ name: 'Cup', slug: 'cup' });
    const html = await (await t.get(`/admin/t/${tournament.id}/config`, cookie)).text();
    expect(html).toContain('<small>Torneo</small>');
    expect(html).not.toContain('<small>Torneo activo</small>');
  });

  it('names the public-link column for what it is', async () => {
    t.repo.createTournament({ name: 'Cup', slug: 'cup' });
    const html = await (await t.get('/admin/torneos', cookie)).text();
    expect(html).toContain('<th>Página pública</th>');
  });

  it('offers each format as a card with its name and description, Liga + Playoffs by default', async () => {
    const html = await (await t.get('/admin/torneos', cookie)).text();
    for (const info of Object.values(FORMAT_INFO)) {
      expect(html).toContain(info.name);
      expect(html).toContain(info.description);
      expect(html).toMatch(new RegExp(`<input[^>]*type="radio"[^>]*name="format"[^>]*value="${info.key}"`));
    }
    expect(html).toMatch(/<input[^>]*value="league_playoffs"[^>]*checked/);
    expect(html).not.toMatch(/<input[^>]*value="double_elimination"[^>]*checked/);
  });

  it('creates a tournament with each format', async () => {
    for (const format of TOURNAMENT_FORMATS) {
      const slug = `cup-${format.replace('_', '-')}`;
      const res = await t.post('/admin/torneos', { name: `Cup ${format}`, slug, format }, cookie);
      expect(res.status).toBe(303);
      expect(t.repo.getTournamentBySlug(slug)!.format).toBe(format);
    }
    expect(t.repo.getTournamentBySlug('cup-double-elimination')).toMatchObject({ semifinalGames: 1, finalGames: 3 });
  });

  it('creates a Liga + Playoffs tournament when no format is sent', async () => {
    await t.post('/admin/torneos', { name: 'Cup', slug: 'cup' }, cookie);
    expect(t.repo.getTournamentBySlug('cup')).toMatchObject({ format: 'league_playoffs', semifinalGames: 3, finalGames: 5 });
  });

  it('rejects an unknown format with a Spanish message', async () => {
    const res = await t.post('/admin/torneos', { name: 'Cup', slug: 'cup', format: 'swiss' }, cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/torneos');
    expect(await flashText(t, res, cookie)).toContain('Elige un formato de torneo válido');
    expect(t.repo.listTournaments()).toHaveLength(0);
  });

  it('shows each tournament format name in the list', async () => {
    t.repo.createTournament({ name: 'Liga Cup', slug: 'liga' });
    t.repo.createTournament({ name: 'Flash Cup', slug: 'flash', format: 'double_elimination' });
    const html = await (await t.get('/admin/torneos', cookie)).text();
    const table = html.slice(html.indexOf('<table'), html.indexOf('</table>'));
    expect(table).toContain('<th>Formato</th>');
    expect(table).toContain('Liga + Playoffs');
    expect(table).toContain('Doble eliminación');
  });

  it('keeps the "+ Nuevo torneo" selector entry pointing at the creation form', async () => {
    const tournament = t.repo.createTournament({ name: 'Cup', slug: 'cup' });
    const html = await (await t.get(`/admin/t/${tournament.id}/config`, cookie)).text();
    expect(html).toContain('<option value="/admin/torneos">+ Nuevo torneo…</option>');
    const page = await (await t.get('/admin/torneos', cookie)).text();
    expect(page).toContain('action="/admin/torneos"');
  });

  it('does not announce a change twice when re-activating the active tournament', async () => {
    const tournament = t.repo.createTournament({ name: 'Cup', slug: 'cup' });
    t.repo.setActiveTournament(tournament.id);
    let changes = 0;
    t.events.onTournamentChanged(tournament.id, () => changes++);
    await t.post(`/admin/t/${tournament.id}/activar`, {}, cookie);
    expect(changes).toBe(1);
    expect(t.repo.getActiveTournament()!.id).toBe(tournament.id);
  });
});
