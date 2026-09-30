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
  url = `/admin/t/${tournament.id}/equipos/${team.id}`;
});
afterEach(() => t.db.close());

const jpeg = (width = 1600, height = 900) =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 140, b: 90 } } }).jpeg().toBuffer();

interface SaveOptions {
  image?: Uint8Array | Buffer;
  imageType?: string;
  imageName?: string;
  imageField?: string;
  fields?: Record<string, string>;
  path?: string;
  headers?: Record<string, string>;
  cookie?: string | null;
}

/** The row's Guardar: one multipart request with the row's fields and, when staged, the cropped image. */
const save = async (opts: SaveOptions = {}) => {
  const form = new FormData();
  const fields = { code: 'AA', name: 'Alpha', captain: '', hero: 'axe', ...opts.fields };
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (opts.image) {
    form.append(opts.imageField ?? 'image', new Blob([opts.image as BlobPart], { type: opts.imageType ?? 'image/webp' }), opts.imageName ?? 'equipo.webp');
  }
  const headers: Record<string, string> = { origin: 'http://localhost', accept: 'application/json', ...opts.headers };
  const c = opts.cookie === undefined ? cookie : opts.cookie;
  if (c) headers.cookie = c;
  return t.app.request(opts.path ?? url, { method: 'POST', body: form, headers });
};
const team_ = () => t.repo.getTeam(team.id)!;
const pair = (key: string) => [key, key.replace('.webp', '@2x.webp')].sort();

describe('saving a row with a staged image', () => {
  it('stores a 1x and a 2x WebP under the team key with long-lived caching, and records the key', async () => {
    const res = await save({ image: await jpeg() });
    expect(res.status).toBe(200);
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

  it('answers with the row as JSON, ready to update it in place', async () => {
    const res = await save({ image: await jpeg(), fields: { name: 'Alpha Renombrado', captain: 'Kelvin', code: 'al' } });
    const key = team_().imageKey!;
    expect(await res.json()).toEqual({
      ok: true,
      message: 'Equipo AL guardado.',
      team: {
        id: team.id,
        code: 'AL',
        name: 'Alpha Renombrado',
        captain: 'Kelvin',
        hero: 'axe',
        heroName: 'Axe',
        emblem: { kind: 'image', src: `https://images.example/${key}`, src2x: `https://images.example/${key.replace('.webp', '@2x.webp')}`, label: 'Imagen propia' },
      },
    });
  });

  it('saves the fields and the image together, in one request', async () => {
    await save({ image: await jpeg(), fields: { name: 'Nuevo nombre', captain: 'Cap', hero: '' } });
    expect(team_()).toMatchObject({ name: 'Nuevo nombre', captain: 'Cap', hero: null });
    expect(team_().imageKey).not.toBeNull();
  });

  it('tells the public page once', async () => {
    let changes = 0;
    t.events.onTournamentChanged(tournament.id, () => changes++);
    await save({ image: await jpeg() });
    expect(changes).toBe(1);
  });

  it('replacing deletes the previous two objects, after the new key is in place', async () => {
    await save({ image: await jpeg() });
    const first = team_().imageKey!;
    await save({ image: await jpeg(800, 800) });
    const second = team_().imageKey!;
    expect(second).not.toBe(first);
    expect(store.keys()).toEqual(pair(second));
    expect(store.deleted.sort()).toEqual(pair(first));
  });

  it('a failing cleanup of the old image never blocks the save', async () => {
    await save({ image: await jpeg() });
    store.failDelete = true;
    const res = await save({ image: await jpeg(700, 500) });
    expect(res.status).toBe(200);
    expect(team_().imageKey).not.toBeNull();
  });

  it('a failing storage changes nothing: not the fields, not the old image, no orphans', async () => {
    await save({ image: await jpeg() });
    const before = team_();
    const objectsBefore = store.keys();
    store.failPut = true;
    const res = await save({ image: await jpeg(), fields: { name: 'No debe guardarse' } });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'No se pudo guardar la imagen. Inténtalo de nuevo.' });
    expect(team_()).toEqual(before);
    expect(store.keys()).toEqual(objectsBefore);
  });
});

