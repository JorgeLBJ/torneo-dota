import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Team, Tournament } from '../src/db/repository.js';
import type { BatchRow } from '../src/domain/team-batch.js';
import { makeApp, type TestApp } from './helpers/app.js';
import { MemoryImageStore } from './helpers/memory-store.js';

let t: TestApp;
let cookie: string;
let store: MemoryImageStore;
let tournament: Tournament;
let a: Team;
let b: Team;
let url: string;

const WRONG = 'La imagen debe ser JPG, PNG o WebP de hasta 5 MB.';

beforeEach(async () => {
  store = new MemoryImageStore();
  t = await makeApp({ imageStore: store });
  cookie = await t.login();
  tournament = t.repo.createTournament({ name: 'Copa', slug: 'copa' });
  t.repo.setActiveTournament(tournament.id);
  a = t.repo.createTeam(tournament.id, { code: 'AA', name: 'Alpha', hero: 'axe' });
  b = t.repo.createTeam(tournament.id, { code: 'BB', name: 'Bravo' });
  url = `/admin/t/${tournament.id}/equipos/lote`;
});
afterEach(() => t.db.close());

const jpeg = (width = 1600, height = 900) =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 140, b: 90 } } }).jpeg().toBuffer();

/** The row as the page would send it when nothing changed. */
const rowOf = (team: Team, extra: Partial<BatchRow> = {}): BatchRow => ({
  id: team.id,
  code: team.code,
  name: team.name,
  captain: team.captain ?? '',
  hero: team.hero,
  emblem: 'keep',
  ...extra,
});
const team_ = (team: Team) => t.repo.getTeam(team.id)!;
const pair = (key: string) => [key, key.replace('.webp', '@2x.webp')].sort();

interface SendOptions {
  images?: Record<string, Uint8Array | Buffer>;
  rawRows?: string;
  headers?: Record<string, string>;
  cookie?: string | null;
  path?: string;
}

/** The global "Guardar cambios": one multipart request with every changed row and the staged images. */
const send = async (rows: BatchRow[], opts: SendOptions = {}) => {
  const form = new FormData();
  form.append('rows', opts.rawRows ?? JSON.stringify(rows));
  for (const [field, bytes] of Object.entries(opts.images ?? {})) {
    form.append(field, new Blob([bytes as BlobPart], { type: 'image/webp' }), 'equipo.webp');
  }
  const headers: Record<string, string> = { origin: 'http://localhost', accept: 'application/json', ...opts.headers };
  const c = opts.cookie === undefined ? cookie : opts.cookie;
  if (c) headers.cookie = c;
  return t.app.request(opts.path ?? url, { method: 'POST', body: form, headers });
};

