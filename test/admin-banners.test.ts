import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Banner, NewBanner, Tournament } from '../src/db/repository.js';
import { flashText, makeApp, type TestApp } from './helpers/app.js';
import { MemoryImageStore } from './helpers/memory-store.js';

const NOW = new Date('2026-10-17T12:00:00Z'); // 07:00 in Lima

let t: TestApp;
let cookie: string;
let store: MemoryImageStore;
let tournament: Tournament;
let base: string;

beforeEach(async () => {
  store = new MemoryImageStore();
  t = await makeApp({ imageStore: store, now: () => NOW });
  cookie = await t.login();
  tournament = t.repo.createTournament({ name: 'Torneo Oct', slug: 'torneo-oct' });
  base = `/admin/t/${tournament.id}/banners`;
});
afterEach(() => t.db.close());

const png = (width = 1000, height = 500) =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 60, b: 120 } } }).png().toBuffer();

const FIELDS = {
  name: 'Grand Final',
  alt_text: 'Grand Final BO5: EgoBoys vs Butterfly Effect',
  starts_at: '',
  ends_at: '',
  cta_text: 'Ver playoffs',
  cta_tab: 'playoffs',
  active: '1',
};

interface SendOptions {
  fields?: Record<string, string>;
  image?: Buffer | Uint8Array | null;
  path?: string;
  cookie?: string;
}

/** The form as the browser sends it: multipart, with the picture as a file part. */
const submit = async (opts: SendOptions = {}) => {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...FIELDS, ...opts.fields })) form.append(key, value);
  if (opts.image !== null) form.append('image', new File([new Uint8Array(opts.image ?? (await png()))], 'banner.png', { type: 'image/png' }));
  return t.app.request(opts.path ?? base, {
    method: 'POST',
    body: form,
    headers: { origin: 'http://localhost', cookie: opts.cookie ?? cookie },
  });
};

const banner = (over: Partial<NewBanner> = {}, tid = tournament.id): Banner =>
  t.repo.createBanner(tid, {
    name: 'Banner',
    altText: 'Alt',
    imageKey: `banners/${tid}/seed${Math.random().toString(36).slice(2, 8)}.webp`,
    imageWidth: 1920,
    imageHeight: 1080,
    imageKeySmall: `banners/${tid}/seed${Math.random().toString(36).slice(2, 8)}-1280.webp`,
    imageWidthSmall: 1280,
    ctaText: null,
    ctaTab: null,
    active: true,
    startsAt: null,
    endsAt: null,
    ...over,
  });

describe('access', () => {
  it('requires a session', async () => {
    const res = await t.get(base);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/login');
    const post = await submit({ cookie: '' });
    expect(post.status).toBe(303);
    expect(t.repo.listBanners(tournament.id)).toHaveLength(0);
  });

  it('adds Banners to the tournament sidebar right after Reglas', async () => {
    const html = await (await t.get(base, cookie)).text();
    const nav = html.slice(html.indexOf('aria-label="Secciones"'));
    const reglas = nav.indexOf(`/admin/t/${tournament.id}/reglas`);
    const banners = nav.indexOf(`/admin/t/${tournament.id}/banners`);
    const equipos = nav.indexOf(`/admin/t/${tournament.id}/equipos`);
    expect(reglas).toBeGreaterThan(-1);
    expect(banners).toBeGreaterThan(reglas);
    expect(equipos).toBeGreaterThan(banners);
  });
});

