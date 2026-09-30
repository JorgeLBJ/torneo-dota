import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Team, Tournament } from '../src/db/repository.js';
import { regenerateFixture } from '../src/services/fixture.js';
import { makeApp, type TestApp } from './helpers/app.js';
import { MemoryImageStore } from './helpers/memory-store.js';

let t: TestApp;
let store: MemoryImageStore;
let cookie: string;
let tournament: Tournament;
let alpha: Team;
let bravo: Team;

const KEY = 'teams/1/1-aabbccddeeff.webp';

beforeEach(async () => {
  store = new MemoryImageStore();
  t = await makeApp({ imageStore: store });
  cookie = await t.login();
  tournament = t.repo.createTournament({ name: 'Copa', slug: 'copa' });
  t.repo.setActiveTournament(tournament.id);
  alpha = t.repo.createTeam(tournament.id, { code: 'AA', name: 'Alpha', hero: 'axe' });
  bravo = t.repo.createTeam(tournament.id, { code: 'BB', name: 'Bravo', hero: 'lina' });
  t.repo.createTeam(tournament.id, { code: 'CC', name: 'Charlie' });
  t.repo.replaceScheduleDays(tournament.id, [{ date: '2026-10-03', phase: 'group', startTimes: ['14:00', '15:00', '16:00'], slotMinutes: 60 }]);
  regenerateFixture(t.repo, tournament);
});
afterEach(() => t.db.close());