describe('saving a batch with staged images', () => {
  it('stores a 1x and a 2x WebP per image with long-lived caching and records the keys', async () => {
    const res = await send([rowOf(b, { emblem: 'image', imageField: 'image_b' })], { images: { image_b: await jpeg() } });
    expect(res.status).toBe(200);
    const [base, retina] = store.keys();
    expect(base).toMatch(new RegExp(`^teams/${tournament.id}/${b.id}-[0-9a-f]{12}[.]webp$`));
    expect(retina).toBe(base!.replace('.webp', '@2x.webp'));
    expect(team_(b).imageKey).toBe(base);
    for (const key of [base!, retina!]) {
      expect(store.objects.get(key)).toMatchObject({ contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' });
    }
    expect(await sharp(store.objects.get(base!)!.bytes).metadata()).toMatchObject({ format: 'webp', width: 512, height: 288 });
    expect(await sharp(store.objects.get(retina!)!.bytes).metadata()).toMatchObject({ format: 'webp', width: 1024, height: 576 });
  });

  it('answers with every saved row as JSON, ready to redraw them', async () => {
    const res = await send(
      [rowOf(a, { name: 'Alpha 2', captain: 'Kelvin' }), rowOf(b, { emblem: 'image', imageField: 'image_b', code: 'bx' })],
      { images: { image_b: await jpeg() } },
    );
    const key = team_(b).imageKey!;
    expect(await res.json()).toEqual({
      ok: true,
      message: 'Cambios guardados (2 equipos).',
      teams: [
        {
          id: a.id, code: 'AA', name: 'Alpha 2', captain: 'Kelvin', hero: 'axe', heroName: 'Axe',
          emblem: { kind: 'hero', src: '/assets/heroes/axe.png', label: 'Axe' },
        },
        {
          id: b.id, code: 'BX', name: 'Bravo', captain: null, hero: null, heroName: null,
          emblem: { kind: 'image', src: `https://images.example/${key}`, src2x: `https://images.example/${key.replace('.webp', '@2x.webp')}`, label: 'Imagen propia' },
        },
      ],
    });
  });

  it('uses the singular for one team', async () => {
    const res = await send([rowOf(a, { name: 'Solo uno' })]);
    expect(((await res.json()) as { message: string }).message).toBe('Cambios guardados (1 equipo).');
  });

  it('several images in one batch, each to its own team', async () => {
    await send(
      [rowOf(a, { emblem: 'image', imageField: 'image_a' }), rowOf(b, { emblem: 'image', imageField: 'image_b' })],
      { images: { image_a: await jpeg(), image_b: await jpeg(800, 800) } },
    );
    expect(store.keys()).toEqual([...pair(team_(a).imageKey!), ...pair(team_(b).imageKey!)].sort());
  });

  it('tells the public page once, however many rows changed', async () => {
    let changes = 0;
    t.events.onTournamentChanged(tournament.id, () => changes++);
    await send([rowOf(a, { name: 'X1' }), rowOf(b, { name: 'X2' })]);
    expect(changes).toBe(1);
  });
});

describe('the emblem is exclusive', () => {
  it('a new image drops the hero, which is free for another team right away', async () => {
    await send([rowOf(a, { emblem: 'image', imageField: 'image_a' })], { images: { image_a: await jpeg() } });
    expect(team_(a)).toMatchObject({ hero: null });
    expect(team_(a).imageKey).not.toBeNull();
    const res = await send([rowOf(b, { emblem: 'hero', hero: 'axe' })]);
    expect(res.status).toBe(200);
    expect(team_(b).hero).toBe('axe');
  });

  it('a hero drops the image and deletes its files', async () => {
    await send([rowOf(b, { emblem: 'image', imageField: 'image_b' })], { images: { image_b: await jpeg() } });
    const key = team_(b).imageKey!;
    const res = await send([rowOf(b, { emblem: 'hero', hero: 'lina' })]);
    expect(res.status).toBe(200);
    expect(team_(b)).toMatchObject({ hero: 'lina', imageKey: null });
    expect(store.keys()).toEqual([]);
    expect(store.deleted.sort()).toEqual(pair(key));
  });

  it('none clears both; the row is a code tile', async () => {
    const res = await send([rowOf(a, { emblem: 'none' })]);
    expect(team_(a)).toMatchObject({ hero: null, imageKey: null });
    expect(((await res.json()) as { teams: { emblem: unknown }[] }).teams[0]!.emblem).toEqual({ kind: 'tile', label: 'Sin emblema' });
  });

  it('keep changes only the fields and leaves the emblem (hero or image) alone', async () => {
    await send([rowOf(b, { emblem: 'image', imageField: 'image_b' })], { images: { image_b: await jpeg() } });
    const key = team_(b).imageKey;
    await send([rowOf(a, { name: 'Renombrado' }), rowOf(b, { name: 'Bravo 2' })]);
    expect(team_(a)).toMatchObject({ name: 'Renombrado', hero: 'axe' });
    expect(team_(b)).toMatchObject({ name: 'Bravo 2', imageKey: key });
    expect(store.keys()).toHaveLength(2);
  });
});

describe('validation is on the final state of the whole batch', () => {
  const c = () => t.repo.createTeam(tournament.id, { code: 'CC', name: 'Charlie' });

  it('swaps two heroes between two teams in one batch', async () => {
    t.repo.updateTeam(b.id, { hero: 'lina' });
    const res = await send([rowOf(a, { emblem: 'hero', hero: 'lina' }), rowOf(b, { emblem: 'hero', hero: 'axe' })]);
    expect(res.status).toBe(200);
    expect([team_(a).hero, team_(b).hero]).toEqual(['lina', 'axe']);
  });

  it('swaps two codes in one batch', async () => {
    const res = await send([rowOf(a, { code: 'BB' }), rowOf(b, { code: 'AA' })]);
    expect(res.status).toBe(200);
    expect([team_(a).code, team_(b).code]).toEqual(['BB', 'AA']);
  });

  it('moves a hero: one team goes to a custom image and another takes the hero, in one save', async () => {
    const f = t.repo.createTeam(tournament.id, { code: 'FF', name: 'Foxtrot', hero: 'chaos_knight' });
    const other = c();
    const res = await send(
      [rowOf(other, { emblem: 'hero', hero: 'chaos_knight' }), rowOf(f, { emblem: 'image', imageField: 'image_f' })],
      { images: { image_f: await jpeg() } },
    );
    expect(res.status).toBe(200);
    expect(team_(other).hero).toBe('chaos_knight');
    expect(team_(f)).toMatchObject({ hero: null });
    expect(team_(f).imageKey).not.toBeNull();
  });

  it('two rows claiming the same hero fail with an error on each, and nothing changes', async () => {
    const res = await send([
      rowOf(b, { emblem: 'hero', hero: 'pudge', name: 'Cambio B' }),
      rowOf(c(), { emblem: 'hero', hero: 'pudge', name: 'Cambio C' }),
    ]);
    const other = t.repo.listTeams(tournament.id).find((x) => x.code === 'CC')!;
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      errors: { [b.id]: 'El héroe Pudge ya lo usa el equipo CC.', [other.id]: 'El héroe Pudge ya lo usa el equipo BB.' },
    });
    expect(team_(b)).toMatchObject({ name: 'Bravo', hero: null });
    expect(team_(other)).toMatchObject({ name: 'Charlie', hero: null });
  });

  it('a hero still held by a team that is not leaving it is refused', async () => {
    const res = await send([rowOf(b, { emblem: 'hero', hero: 'axe' })]);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errors: { [b.id]: 'El héroe Axe ya lo usa el equipo AA.' } });
  });

  it('one invalid row saves none of the valid ones, and uploads nothing', async () => {
    const res = await send(
      [rowOf(a, { name: 'Bien' }), rowOf(b, { emblem: 'image', imageField: 'image_b', code: '!!' })],
      { images: { image_b: await jpeg() } },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errors: { [b.id]: 'El código debe tener de 1 a 4 letras o números.' } });
    expect(team_(a).name).toBe('Alpha');
    expect(store.keys()).toEqual([]);
  });

  it('a bad image is an error on its row; the rest of the batch is not saved either', async () => {
    const res = await send(
      [rowOf(a, { name: 'Bien' }), rowOf(b, { emblem: 'image', imageField: 'image_b' })],
      { images: { image_b: Buffer.from('esto es texto') } },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errors: { [b.id]: WRONG } });
    expect(team_(a).name).toBe('Alpha');
    expect(store.keys()).toEqual([]);
  });

  it('teams of another tournament cannot be touched', async () => {
    const other = t.repo.createTournament({ name: 'Otra', slug: 'otra' });
    const foreign = t.repo.createTeam(other.id, { code: 'ZZ', name: 'Foreign' });
    const res = await send([rowOf(foreign, { name: 'Hackeado' })]);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errors: { [foreign.id]: 'Equipo no encontrado.' } });
    expect(t.repo.getTeam(foreign.id)!.name).toBe('Foreign');
  });

  it('an empty or malformed request is a clear error', async () => {
    expect((await send([])).status).toBe(400);
    expect(await (await send([])).json()).toEqual({ error: 'No hay cambios que guardar.' });
    const bad = await send([], { rawRows: '{not json' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Solicitud no válida.' });
    expect((await send([], { rawRows: '{"id":1}' })).status).toBe(400);
  });
});