describe('list', () => {
  it('says so when there are no banners', async () => {
    const html = await (await t.get(base, cookie)).text();
    expect(html).toContain('Banners de inicio');
    expect(html).toContain('Aún no hay banners.');
  });

  it('shows thumbnail, name, window in the tournament zone, button and state', async () => {
    banner({ name: 'Grand Final', startsAt: '2026-10-16T23:00:00Z', endsAt: '2026-10-18T04:59:00Z', ctaText: 'Ver playoffs', ctaTab: 'playoffs', imageKeySmall: 'banners/1/live-1280.webp' });
    const html = await (await t.get(base, cookie)).text();
    expect(html).toContain('Grand Final');
    expect(html).toContain('16/10 18:00 → 17/10 23:59');
    expect(html).toContain('hora de America/Lima');
    expect(html).toContain('«Ver playoffs» → <b>Playoffs</b>');
    expect(html).toContain('https://images.example/banners/1/live-1280.webp');
    expect(html).toContain('Mostrándose ahora');
  });

  it('labels the four states', async () => {
    banner({ name: 'A', startsAt: '2026-10-10T00:00:00Z', endsAt: '2026-10-11T00:00:00Z' });
    banner({ name: 'B', startsAt: '2026-10-18T00:00:00Z', endsAt: '2026-10-19T00:00:00Z' });
    banner({ name: 'C', active: false });
    banner({ name: 'D', startsAt: '2026-10-17T00:00:00Z', endsAt: '2026-10-18T00:00:00Z' });
    const html = await (await t.get(base, cookie)).text();
    for (const label of ['Terminado', 'Programado', 'Inactivo', 'Mostrándose ahora']) expect(html).toContain(label);
  });

  it('shows "Sin fechas" and "Sin botón" for a plain banner', async () => {
    banner();
    const html = await (await t.get(base, cookie)).text();
    expect(html).toContain('Sin fechas');
    expect(html).toContain('Sin botón');
  });

  it('offers edit, toggle and delete with a confirmation', async () => {
    const b = banner();
    const html = await (await t.get(base, cookie)).text();
    expect(html).toContain(`${base}/${b.id}/editar`);
    expect(html).toContain(`action="${base}/${b.id}/activo"`);
    expect(html).toContain('Desactivar');
    expect(html).toContain(`action="${base}/${b.id}/eliminar"`);
    expect(html).toContain('data-confirm-open');
  });

  it('only lists the banners of this tournament', async () => {
    const other = t.repo.createTournament({ name: 'Otro', slug: 'otro' });
    banner({ name: 'Ajeno' }, other.id);
    expect(await (await t.get(base, cookie)).text()).not.toContain('Ajeno');
  });
});

describe('create form', () => {
  it('has every control, with the five tabs and "Solo cerrar"', async () => {
    const html = await (await t.get(`${base}/nuevo`, cookie)).text();
    expect(html).toContain('type="file"');
    expect(html).toContain('name="name"');
    expect(html).toContain('name="alt_text"');
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain('name="starts_at"');
    expect(html).toContain('name="ends_at"');
    expect(html).toContain('name="cta_text"');
    for (const label of ['Solo cerrar', 'Partidos', 'En vivo', 'Posiciones', 'Playoffs', 'Reglas']) expect(html).toContain(label);
    expect(html).toMatch(/<input[^>]*name="active"[^>]*checked/);
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).toContain('Hora del torneo (America/Lima)');
  });
});

