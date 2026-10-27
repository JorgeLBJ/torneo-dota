import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NewBanner, Tournament } from '../src/db/repository.js';
import { flashText, makeApp, type TestApp } from './helpers/app.js';
import { MemoryImageStore } from './helpers/memory-store.js';

let t: TestApp;
let cookie: string;
let store: MemoryImageStore;
let active: Tournament;
let old: Tournament;

beforeEach(async () => {
  store = new MemoryImageStore();
  t = await makeApp({ imageStore: store });
  cookie = await t.login();
  active = t.repo.createTournament({ name: 'Copa Activa', slug: 'activa' });
  t.repo.setActiveTournament(active.id);
  old = t.repo.createTournament({ name: 'Torneo Viejo', slug: 'viejo' });
});
afterEach(() => t.db.close());

const banner = (key: string): NewBanner => ({
  name: 'Final',
  altText: 'Final',
  imageKey: `${key}.webp`,
  imageWidth: 1920,
  imageHeight: 1080,
  imageKeySmall: `${key}-1280.webp`,
  imageWidthSmall: 1280,
  ctaText: null,
  ctaTab: null,
  active: false,
  startsAt: null,
  endsAt: null,
});

/** The options of the sidebar tournament selector. */
const selectorOptions = (html: string): string => html.slice(html.indexOf('<select'), html.indexOf('</select>'));

/** The "Archivados" section of the Torneos screen. */
const archivedSection = (html: string): string => {
  const start = html.indexOf('Archivados');
  return start < 0 ? '' : html.slice(start, html.indexOf('Nuevo torneo', start));
};