describe('storing, committing and cleaning up', () => {
  it('old objects are deleted only after the new state is committed', async () => {
    await send([rowOf(b, { emblem: 'image', imageField: 'image_b' })], { images: { image_b: await jpeg() } });
    const first = team_(b).imageKey!;
    const seenAtDelete: (string | null)[] = [];
    store.onDelete = () => seenAtDelete.push(team_(b).imageKey);
    await send([rowOf(b, { emblem: 'image', imageField: 'image_b' })], { images: { image_b: await jpeg(800, 800) } });
    const second = team_(b).imageKey!;
    expect(second).not.toBe(first);
    expect(seenAtDelete).toEqual([second, second]);
    expect(store.keys()).toEqual(pair(second));
  });

  it('a failing cleanup of the old image never blocks the save', async () => {
    await send([rowOf(b, { emblem: 'image', imageField: 'image_b' })], { images: { image_b: await jpeg() } });
    store.failDelete = true;
    const res = await send([rowOf(b, { emblem: 'image', imageField: 'image_b' })], { images: { image_b: await jpeg(700, 500) } });
    expect(res.status).toBe(200);
  });

  it('a failing storage changes nothing and leaves no orphans', async () => {
    await send([rowOf(b, { emblem: 'image', imageField: 'image_b' })], { images: { image_b: await jpeg() } });
    const before = [team_(a), team_(b)];
    const objectsBefore = store.keys();
    store.failPut = true;
    const res = await send(
      [rowOf(a, { name: 'No debe guardarse' }), rowOf(b, { emblem: 'image', imageField: 'image_b' })],
      { images: { image_b: await jpeg() } },
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'No se pudo guardar la imagen. Inténtalo de nuevo.' });
    expect([team_(a), team_(b)]).toEqual(before);
    expect(store.keys()).toEqual(objectsBefore);
  });

  it('if the database transaction fails, the objects just uploaded are deleted and nothing changes', async () => {
    const before = [team_(a), team_(b)];
    t.repo.saveTeamsBatch = () => {
      throw new Error('disk full');
    };
    const res = await send(
      [rowOf(a, { name: 'No debe guardarse' }), rowOf(b, { emblem: 'image', imageField: 'image_b' })],
      { images: { image_b: await jpeg() } },
    );
    expect(res.status).toBe(500);
    expect(store.keys()).toEqual([]);
    expect([team_(a), team_(b)]).toEqual(before);
  });

  it('the batch is one transaction: a failure half way rolls every row back', async () => {
    // The database itself refuses the second row, after the first one was already written.
    t.db.exec("CREATE TRIGGER fail_second BEFORE UPDATE OF name ON teams WHEN NEW.name = 'Boom' BEGIN SELECT RAISE(ABORT, 'boom'); END");
    const res = await send([rowOf(a, { name: 'Antes' }), rowOf(b, { name: 'Boom' })]);
    expect(res.status).toBe(500);
    expect(team_(a)).toMatchObject({ name: 'Alpha', code: 'AA', hero: 'axe' });
    expect(team_(b)).toMatchObject({ name: 'Bravo', code: 'BB' });
  });

  it('concurrent batches replacing the same image end with exactly one pair and each old object deleted once', async () => {
    await send([rowOf(b, { emblem: 'image', imageField: 'image_b' })], { images: { image_b: await jpeg() } });
    const original = team_(b).imageKey!;
    const [one, two] = await Promise.all([
      send([rowOf(b, { emblem: 'image', imageField: 'image_b' })], { images: { image_b: await jpeg(800, 800) } }),
      send([rowOf(b, { emblem: 'image', imageField: 'image_b' })], { images: { image_b: await jpeg(700, 500) } }),
    ]);
    expect([one.status, two.status]).toEqual([200, 200]);
    const winner = team_(b).imageKey!;
    expect(store.keys()).toEqual(pair(winner));
    const deletedBases = store.deleted.filter((k) => !k.includes('@2x'));
    expect(new Set(deletedBases).size).toBe(2);
    expect(deletedBases).toContain(original);
    expect(deletedBases).not.toContain(winner);
  });

  it('a team deleted while its image is being stored leaves no objects behind', async () => {
    store.beforePut = () => {
      store.beforePut = null;
      t.repo.deleteTeam(b.id);
    };
    const res = await send([rowOf(b, { emblem: 'image', imageField: 'image_b' })], { images: { image_b: await jpeg() } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errors: { [b.id]: 'Equipo no encontrado.' } });
    expect(store.keys()).toEqual([]);
  });
});