describe('creating', () => {
  it('stores two WebP files and the banner, converting the tournament-zone dates to UTC', async () => {
    const res = await submit({ image: await png(2400, 1200), fields: { starts_at: '2026-10-16T18:00', ends_at: '2026-10-17T23:59' } });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(base);
    const [b] = t.repo.listBanners(tournament.id);
    expect(b).toMatchObject({
      name: 'Grand Final',
      altText: 'Grand Final BO5: EgoBoys vs Butterfly Effect',
      ctaText: 'Ver playoffs',
      ctaTab: 'playoffs',
      active: true,
      startsAt: '2026-10-16T23:00:00Z',
      endsAt: '2026-10-18T04:59:00Z',
      imageWidth: 1920,
      imageHeight: 960,
      imageWidthSmall: 1280,
    });
    expect(b!.imageKey).toMatch(new RegExp(`^banners/${tournament.id}/[0-9a-f]{12}[.]webp$`));
    expect(b!.imageKeySmall).toBe(b!.imageKey.replace('.webp', '-1280.webp'));
    expect(store.keys()).toEqual([b!.imageKey, b!.imageKeySmall].sort());
    for (const key of store.keys()) expect(store.objects.get(key)).toMatchObject({ contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' });
    expect(await sharp(store.objects.get(b!.imageKey)!.bytes).metadata()).toMatchObject({ format: 'webp', width: 1920 });
    expect(await sharp(store.objects.get(b!.imageKeySmall)!.bytes).metadata()).toMatchObject({ format: 'webp', width: 1280 });
    expect(await flashText(t, res, cookie)).toContain('Banner «Grand Final» creado.');
  });

  it('accepts a banner with no dates and no button', async () => {
    const res = await submit({ fields: { cta_text: '', cta_tab: '' } });
    expect(res.status).toBe(303);
    expect(t.repo.listBanners(tournament.id)[0]).toMatchObject({ ctaText: null, ctaTab: null, startsAt: null, endsAt: null });
  });

  it('accepts a button with text that only closes', async () => {
    await submit({ fields: { cta_text: 'Entendido', cta_tab: '' } });
    expect(t.repo.listBanners(tournament.id)[0]).toMatchObject({ ctaText: 'Entendido', ctaTab: null });
  });

  it('stores an unchecked "Activo" as inactive', async () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ ...FIELDS, active: '' })) if (key !== 'active') form.append(key, value);
    form.append('image', new File([new Uint8Array(await png())], 'b.png', { type: 'image/png' }));
    await t.app.request(base, { method: 'POST', body: form, headers: { origin: 'http://localhost', cookie } });
    expect(t.repo.listBanners(tournament.id)[0]!.active).toBe(false);
  });

  const rejects = async (opts: SendOptions, message: string) => {
    const res = await submit(opts);
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain(message);
    expect(t.repo.listBanners(tournament.id)).toHaveLength(0);
    expect(store.keys()).toHaveLength(0);
    return html;
  };

  it('requires an image', async () => {
    const html = await rejects({ image: null }, 'Sube una imagen para el banner.');
    expect(html).toContain('value="Grand Final"'); // typed values are kept
  });

  it('requires a name and an alt text', async () => {
    await rejects({ fields: { name: '  ' } }, 'El nombre es obligatorio (máximo 80 caracteres).');
    await rejects({ fields: { alt_text: '' } }, 'El texto alternativo es obligatorio (máximo 200 caracteres).');
  });

  it('rejects something that is not a picture', async () => {
    await rejects({ image: Buffer.from('not an image') }, 'La imagen debe ser JPG, PNG o WebP de hasta 10 MB.');
  });

  it('rejects an end that is not after the start', async () => {
    await rejects({ fields: { starts_at: '2026-10-18T10:00', ends_at: '2026-10-18T10:00' } }, 'La fecha «Hasta» debe ser posterior a «Mostrar desde».');
    await rejects({ fields: { starts_at: '2026-10-18T10:00', ends_at: '2026-10-17T10:00' } }, 'La fecha «Hasta» debe ser posterior a «Mostrar desde».');
  });

  it('rejects an invalid date', async () => {
    await rejects({ fields: { starts_at: '2026-13-45T10:00' } }, 'La fecha «Mostrar desde» no es válida.');
  });

  it('rejects a button destination without text and an unknown destination', async () => {
    await rejects({ fields: { cta_text: '', cta_tab: 'playoffs' } }, 'Escribe el texto del botón para que lleve a «Playoffs».');
    await rejects({ fields: { cta_tab: 'inicio' } }, 'Elige una pestaña válida para el botón.');
  });

  it('rejects a button text over 40 characters', async () => {
    await rejects({ fields: { cta_text: 'x'.repeat(41) } }, 'El texto del botón admite hasta 40 caracteres.');
  });

  it('refuses a second banner whose dates overlap an active one and names it', async () => {
    banner({ name: '¡Campeón!', startsAt: '2026-10-18T05:00:00Z', endsAt: '2026-10-26T04:59:00Z' });
    const res = await submit({ fields: { starts_at: '2026-10-18T00:00', ends_at: '2026-10-18T02:00' } });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('Se cruza con «¡Campeón!» (18/10 00:00 → 25/10 23:59). Ajusta las fechas o desactiva uno de los dos.');
    expect(t.repo.listBanners(tournament.id)).toHaveLength(1);
    expect(store.keys()).toHaveLength(0);
  });

  it('two banners with no dates overlap', async () => {
    banner({ name: 'Primero' });
    const res = await submit();
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Se cruza con «Primero» (sin fechas).');
  });

  it('lets an inactive banner overlap, and touching windows coexist', async () => {
    banner({ name: 'Uno', startsAt: '2026-10-18T05:00:00Z', endsAt: '2026-10-19T05:00:00Z' });
    expect((await submit({ fields: { active: "", starts_at: "2026-10-18T00:00", ends_at: "2026-10-18T12:00" } })).status).toBe(303);
    expect((await submit({ fields: { starts_at: '2026-10-19T00:00', ends_at: '2026-10-20T00:00' } })).status).toBe(303);
    expect(t.repo.listBanners(tournament.id)).toHaveLength(3);
  });

  it('does not overlap with a banner of another tournament', async () => {
    const other = t.repo.createTournament({ name: 'Otro', slug: 'otro' });
    banner({ name: 'Ajeno' }, other.id);
    expect((await submit()).status).toBe(303);
  });

  it('cleans up the stored files when the database insert fails', async () => {
    t.db.exec('DROP TRIGGER IF EXISTS fail_banner; CREATE TRIGGER fail_banner BEFORE INSERT ON promo_banners BEGIN SELECT RAISE(ABORT, \'boom\'); END;');
    const res = await submit();
    expect(res.status).toBe(500);
    expect(store.keys()).toHaveLength(0);
  });

  it('answers 503 when the server has no image store', async () => {
    const bare = await makeApp({ now: () => NOW });
    const c = await bare.login();
    const tn = bare.repo.createTournament({ name: 'X', slug: 'x' });
    const form = new FormData();
    for (const [key, value] of Object.entries(FIELDS)) form.append(key, value);
    form.append('image', new File([new Uint8Array(await png())], 'b.png', { type: 'image/png' }));
    const res = await bare.app.request(`/admin/t/${tn.id}/banners`, { method: 'POST', body: form, headers: { origin: 'http://localhost', cookie: c } });
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('Las imágenes no están disponibles en este servidor.');
    bare.db.close();
  });
});

