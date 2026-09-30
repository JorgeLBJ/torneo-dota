import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Team, Tournament } from '../src/db/repository.js';
import { makeApp, type TestApp } from './helpers/app.js';
import { MemoryImageStore } from './helpers/memory-store.js';

let t: TestApp;
let cookie: string;
let store: MemoryImageStore;
let tournament: Tournament;
let team: Team;
let url: string;

const WRONG = 'La imagen debe ser JPG, PNG o WebP de hasta 5 MB.';

beforeEach(async () => {
  store = new MemoryImageStore();
  t = await makeApp({ imageStore: store });
  cookie = await t.login();
  tournament = t.repo.createTournament({ name: 'Copa', slug: 'copa' });
  t.repo.setActiveTournament(tournament.id);
  team = t.repo.createTeam(tournament.id, { code: 'AA', name: 'Alpha', hero: 'axe' });
  url = `/admin/t/${tournament.id}/equipos/${team.id}/imagen`;
});
afterEach(() => t.db.close());

const jpeg = (width = 1600, height = 900) =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 140, b: 90 } } }).jpeg().toBuffer();

const upload = async (bytes: Uint8Array | Buffer, opts: { name?: string; type?: string; field?: string; path?: string; headers?: Record<string, string>; cookie?: string | null } = {}) => {
  const form = new FormData();
  form.append(opts.field ?? 'image', new Blob([bytes as BlobPart], { type: opts.type ?? 'image/jpeg' }), opts.name ?? 'equipo.jpg');
  const headers: Record<string, string> = { origin: 'http://localhost', ...opts.headers };
  const c = opts.cookie === undefined ? cookie : opts.cookie;
  if (c) headers.cookie = c;
  return t.app.request(opts.path ?? url, { method: 'POST', body: form, headers });
};
const team_ = () => t.repo.getTeam(team.id)!;

describe('uploading', () => {
  it('stores a 1x and a 2x WebP under the team key with long-lived caching, and records the key', async () => {
    const res = await upload(await jpeg());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [base, retina] = store.keys();
    expect(base).toMatch(new RegExp(`^teams/${tournament.id}/${team.id}-[0-9a-f]{12}[.]webp$`));
    expect(retina).toBe(base!.replace('.webp', '@2x.webp'));
    expect(team_().imageKey).toBe(base);
    for (const key of [base!, retina!]) {
      expect(store.objects.get(key)).toMatchObject({ contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' });
    }
    expect(await sharp(store.objects.get(base!)!.bytes).metadata()).toMatchObject({ format: 'webp', width: 512, height: 288 });
    expect(await sharp(store.objects.get(retina!)!.bytes).metadata()).toMatchObject({ format: 'webp', width: 1024, height: 576 });
  });

  it('keeps the hero, and tells the public page', async () => {
    let changes = 0;
    t.events.onTournamentChanged(tournament.id, () => changes++);
    await upload(await jpeg());
    expect(team_().hero).toBe('axe');
    expect(changes).toBe(1);
  });

  it('replacing deletes the previous two objects', async () => {
    await upload(await jpeg());
    const first = team_().imageKey!;
    await upload(await jpeg(800, 800));
    const second = team_().imageKey!;
    expect(second).not.toBe(first);
    expect(store.keys()).toEqual([second.replace('.webp', '@2x.webp'), second].sort());
    expect(store.deleted.sort()).toEqual([first, first.replace('.webp', '@2x.webp')].sort());
  });

  it('a failing cleanup of the old image never blocks the save', async () => {
    await upload(await jpeg());
    store.failDelete = true;
    const res = await upload(await jpeg(700, 500));
    expect(res.status).toBe(200);
    expect(team_().imageKey).not.toBeNull();
  });

  it('a failing storage leaves the team untouched and cleans up what it wrote', async () => {
    await upload(await jpeg());
    const before = team_().imageKey;
    const objectsBefore = store.keys();
    store.failPut = true;
    const res = await upload(await jpeg());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'No se pudo guardar la imagen. Inténtalo de nuevo.' });
    expect(team_().imageKey).toBe(before);
    expect(store.keys()).toEqual(objectsBefore);
  });
});