describe('saving a row that clears the image', () => {
  it('clear_image removes the key and both files; the hero shows again', async () => {
    await save({ image: await jpeg() });
    const key = team_().imageKey!;
    const res = await save({ fields: { clear_image: '1' } });
    expect(res.status).toBe(200);
    expect(team_().imageKey).toBeNull();
    expect(store.keys()).toEqual([]);
    expect(store.deleted).toContain(key);
    const body = (await res.json()) as { team: { emblem: unknown } };
    expect(body.team.emblem).toEqual({ kind: 'hero', src: '/assets/heroes/axe.png', label: 'Axe' });
  });

  it('without a hero the row falls back to the code tile', async () => {
    await save({ image: await jpeg(), fields: { hero: '' } });
    const res = await save({ fields: { hero: '', clear_image: '1' } });
    expect(((await res.json()) as { team: { emblem: unknown } }).team.emblem).toEqual({ kind: 'tile', label: 'Sin emblema' });
  });

  it('clearing while choosing a hero is one save: hero set, image gone', async () => {
    await save({ image: await jpeg() });
    await save({ fields: { hero: 'lina', clear_image: '1' } });
    expect(team_()).toMatchObject({ hero: 'lina', imageKey: null });
    expect(store.keys()).toEqual([]);
  });

  it('clear_image with nothing stored is harmless', async () => {
    const res = await save({ fields: { clear_image: '1' } });
    expect(res.status).toBe(200);
    expect(team_().imageKey).toBeNull();
  });

  it('an invalid row clears nothing', async () => {
    await save({ image: await jpeg() });
    const key = team_().imageKey;
    const res = await save({ fields: { hero: 'not-a-hero', clear_image: '1' } });
    expect(res.status).toBe(400);
    expect(team_().imageKey).toBe(key);
    expect(store.keys()).toHaveLength(2);
  });

  it('a new image wins over clear_image in the same request', async () => {
    await save({ image: await jpeg() });
    await save({ image: await jpeg(900, 900), fields: { clear_image: '1' } });
    expect(team_().imageKey).not.toBeNull();
    expect(store.keys()).toHaveLength(2);
  });
});