describe('editing', () => {
  const create = async (fields: Record<string, string> = {}) => {
    await submit({ fields });
    return t.repo.listBanners(tournament.id)[0]!;
  };

  it('shows the form filled in, with the current picture and the dates in the tournament zone', async () => {
    const b = await create({ starts_at: '2026-10-16T18:00', ends_at: '2026-10-17T23:59' });
    const html = await (await t.get(`${base}/${b.id}/editar`, cookie)).text();
    expect(html).toContain('value="Grand Final"');
    expect(html).toContain('value="2026-10-16T18:00"');
    expect(html).toContain('value="2026-10-17T23:59"');
    expect(html).toContain(`https://images.example/${b.imageKey}`);
    expect(html).toMatch(/<option value="playoffs" selected/);
    expect(html).toContain('Borrar banner');
  });

  it('keeps the stored files when no new image is uploaded, and bumps the version', async () => {
    const b = await create();
    const before = store.keys();
    const res = await submit({ path: `${base}/${b.id}`, image: null, fields: { name: 'Renombrado', ctaText: '' } });
    expect(res.status).toBe(303);
    const after = t.repo.getBanner(b.id)!;
    expect(after).toMatchObject({ name: 'Renombrado', imageKey: b.imageKey, imageKeySmall: b.imageKeySmall, version: 2 });
    expect(store.keys()).toEqual(before);
    expect(store.deleted).toEqual([]);
  });

  it('replaces the picture and deletes the old files', async () => {
    const b = await create();
    const res = await submit({ path: `${base}/${b.id}`, image: await png(1300, 700) });
    expect(res.status).toBe(303);
    const after = t.repo.getBanner(b.id)!;
    expect(after.imageKey).not.toBe(b.imageKey);
    expect(after.imageWidth).toBe(1300);
    expect(store.keys()).toEqual([after.imageKey, after.imageKeySmall].sort());
    expect(store.deleted.sort()).toEqual([b.imageKey, b.imageKeySmall].sort());
  });

  it('does not conflict with itself when only its text changes', async () => {
    const b = await create({ starts_at: '2026-10-16T18:00', ends_at: '2026-10-17T23:59' });
    const res = await submit({ path: `${base}/${b.id}`, image: null, fields: { starts_at: '2026-10-16T18:00', ends_at: '2026-10-17T23:59', name: 'Otro nombre' } });
    expect(res.status).toBe(303);
  });

  it('rejects dates that now overlap another active banner and changes nothing', async () => {
    banner({ name: 'Otro', startsAt: '2026-10-20T05:00:00Z', endsAt: '2026-10-22T05:00:00Z' });
    const b = await create({ starts_at: '2026-10-16T18:00', ends_at: '2026-10-17T23:59' });
    const res = await submit({ path: `${base}/${b.id}`, image: await png(), fields: { starts_at: '2026-10-21T00:00', ends_at: '2026-10-21T12:00' } });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Se cruza con «Otro»');
    expect(t.repo.getBanner(b.id)).toEqual(b);
    expect(store.keys()).toEqual([b.imageKey, b.imageKeySmall].sort()); // the rejected upload was never stored
  });

  it('404s for a banner of another tournament', async () => {
    const other = t.repo.createTournament({ name: 'Otro', slug: 'otro' });
    const foreign = banner({}, other.id);
    expect((await t.get(`${base}/${foreign.id}/editar`, cookie)).status).toBe(404);
    expect((await submit({ path: `${base}/${foreign.id}` })).status).toBe(404);
    expect((await t.post(`${base}/${foreign.id}/activo`, {}, cookie)).status).toBe(404);
    expect((await t.post(`${base}/${foreign.id}/eliminar`, {}, cookie)).status).toBe(404);
    expect(t.repo.getBanner(foreign.id)).toBeDefined();
  });
});