describe('archiving tournaments', () => {
  it('archives a tournament: hidden from the selector, listed under Archivados', async () => {
    let fired = 0;
    t.events.onTournamentChanged(old.id, () => fired++);
    const res = await t.post(`/admin/t/${old.id}/archivar`, {}, cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/torneos');
    expect(await flashText(t, res, cookie)).toContain('archivado');
    expect(fired).toBe(1);
    const stored = t.repo.getTournamentById(old.id)!;
    expect(stored.archivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);

    const html = await (await t.get('/admin/torneos', cookie)).text();
    expect(selectorOptions(html)).not.toContain('Torneo Viejo');
    expect(selectorOptions(html)).toContain('Copa Activa');
    const archived = archivedSection(html);
    expect(archived).toContain('Torneo Viejo');
    expect(archived).toContain(`/admin/t/${old.id}/restaurar`);
    expect(archived).toContain(`/admin/t/${old.id}/eliminar`);
    expect(archived).not.toContain('Copa Activa');
  });

  it('still shows an archived tournament in the selector on its own pages', async () => {
    t.repo.archiveTournament(old.id);
    const html = await (await t.get(`/admin/t/${old.id}/config`, cookie)).text();
    expect(selectorOptions(html)).toContain('Torneo Viejo');
    const other = await (await t.get(`/admin/t/${active.id}/config`, cookie)).text();
    expect(selectorOptions(other)).not.toContain('Torneo Viejo');
    expect(selectorOptions(other)).toContain('+ Nuevo torneo');
  });

  it('refuses to archive the active tournament', async () => {
    const res = await t.post(`/admin/t/${active.id}/archivar`, {}, cookie);
    expect(res.status).toBe(303);
    expect(await flashText(t, res, cookie)).toContain('No se puede archivar el torneo activo');
    expect(t.repo.getTournamentById(active.id)!.archivedAt).toBeNull();
  });

  it('refuses to activate an archived tournament', async () => {
    t.repo.archiveTournament(old.id);
    const res = await t.post(`/admin/t/${old.id}/activar`, {}, cookie);
    expect(res.status).toBe(303);
    expect(await flashText(t, res, cookie)).toContain('Restáuralo antes de marcarlo como activo');
    expect(t.repo.getActiveTournament()!.id).toBe(active.id);
  });

  it('restores an archived tournament', async () => {
    t.repo.archiveTournament(old.id);
    let fired = 0;
    t.events.onTournamentChanged(old.id, () => fired++);
    const res = await t.post(`/admin/t/${old.id}/restaurar`, {}, cookie);
    expect(res.status).toBe(303);
    expect(await flashText(t, res, cookie)).toContain('restaurado');
    expect(fired).toBe(1);
    expect(t.repo.getTournamentById(old.id)!.archivedAt).toBeNull();
    const html = await (await t.get('/admin/torneos', cookie)).text();
    expect(selectorOptions(html)).toContain('Torneo Viejo');
    expect(archivedSection(html)).toBe('');
  });

  it('keeps the public page of an archived tournament working', async () => {
    t.repo.archiveTournament(old.id);
    const res = await t.get('/t/viejo');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Torneo Viejo');
  });

  it('keeps archived out of the generic tournament patch', () => {
    t.repo.archiveTournament(old.id);
    t.repo.updateTournament(old.id, { name: 'Renombrado' });
    expect(t.repo.getTournamentById(old.id)!.archivedAt).not.toBeNull();
  });
});

describe('deleting tournaments', () => {
  it('refuses to delete a tournament that is not archived', async () => {
    const res = await t.post(`/admin/t/${old.id}/eliminar`, { confirm_name: 'Torneo Viejo' }, cookie);
    expect(res.status).toBe(303);
    expect(await flashText(t, res, cookie)).toContain('Archiva el torneo antes de eliminarlo');
    expect(t.repo.getTournamentById(old.id)).toBeDefined();
  });

  it('requires the exact name to confirm', async () => {
    t.repo.archiveTournament(old.id);
    for (const typed of ['', 'torneo viejo', 'Torneo', 'Otro']) {
      const res = await t.post(`/admin/t/${old.id}/eliminar`, { confirm_name: typed }, cookie);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/admin/torneos');
      expect(await flashText(t, res, cookie)).toContain('Escribe el nombre exacto del torneo');
    }
    expect(t.repo.getTournamentById(old.id)).toBeDefined();
  });

  it('deletes an archived tournament with its rows and stored images', async () => {
    const withImage = t.repo.createTeam(old.id, { code: 'A', name: 'Alpha' });
    t.repo.updateTeam(withImage.id, { imageKey: `teams/${old.id}/1-abc.webp` });
    t.repo.createTeam(old.id, { code: 'B', name: 'Beta' });
    t.repo.createBanner(old.id, banner(`banners/${old.id}/xyz`));
    const keep = t.repo.createTeam(active.id, { code: 'A', name: 'Keeper' });
    t.repo.updateTeam(keep.id, { imageKey: `teams/${active.id}/9-keep.webp` });
    t.repo.createBanner(active.id, banner(`banners/${active.id}/keep`));
    t.repo.archiveTournament(old.id);
    let fired = 0;
    t.events.onTournamentChanged(old.id, () => fired++);

    const res = await t.post(`/admin/t/${old.id}/eliminar`, { confirm_name: 'Torneo Viejo' }, cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/torneos');
    expect(await flashText(t, res, cookie)).toContain('eliminado');
    expect(fired).toBe(1);
    expect(t.repo.getTournamentById(old.id)).toBeUndefined();
    expect(t.repo.listTeams(old.id)).toEqual([]);
    expect(t.repo.listBanners(old.id)).toEqual([]);
    expect(t.db.prepare('SELECT COUNT(*) FROM teams WHERE tournament_id = ?').pluck().get(old.id)).toBe(0);
    expect(store.deleted.sort()).toEqual(
      [
        `banners/${old.id}/xyz-1280.webp`,
        `banners/${old.id}/xyz.webp`,
        `teams/${old.id}/1-abc.webp`,
        `teams/${old.id}/1-abc@2x.webp`,
      ].sort(),
    );
    expect(t.repo.listTeams(active.id)).toHaveLength(1);
    expect(t.repo.listBanners(active.id)).toHaveLength(1);
    expect((await t.get('/t/viejo')).status).toBe(404);
  });

  it('deletes the rows even when the image store fails', async () => {
    const team = t.repo.createTeam(old.id, { code: 'A', name: 'Alpha' });
    t.repo.updateTeam(team.id, { imageKey: `teams/${old.id}/1-abc.webp` });
    t.repo.archiveTournament(old.id);
    store.failDelete = true;
    const res = await t.post(`/admin/t/${old.id}/eliminar`, { confirm_name: 'Torneo Viejo' }, cookie);
    expect(res.status).toBe(303);
    expect(await flashText(t, res, cookie)).toContain('eliminado');
    expect(t.repo.getTournamentById(old.id)).toBeUndefined();
  });

  it('answers 404 for an unknown tournament', async () => {
    expect((await t.post('/admin/t/999/eliminar', { confirm_name: 'x' }, cookie)).status).toBe(404);
    expect((await t.post('/admin/t/999/archivar', {}, cookie)).status).toBe(404);
  });
});
