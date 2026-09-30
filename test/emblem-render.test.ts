import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Team, Tournament } from '../src/db/repository.js';
import { regenerateFixture } from '../src/services/fixture.js';
import { makeApp, type TestApp } from './helpers/app.js';
import { MemoryImageStore } from './helpers/memory-store.js';

let t: TestApp;
let cookie: string;
let tournament: Tournament;
let alpha: Team;
let bravo: Team;

const KEY = 'teams/1/1-aabbccddeeff.webp';

beforeEach(async () => {
  t = await makeApp({ imageStore: new MemoryImageStore() });
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
    off.db.close();
  });
});

describe('admin teams page', () => {
  it('shows the current emblem, offers upload, and only offers removal when there is a custom image', async () => {
    const base = `/admin/t/${tournament.id}/equipos`;
    let body = await (await t.get(base, cookie)).text();
    expect(body).not.toContain('Quitar imagen');
    t.repo.updateTeam(alpha.id, { imageKey: KEY });
    body = await (await t.get(base, cookie)).text();
    expect(body).toContain(`https://images.example/${KEY}`);
    expect(body).toContain(`action="${base}/${alpha.id}/imagen/quitar"`);
    expect(body).toContain('Quitar imagen');
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