describe('toggling', () => {
  it('turns an active banner off and back on', async () => {
    const b = banner();
    const off = await t.post(`${base}/${b.id}/activo`, {}, cookie);
    expect(off.status).toBe(303);
    expect(t.repo.getBanner(b.id)!.active).toBe(false);
    expect(await flashText(t, off, cookie)).toContain('Banner «Banner» desactivado.');
    const on = await t.post(`${base}/${b.id}/activo`, {}, cookie);
    expect(t.repo.getBanner(b.id)!.active).toBe(true);
    expect(await flashText(t, on, cookie)).toContain('Banner «Banner» activado.');
  });

  it('refuses to activate a banner that would overlap an active one', async () => {
    banner({ name: 'En aire' });
    const sleeping = banner({ name: 'Dormido', active: false });
    const res = await t.post(`${base}/${sleeping.id}/activo`, {}, cookie);
    expect(res.status).toBe(303);
    expect(t.repo.getBanner(sleeping.id)!.active).toBe(false);
    expect(await flashText(t, res, cookie)).toContain('Se cruza con «En aire» (sin fechas).');
  });
});

describe('deleting', () => {
  it('removes the banner and both stored files', async () => {
    await submit();
    const b = t.repo.listBanners(tournament.id)[0]!;
    const res = await t.post(`${base}/${b.id}/eliminar`, {}, cookie);
    expect(res.status).toBe(303);
    expect(t.repo.getBanner(b.id)).toBeUndefined();
    expect(store.keys()).toHaveLength(0);
    expect(store.deleted.sort()).toEqual([b.imageKey, b.imageKeySmall].sort());
    expect(await flashText(t, res, cookie)).toContain('Banner «Grand Final» eliminado.');
  });

  it('still deletes the banner when the store cannot delete the files', async () => {
    await submit();
    const b = t.repo.listBanners(tournament.id)[0]!;
    store.failDelete = true;
    const res = await t.post(`${base}/${b.id}/eliminar`, {}, cookie);
    expect(res.status).toBe(303);
    expect(t.repo.getBanner(b.id)).toBeUndefined();
  });
});

describe('request size limits', () => {
  it('lets the banner upload paths carry a large body but keeps every other form small', async () => {
    const big = new Uint8Array(200 * 1024);
    const form = () => {
      const f = new FormData();
      f.append('pad', new File([big], 'pad.bin'));
      return f;
    };
    const post = (path: string) => t.app.request(path, { method: 'POST', body: form(), headers: { origin: 'http://localhost', cookie } });
    expect((await post(`/admin/t/${tournament.id}/reglas`)).status).toBe(413);
    expect((await post(base)).status).not.toBe(413);
    expect((await post(`${base}/1`)).status).not.toBe(413);
  });

  it('rejects a banner request over 11 MB', async () => {
    const f = new FormData();
    f.append('image', new File([new Uint8Array(11 * 1024 * 1024 + 1024)], 'big.png'));
    const res = await t.app.request(base, { method: 'POST', body: f, headers: { origin: 'http://localhost', cookie } });
    expect(res.status).toBe(413);
  });

  it('team emblem batches keep their own larger limit', async () => {
    const team = t.repo.createTeam(tournament.id, { code: 'AA', name: 'Alpha' });
    const f = new FormData();
    f.append('rows', JSON.stringify([{ id: team.id, code: 'AA', name: 'Alpha', captain: '', hero: null, emblem: 'keep' }]));
    f.append('pad', new File([new Uint8Array(200 * 1024)], 'pad.bin'));
    const res = await t.app.request(`/admin/t/${tournament.id}/equipos/lote`, { method: 'POST', body: f, headers: { origin: 'http://localhost', cookie, accept: 'application/json' } });
    expect(res.status).toBe(200);
  });
});