describe('public pages', () => {
  it('show the custom image with a 2x srcset instead of the hero', async () => {
    t.repo.updateTeam(alpha.id, { imageKey: KEY });
    const body = await (await t.get('/')).text();
    expect(body).toContain(`src="https://images.example/${KEY}"`);
    expect(body).toContain(`srcset="https://images.example/${KEY} 1x, https://images.example/teams/1/1-aabbccddeeff@2x.webp 2x"`);
    expect(body).toMatch(/<img[^>]*src="https:\/\/images.example\/teams[^>]*alt="Alpha"/);
    expect(body).not.toContain('/assets/heroes/axe.png');
    expect(body).toContain('/assets/heroes/lina.png');
  });

  it('keep the hero for teams without a custom image, and the code tile for those without either', async () => {
    const body = await (await t.get('/')).text();
    expect(body).toContain('/assets/heroes/axe.png');
    expect(body).toMatch(/class="ph[^"]*"[^>]*>CC</);
  });

  it('the live fragment uses the custom image too', async () => {
    t.repo.updateTeam(bravo.id, { imageKey: KEY });
    const body = await (await t.get('/partial')).text();
    expect(body).toContain(`https://images.example/${KEY}`);
  });

  it('ignore a stored key when no image store is configured', async () => {
    const off = await makeApp({ imageStore: null });
    const tour = off.repo.createTournament({ name: 'X', slug: 'x' });
    off.repo.setActiveTournament(tour.id);
    off.repo.createTeam(tour.id, { code: 'AA', name: 'Alpha', hero: 'axe' });
    const tm = off.repo.createTeam(tour.id, { code: 'BB', name: 'Bravo' });
    off.repo.updateTeam(tm.id, { imageKey: KEY });
    const body = await (await off.get('/')).text();
    expect(body).not.toContain('images.example');
    expect(body).toContain('/assets/heroes/axe.png');
    // No hero to fall back to: the code tile, never a blank slot.
    expect(body).toMatch(/class="ph[^"]*"[^>]*>BB</);
    expect(body).not.toMatch(/<img[^>]*alt="Bravo"/);
    off.db.close();
  });
});

describe('admin teams page', () => {
  it('shows the current emblem, offers upload, and only offers removal when there is a custom image', async () => {
    const base = `/admin/t/${tournament.id}/equipos`;
    let body = await (await t.get(base, cookie)).text();
    const removeButton = (html: string) => /<button[^>]*data-remove-image[^>]*>/.exec(html)![0];
    expect(removeButton(body)).toContain('hidden');
    t.repo.updateTeam(alpha.id, { imageKey: KEY });
    body = await (await t.get(base, cookie)).text();
    expect(body).toContain(`https://images.example/${KEY}`);
    expect(removeButton(body)).not.toContain('hidden');
    expect(body).toContain('id="removeImageDialog"');
    // Nothing submits a removal on its own any more: the row's Guardar sends it.
    expect(body).not.toContain('/imagen/quitar');
    expect(body).not.toContain('data-upload-url');
  });

  it('labels the emblem by its source and keeps a single menu: custom image, hero name, or none', async () => {
    const base = `/admin/t/${tournament.id}/equipos`;
    t.repo.updateTeam(alpha.id, { imageKey: KEY });
    const body = await (await t.get(base, cookie)).text();
    const cells = body.split('class="emblem-cell"').slice(1);
    expect(cells[0]).toContain('Imagen propia');
    expect(cells[0]).toContain('data-has-image="1"');
    expect(cells[0]).toContain(`https://images.example/${KEY}`);
    expect(cells[0]).toContain('Elegir héroe');
    expect(cells[0]).toContain('Subir imagen');
    expect(/<button[^>]*data-remove-image[^>]*>/.exec(cells[0]!)![0]).not.toContain('hidden');
    expect(cells[0]).toContain('data-saved-src2x=');
    expect(cells[1]).toContain('Lina');
    expect(/<button[^>]*data-remove-image[^>]*>/.exec(cells[1]!)![0]).toContain('hidden');
    expect(cells[1]).toContain('data-has-image="0"');
    expect(cells[2]).toContain('Sin emblema');
    expect(body).not.toContain('Sin héroe');
  });

  it('opens the emblem in a viewer: custom image at 2x, hero portrait, nothing for a code tile', async () => {
    t.repo.updateTeam(alpha.id, { imageKey: KEY });
    const body = await (await t.get(`/admin/t/${tournament.id}/equipos`, cookie)).text();
    expect(body).toContain('id="emblemViewer"');
    const cells = body.split('class="emblem-cell"').slice(1);
    const thumb = (cell: string) => /<button[^>]*class="emblem-thumb"[^>]*>/.exec(cell)![0];
    expect(thumb(cells[0]!)).toContain('type="button"');
    expect(thumb(cells[0]!)).toContain(`data-full="https://images.example/teams/1/1-aabbccddeeff@2x.webp"`);
    expect(thumb(cells[0]!)).toContain(`data-fallback="https://images.example/${KEY}"`);
    expect(thumb(cells[0]!)).toContain('data-name="Alpha"');
    expect(thumb(cells[0]!)).toContain('data-source="Imagen propia"');
    expect(thumb(cells[0]!)).toContain('aria-label="Ver emblema de Alpha"');
    expect(thumb(cells[1]!)).toContain('data-full="/assets/heroes/lina.png"');
    expect(thumb(cells[1]!)).toContain('data-source="Lina"');
    expect(thumb(cells[1]!)).not.toContain('data-fallback');
    const tile = thumb(cells[2]!);
    expect(tile).toContain('disabled');
    expect(tile).not.toContain('data-full');
    expect(tile).not.toContain('aria-label');
  });

  it('says so when custom images are unavailable', async () => {
    const off = await makeApp({ imageStore: null });
    const c = await off.login();
    const tour = off.repo.createTournament({ name: 'X', slug: 'x' });
    off.repo.createTeam(tour.id, { code: 'AA', name: 'Alpha' });
    const body = await (await off.get(`/admin/t/${tour.id}/equipos`, c)).text();
    expect(body).toContain('no están disponibles');
    off.db.close();
  });
});

describe('crop dialog', () => {
  it('is on the teams page with upload buttons and the vendored cropper', async () => {
    const base = `/admin/t/${tournament.id}/equipos`;
    const body = await (await t.get(base, cookie)).text();
    expect(body).toContain('Subir imagen');
    expect(body).toContain('data-image-pick');
    expect(body).toContain('data-team-form');
    expect(body).toContain('Deshacer cambios');
    expect(body).toContain('Sin guardar');
    expect(body).toContain('id="imageModal"');
    expect(body).toMatch(/src="\/assets\/vendor\/cropperjs\/cropper\.min\.js\?v=[0-9a-f]{10}"/);
    expect(body).toMatch(/href="\/assets\/vendor\/cropperjs\/cropper\.min\.css\?v=[0-9a-f]{10}"/);
    expect(body).not.toMatch(/https?:\/\/[^"]*cropper/);
  });

  it('offers fit-whole-image, rotate and a background choice that defaults to blurred', async () => {
    const body = await (await t.get(`/admin/t/${tournament.id}/equipos`, cookie)).text();
    expect(body).toContain('id="cropFit"');
    expect(body).toContain('Ajustar completa');
    expect(body).toContain('Girar 90°');
    const radios = [...body.matchAll(/<input type="radio" name="cropBg" value="(\w+)"( checked)?/g)].map((m) => [m[1], Boolean(m[2])]);
    expect(radios).toEqual([['blur', true], ['dark', false], ['clear', false]]);
    for (const label of ['Desenfocado', 'Oscuro', 'Transparente', 'Fondo']) expect(body).toContain(label);
  });

  it('serves the vendored files and their license', async () => {
    for (const file of ['cropper.min.js', 'cropper.min.css', 'LICENSE']) {
      expect((await t.get(`/assets/vendor/cropperjs/${file}`)).status).toBe(200);
    }
  });

  it('is absent when custom images are unavailable', async () => {
    const off = await makeApp({ imageStore: null });
    const c = await off.login();
    const tour = off.repo.createTournament({ name: 'X', slug: 'x' });
    off.repo.createTeam(tour.id, { code: 'AA', name: 'Alpha' });
    const body = await (await off.get(`/admin/t/${tour.id}/equipos`, c)).text();
    expect(body).not.toContain('imageModal');
    off.db.close();
  });
});

describe('dialogs name the team as typed in the row', () => {
  // The page script has no DOM test harness here, so this guards the wiring: every dialog that names a team reads
  // the row's current name input (teamRows.nameOf), never an attribute frozen at render time.
  const script = readFileSync(new URL('../public/admin.js', import.meta.url), 'utf8');

  it('hero picker, crop dialog, removal confirm and lightbox all use the current name', () => {
    expect(script).not.toContain("getAttribute('data-team-label')");
    expect(script).toMatch(/label\.textContent = window\.teamRows\.nameOf\(cell\)/);
    expect(script).toMatch(/var label = window\.teamRows\.nameOf\(cell\)/);
    expect(script).toMatch(/\[data-remove-team\]'\)\.textContent = window\.teamRows\.nameOf\(pendingCell\)/);
    expect(script).toMatch(/var name = viewerCell \? window\.teamRows\.nameOf\(viewerCell\)/);
  });

  it('labels built from the name follow the name input as the user types', () => {
    expect(script).toMatch(/event\.target\.name === 'name'\) refreshNames\(state\)/);
    expect(script).toContain("'Ver emblema de ' + name");
  });

  it('nameOf falls back to the saved name when the input is empty', () => {
    expect(script).toMatch(/return typed \|\| cell\.getAttribute\('data-team-name'\) \|\| 'el equipo'/);
  });
});

describe('what counts as an unsaved change in a row', () => {
  const script = readFileSync(new URL('../public/admin.js', import.meta.url), 'utf8');

  it('a staged hero marks the row dirty without going through the hidden input (its value is its default)', () => {
    expect(script).toMatch(/if \(state\.hero !== state\.saved\.hero\) return true;/);
    expect(script).toMatch(/el !== state\.heroInput && el\.value !== el\.defaultValue/);
  });

  it('every staged change is part of the check: image, removal, hero and the text fields', () => {
    expect(script).toMatch(/if \(state\.blob \|\| state\.removeImage\) return true;/);
  });
});