describe('rejecting uploads', () => {
  it('a text file renamed to .jpg, and other non-images', async () => {
    for (const bytes of [Buffer.from('esto es texto'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')]) {
      const res = await upload(bytes, { name: 'foto.jpg', type: 'image/jpeg' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: WRONG });
    }
    expect(store.keys()).toEqual([]);
    expect(team_().imageKey).toBeNull();
  });

  it('an image over 5 MB that fits in the request limit', async () => {
    const res = await upload(Buffer.alloc(5 * 1024 * 1024 + 1024, 1));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: WRONG });
  });

  it('a request body over 6 MB is cut off before it is read', async () => {
    const res = await upload(Buffer.alloc(6 * 1024 * 1024 + 4096, 1));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: WRONG });
    expect(store.keys()).toEqual([]);
  });

  it('a request without the file field, or with a text field instead', async () => {
    const res = await upload(await jpeg(), { field: 'other' });
    expect(res.status).toBe(400);
    const form = new FormData();
    form.append('image', 'not a file');
    const res2 = await t.app.request(url, { method: 'POST', body: form, headers: { origin: 'http://localhost', cookie } });
    expect(res2.status).toBe(400);
  });

  it('pictures over the pixel limits', async () => {
    const tooWide = await sharp({ create: { width: 8100, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
    const res = await upload(tooWide, { type: 'image/png', name: 'x.png' });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('demasiado grande');
  });
});

describe('who may upload', () => {
  it('needs a login and a same-origin request', async () => {
    const anon = await upload(await jpeg(), { cookie: null });
    expect(anon.status).toBe(303);
    expect(anon.headers.get('location')).toBe('/admin/login');
    const foreign = await upload(await jpeg(), { headers: { origin: 'http://evil.example' } });
    expect(foreign.status).toBe(403);
    expect(store.keys()).toEqual([]);
  });

  it('only for teams of that tournament', async () => {
    const other = t.repo.createTournament({ name: 'Otra', slug: 'otra' });
    const res = await upload(await jpeg(), { path: `/admin/t/${other.id}/equipos/${team.id}/imagen` });
    expect(res.status).toBe(404);
    expect(store.keys()).toEqual([]);
  });

  it('is rate limited per admin', async () => {
    const small = await jpeg(64, 36);
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await upload(small)).status;
    expect(last).toBe(429);
    // A different admin has their own budget.
    t.repo.createAdmin('second', await (await import('../src/auth/password.js')).hashPassword('second-pass-1'));
    const other = await t.login('second', 'second-pass-1');
    expect((await upload(small, { cookie: other })).status).toBe(200);
  });

  it('the small global body cap still applies everywhere else', async () => {
    const big = 'x'.repeat(70 * 1024);
    const res = await t.app.request(`/admin/t/${tournament.id}/equipos/${team.id}`, {
      method: 'POST',
      headers: { origin: 'http://localhost', cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: `code=AA&name=${big}`,
    });
    expect(res.status).toBe(413);
  });
});

describe('removing', () => {
  it('drops the custom image, deletes both objects, and the hero shows again', async () => {
    await upload(await jpeg());
    const key = team_().imageKey!;
    const res = await t.post(`${url}/quitar`, {}, cookie);
    expect(res.status).toBe(303);
    expect(team_().imageKey).toBeNull();
    expect(team_().hero).toBe('axe');
    expect(store.keys()).toEqual([]);
    expect(store.deleted).toContain(key);
  });

  it('is harmless without an image, and needs a same-origin request', async () => {
    expect((await t.post(`${url}/quitar`, {}, cookie)).status).toBe(303);
    const foreign = await t.send('POST', `${url}/quitar`, { cookie, headers: { origin: 'http://evil.example' } });
    expect(foreign.status).toBe(403);
  });

  it('deleting the team deletes its objects', async () => {
    await upload(await jpeg());
    expect(store.keys()).toHaveLength(2);
    await t.post(`/admin/t/${tournament.id}/equipos/${team.id}/eliminar`, {}, cookie);
    expect(t.repo.getTeam(team.id)).toBeUndefined();
    expect(store.keys()).toEqual([]);
  });

  it('a team that cannot be deleted keeps its image', async () => {
    await upload(await jpeg());
    const other = t.repo.createTeam(tournament.id, { code: 'BB', name: 'Bravo' });
    t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: 1, matchNumber: 1, team1Id: team.id, team2Id: other.id });
    await t.post(`/admin/t/${tournament.id}/equipos/${team.id}/eliminar`, {}, cookie);
    expect(t.repo.getTeam(team.id)).toBeDefined();
    expect(store.keys()).toHaveLength(2);
  });
});

describe('without an image store', () => {
  it('answers 503 and does not break the rest', async () => {
    const off = await makeApp({ imageStore: null });
    const c = await off.login();
    const tour = off.repo.createTournament({ name: 'Copa', slug: 'copa' });
    const tm = off.repo.createTeam(tour.id, { code: 'AA', name: 'Alpha' });
    const form = new FormData();
    form.append('image', new Blob([await jpeg()], { type: 'image/jpeg' }), 'a.jpg');
    const res = await off.app.request(`/admin/t/${tour.id}/equipos/${tm.id}/imagen`, { method: 'POST', body: form, headers: { origin: 'http://localhost', cookie: c } });
    expect(res.status).toBe(503);
    expect((await res.json() as { error: string }).error).toContain('no están disponibles');
    expect((await off.get(`/admin/t/${tour.id}/equipos`, c)).status).toBe(200);
    off.db.close();
  });
});