describe('limits and access', () => {
  it('an image over 5 MB that fits in the request limit is an error on its row', async () => {
    const res = await send([rowOf(b, { emblem: 'image', imageField: 'image_b' })], { images: { image_b: Buffer.alloc(5 * 1024 * 1024 + 1024, 1) } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errors: { [b.id]: WRONG } });
  });

  it('pictures over the pixel limits are an error on their row', async () => {
    const tooWide = await sharp({ create: { width: 8100, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
    const res = await send([rowOf(b, { emblem: 'image', imageField: 'image_b' })], { images: { image_b: tooWide } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: Record<string, string> }).errors[b.id]).toContain('demasiado grande');
  });

  it('a request over 30 MB is cut off before it is read', async () => {
    const res = await send([rowOf(b, { emblem: 'image', imageField: 'image_b' })], { images: { image_b: Buffer.alloc(30 * 1024 * 1024 + 4096, 1) } });
    expect(res.status).toBe(413);
    expect(store.keys()).toEqual([]);
  });

  it('several images totalling more than 6 MB are fine (up to the 30 MB cap)', async () => {
    const big = Buffer.concat([await jpeg(), Buffer.alloc(4 * 1024 * 1024)]);
    const res = await send(
      [rowOf(a, { emblem: 'image', imageField: 'image_a' }), rowOf(b, { emblem: 'image', imageField: 'image_b' })],
      { images: { image_a: big, image_b: big } },
    );
    expect(res.status).toBe(200);
  });

  it('needs a login and a same-origin request', async () => {
    const anon = await send([rowOf(a, { name: 'X' })], { cookie: null });
    expect(anon.status).toBe(303);
    expect(anon.headers.get('location')).toBe('/admin/login');
    const foreign = await send([rowOf(a, { name: 'X' })], { headers: { origin: 'http://evil.example' } });
    expect(foreign.status).toBe(403);
    expect(team_(a).name).toBe('Alpha');
  });

  it('batches with images are rate limited per admin; batches without images are not', async () => {
    const small = await jpeg(64, 36);
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await send([rowOf(b, { emblem: 'image', imageField: 'image_b' })], { images: { image_b: small } })).status;
    expect(last).toBe(429);
    expect((await send([rowOf(a, { name: 'Sin imagen' })])).status).toBe(200);
    t.repo.createAdmin('second', await (await import('../src/auth/password.js')).hashPassword('second-pass-1'));
    const other = await t.login('second', 'second-pass-1');
    expect((await send([rowOf(b, { emblem: 'image', imageField: 'image_b' })], { images: { image_b: small }, cookie: other })).status).toBe(200);
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

  it('the single-row save route is gone', async () => {
    const res = await t.post(`/admin/t/${tournament.id}/equipos/${a.id}`, { code: 'AA', name: 'Viejo' }, cookie);
    expect(res.status).toBe(404);
    expect(team_(a).name).toBe('Alpha');
  });
});

describe('deleting a team', () => {
  it('deletes its objects', async () => {
    await send([rowOf(b, { emblem: 'image', imageField: 'image_b' })], { images: { image_b: await jpeg() } });
    expect(store.keys()).toHaveLength(2);
    await t.post(`/admin/t/${tournament.id}/equipos/${b.id}/eliminar`, {}, cookie);
    expect(t.repo.getTeam(b.id)).toBeUndefined();
    expect(store.keys()).toEqual([]);
  });

  it('a team that cannot be deleted keeps its image', async () => {
    await send([rowOf(b, { emblem: 'image', imageField: 'image_b' })], { images: { image_b: await jpeg() } });
    t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: 1, matchNumber: 1, team1Id: a.id, team2Id: b.id });
    await t.post(`/admin/t/${tournament.id}/equipos/${b.id}/eliminar`, {}, cookie);
    expect(t.repo.getTeam(b.id)).toBeDefined();
    expect(store.keys()).toHaveLength(2);
  });
});

describe('without an image store', () => {
  it('an image row answers 503; a batch of fields and heroes still saves', async () => {
    const off = await makeApp({ imageStore: null });
    const c = await off.login();
    const tour = off.repo.createTournament({ name: 'Copa', slug: 'copa' });
    const tm = off.repo.createTeam(tour.id, { code: 'AA', name: 'Alpha' });
    const target = `/admin/t/${tour.id}/equipos/lote`;
    const headers = { origin: 'http://localhost', cookie: c, accept: 'application/json' };
    const withImage = new FormData();
    withImage.append('rows', JSON.stringify([{ id: tm.id, code: 'AA', name: 'Alpha', captain: '', hero: null, emblem: 'image', imageField: 'image_1' }]));
    withImage.append('image_1', new Blob([await jpeg()], { type: 'image/webp' }), 'a.webp');
    const res = await off.app.request(target, { method: 'POST', body: withImage, headers });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain('no están disponibles');
    const fieldsOnly = new FormData();
    fieldsOnly.append('rows', JSON.stringify([{ id: tm.id, code: 'AA', name: 'Solo campos', captain: '', hero: 'lina', emblem: 'hero' }]));
    expect((await off.app.request(target, { method: 'POST', body: fieldsOnly, headers })).status).toBe(200);
    expect(off.repo.getTeam(tm.id)).toMatchObject({ name: 'Solo campos', hero: 'lina' });
    off.db.close();
  });
});