describe('saving a row with neither', () => {
  it('only the fields change and the image stays', async () => {
    await save({ image: await jpeg() });
    const key = team_().imageKey;
    const res = await save({ fields: { name: 'Solo nombre' } });
    expect(res.status).toBe(200);
    expect(team_()).toMatchObject({ name: 'Solo nombre', imageKey: key });
    expect(store.keys()).toHaveLength(2);
    expect(((await res.json()) as { team: { emblem: { kind: string } } }).team.emblem.kind).toBe('image');
  });

  it('an invalid field is a JSON error and nothing is stored, even with a valid image', async () => {
    const res = await save({ image: await jpeg(), fields: { name: '' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'El nombre del equipo es obligatorio (máximo 40 caracteres).' });
    expect(store.keys()).toEqual([]);
    expect(team_()).toMatchObject({ name: 'Alpha', imageKey: null });
  });

  it('a plain form post (no JavaScript) still saves and redirects with a flash', async () => {
    const res = await t.post(url, { code: 'AA', name: 'Sin JS', hero: 'axe' }, cookie);
    expect(res.status).toBe(303);
    expect(team_().name).toBe('Sin JS');
  });
});

describe('concurrent saves for the same team', () => {
  it('end with exactly one image: the loser is deleted, nothing leaks, nothing wrong is deleted', async () => {
    await save({ image: await jpeg() });
    const original = team_().imageKey!;
    const [a, b] = await Promise.all([save({ image: await jpeg(800, 800) }), save({ image: await jpeg(700, 500) })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const winner = team_().imageKey!;
    expect(winner).not.toBe(original);
    expect(store.keys()).toEqual(pair(winner));
    const deletedBases = store.deleted.filter((k) => !k.includes('@2x'));
    expect(deletedBases).toHaveLength(2);
    expect(new Set(deletedBases).size).toBe(2);
    expect(deletedBases).toContain(original);
    expect(deletedBases).not.toContain(winner);
  });

  it('a team deleted while its image is being stored leaves no objects behind', async () => {
    store.beforePut = () => {
      store.beforePut = null;
      t.repo.deleteTeam(team.id);
    };
    const res = await save({ image: await jpeg() });
    expect(res.status).toBe(404);
    expect(store.keys()).toEqual([]);
  });

  it('clearing while a save is in flight never deletes the new image', async () => {
    await save({ image: await jpeg() });
    const [up, clear] = await Promise.all([save({ image: await jpeg(900, 900) }), save({ fields: { clear_image: '1' } })]);
    expect([up.status, clear.status]).toEqual([200, 200]);
    const key = team_().imageKey;
    expect(store.keys()).toEqual(key ? pair(key) : []);
  });
});

describe('rejecting images', () => {
  it('a text file renamed to .jpg, and other non-images', async () => {
    for (const bytes of [Buffer.from('esto es texto'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')]) {
      const res = await save({ image: bytes, imageName: 'foto.jpg', imageType: 'image/jpeg' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: WRONG });
    }
    expect(store.keys()).toEqual([]);
    expect(team_().imageKey).toBeNull();
  });

  it('a rejected image keeps the row fields unsaved too (all or nothing)', async () => {
    await save({ image: Buffer.from('texto'), imageType: 'image/jpeg', fields: { name: 'No debe guardarse' } });
    expect(team_().name).toBe('Alpha');
  });

  it('an image over 5 MB that fits in the request limit', async () => {
    const res = await save({ image: Buffer.alloc(5 * 1024 * 1024 + 1024, 1) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: WRONG });
  });

  it('a request body over 6 MB is cut off before it is read', async () => {
    const res = await save({ image: Buffer.alloc(6 * 1024 * 1024 + 4096, 1) });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: WRONG });
    expect(store.keys()).toEqual([]);
  });

  it('an image field that is text instead of a file', async () => {
    const res = await save({ fields: { image: 'not a file' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: WRONG });
  });

  it('pictures over the pixel limits', async () => {
    const tooWide = await sharp({ create: { width: 8100, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
    const res = await save({ image: tooWide, imageType: 'image/png', imageName: 'x.png' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('demasiado grande');
  });
});

describe('who may save', () => {
  it('needs a login and a same-origin request', async () => {
    const anon = await save({ image: await jpeg(), cookie: null });
    expect(anon.status).toBe(303);
    expect(anon.headers.get('location')).toBe('/admin/login');
    const foreign = await save({ image: await jpeg(), headers: { origin: 'http://evil.example' } });
    expect(foreign.status).toBe(403);
    expect(store.keys()).toEqual([]);
  });

  it('only for teams of that tournament', async () => {
    const other = t.repo.createTournament({ name: 'Otra', slug: 'otra' });
    const res = await save({ image: await jpeg(), path: `/admin/t/${other.id}/equipos/${team.id}` });
    expect(res.status).toBe(404);
    expect(store.keys()).toEqual([]);
  });

  it('image uploads are rate limited per admin; saving fields is not', async () => {
    const small = await jpeg(64, 36);
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await save({ image: small })).status;
    expect(last).toBe(429);
    expect((await save({ fields: { name: 'Sin imagen' } })).status).toBe(200);
    t.repo.createAdmin('second', await (await import('../src/auth/password.js')).hashPassword('second-pass-1'));
    const other = await t.login('second', 'second-pass-1');
    expect((await save({ image: small, cookie: other })).status).toBe(200);
  });

  it('the small global body cap still applies to every other route', async () => {
    const big = 'x'.repeat(70 * 1024);
    const res = await t.app.request(`/admin/t/${tournament.id}/equipos`, {
      method: 'POST',
      headers: { origin: 'http://localhost', cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: `code=ZZ&name=${big}`,
    });
    expect(res.status).toBe(413);
  });
});

describe('deleting a team', () => {
  it('deletes its objects', async () => {
    await save({ image: await jpeg() });
    expect(store.keys()).toHaveLength(2);
    await t.post(`${url}/eliminar`, {}, cookie);
    expect(t.repo.getTeam(team.id)).toBeUndefined();
    expect(store.keys()).toEqual([]);
  });

  it('a team that cannot be deleted keeps its image', async () => {
    await save({ image: await jpeg() });
    const other = t.repo.createTeam(tournament.id, { code: 'BB', name: 'Bravo' });
    t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: 1, matchNumber: 1, team1Id: team.id, team2Id: other.id });
    await t.post(`${url}/eliminar`, {}, cookie);
    expect(t.repo.getTeam(team.id)).toBeDefined();
    expect(store.keys()).toHaveLength(2);
  });
});

describe('without an image store', () => {
  it('an image answers 503; fields still save; the old routes are gone', async () => {
    const off = await makeApp({ imageStore: null });
    const c = await off.login();
    const tour = off.repo.createTournament({ name: 'Copa', slug: 'copa' });
    const tm = off.repo.createTeam(tour.id, { code: 'AA', name: 'Alpha' });
    const target = `/admin/t/${tour.id}/equipos/${tm.id}`;
    const withImage = new FormData();
    for (const [k, v] of Object.entries({ code: 'AA', name: 'Alpha' })) withImage.append(k, v);
    withImage.append('image', new Blob([await jpeg()], { type: 'image/jpeg' }), 'a.jpg');
    const headers = { origin: 'http://localhost', cookie: c, accept: 'application/json' };
    const res = await off.app.request(target, { method: 'POST', body: withImage, headers });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain('no están disponibles');
    const fieldsOnly = new FormData();
    fieldsOnly.append('code', 'AA');
    fieldsOnly.append('name', 'Solo campos');
    expect((await off.app.request(target, { method: 'POST', body: fieldsOnly, headers })).status).toBe(200);
    expect(off.repo.getTeam(tm.id)!.name).toBe('Solo campos');
    expect((await off.app.request(`${target}/imagen`, { method: 'POST', body: new FormData(), headers })).status).toBe(404);
    off.db.close();
  });
});
