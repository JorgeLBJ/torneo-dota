import { Hono, type Context } from 'hono';
import type { Banner, BannerUpdate, NewBanner } from '../../db/repository.js';
import { bannerTabLabel, findBannerConflict, formatBannerWindow, isBannerTab, type BannerTab, type BannerWindow } from '../../domain/banners.js';
import { processBannerImage } from '../../images/process.js';
import { zonedToUtc, utcToZoned } from '../../format/timezone.js';
import { BannerStorageError, discardImages, storeBannerImages } from '../../storage/banner-images.js';
import type { AdminEnv, Deps } from '../context.js';
import { isDate, readBody, str, type Body } from '../form.js';
import { setFlash } from '../flash.js';
import { publicUrlFor, renderPage } from '../render.js';
import { fail, ok, type Checked } from '../validate.js';
import { BannerFormView, BannersView, emptyBannerValues, type BannerFormValues } from '../views/banners.js';

const CTA_MAX = 40;
const DATETIME_LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/** A datetime-local value read in the tournament's zone -> ISO UTC; null when empty, undefined when invalid. */
function readInstant(value: string, timeZone: string): string | null | undefined {
  if (value === '') return null;
  const match = DATETIME_LOCAL.exec(value);
  if (!match || !isDate(match[1]!) || Number(match[2]) > 23 || Number(match[3]) > 59) return undefined;
  return zonedToUtc(match[1]!, `${match[2]}:${match[3]}`, timeZone);
}

const toLocalInput = (iso: string | null, timeZone: string): string => {
  if (!iso) return '';
  const { date, time } = utcToZoned(iso, timeZone);
  return `${date}T${time}`;
};

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

interface BannerFields extends BannerWindow {
  name: string;
  altText: string;
  ctaText: string | null;
  ctaTab: BannerTab | null;
  active: boolean;
}

/** The text fields of the form; the picture is handled separately. */
function parseFields(body: Body, timeZone: string): Checked<BannerFields> {
  const name = str(body, 'name');
  if (name.length < 1 || name.length > 80) return fail('El nombre es obligatorio (máximo 80 caracteres).');
  const altText = str(body, 'alt_text');
  if (altText.length < 1 || altText.length > 200) return fail('El texto alternativo es obligatorio (máximo 200 caracteres).');
  const startsAt = readInstant(str(body, 'starts_at'), timeZone);
  if (startsAt === undefined) return fail('La fecha «Mostrar desde» no es válida.');
  const endsAt = readInstant(str(body, 'ends_at'), timeZone);
  if (endsAt === undefined) return fail('La fecha «Hasta» no es válida.');
  if (startsAt !== null && endsAt !== null && endsAt <= startsAt) return fail('La fecha «Hasta» debe ser posterior a «Mostrar desde».');
  const ctaText = str(body, 'cta_text');
  if (ctaText.length > CTA_MAX) return fail(`El texto del botón admite hasta ${CTA_MAX} caracteres.`);
  const tab = str(body, 'cta_tab');
  if (tab !== '' && !isBannerTab(tab)) return fail('Elige una pestaña válida para el botón.');
  if (tab !== '' && ctaText === '') return fail(`Escribe el texto del botón para que lleve a «${bannerTabLabel(tab as BannerTab)}».`);
  return ok({
    name,
    altText,
    ctaText: ctaText === '' ? null : ctaText,
    ctaTab: tab === '' ? null : (tab as BannerTab),
    active: str(body, 'active') !== '',
    startsAt,
    endsAt,
  });
}

const valuesOf = (body: Body): BannerFormValues => ({
  name: str(body, 'name'),
  alt_text: str(body, 'alt_text'),
  starts_at: str(body, 'starts_at'),
  ends_at: str(body, 'ends_at'),
  cta_text: str(body, 'cta_text'),
  cta_tab: str(body, 'cta_tab'),
  active: str(body, 'active') !== '',
});

const valuesFromBanner = (banner: Banner, timeZone: string): BannerFormValues => ({
  name: banner.name,
  alt_text: banner.altText,
  starts_at: toLocalInput(banner.startsAt, timeZone),
  ends_at: toLocalInput(banner.endsAt, timeZone),
  cta_text: banner.ctaText ?? '',
  cta_tab: banner.ctaTab ?? '',
  active: banner.active,
});

/** The picture part of the form, or null when none was chosen. */
async function uploadedImage(body: Body): Promise<Uint8Array | null> {
  const value = body['image'];
  const file = Array.isArray(value) ? value[0] : value;
  return file instanceof File && file.size > 0 ? new Uint8Array(await file.arrayBuffer()) : null;
}

export function bannerRoutes(deps: Deps) {
  const app = new Hono<AdminEnv>();
  const { repo } = deps;
  const imageUrl = deps.images ? (key: string) => deps.images!.publicUrl(key) : null;

  const overlapMessage = (other: Banner, timeZone: string): string =>
    `Se cruza con «${other.name}» (${lowerFirst(formatBannerWindow(other, timeZone))}). Ajusta las fechas o desactiva uno de los dos.`;

  /** Loads a banner of the current tournament or undefined. */
  const ownBanner = (tournamentId: number, raw: string | undefined): Banner | undefined => {
    const id = Number(raw);
    const banner = Number.isInteger(id) ? repo.getBanner(id) : undefined;
    return banner && banner.tournamentId === tournamentId ? banner : undefined;
  };

  app.get('/banners', (c) => {
    const tournament = c.get('tournament');
    return renderPage(
      c,
      deps,
      { title: 'Banners', active: 'banners', tournament },
      <BannersView tournament={tournament} banners={repo.listBanners(tournament.id)} now={deps.now()} imageUrl={imageUrl} />,
    );
  });

  app.get('/banners/nuevo', (c) => {
    const tournament = c.get('tournament');
    return renderPage(
      c,
      deps,
      { title: 'Nuevo banner', active: 'banners', tournament },
      <BannerFormView tournament={tournament} values={emptyBannerValues()} imageUrl={imageUrl} publicUrl={publicUrlFor(tournament)} />,
    );
  });

  app.get('/banners/:id/editar', (c) => {
    const tournament = c.get('tournament');
    const banner = ownBanner(tournament.id, c.req.param('id'));
    if (!banner) return c.text('Banner no encontrado.', 404);
    return renderPage(
      c,
      deps,
      { title: 'Editar banner', active: 'banners', tournament },
      <BannerFormView tournament={tournament} banner={banner} values={valuesFromBanner(banner, tournament.timezone)} imageUrl={imageUrl} publicUrl={publicUrlFor(tournament)} />,
    );
  });

  /**
   * Shared by create and update: validates the text fields and the overlap, then decodes the picture (if any).
   * Answers the form again (400) with what was typed when something is wrong.
   */
  const prepare = async (c: Context<AdminEnv>, banner: Banner | undefined) => {
    const tournament = c.get('tournament');
    const body = await readBody(c);
    const reject = (message: string) =>
      renderPage(
        c,
        deps,
        { title: banner ? 'Editar banner' : 'Nuevo banner', active: 'banners', tournament, status: 400 },
        <BannerFormView tournament={tournament} banner={banner} values={valuesOf(body)} error={message} imageUrl={imageUrl} publicUrl={publicUrlFor(tournament)} />,
      );

    const fields = parseFields(body, tournament.timezone);
    if (!fields.ok) return { response: reject(fields.error) };
    const file = await uploadedImage(body);
    if (!file && !banner) return { response: reject('Sube una imagen para el banner.') };
    const conflict = findBannerConflict(repo.listBanners(tournament.id), { id: banner?.id, ...fields.value });
    if (conflict) return { response: reject(overlapMessage(conflict, tournament.timezone)) };

    if (!file) return { fields: fields.value, processed: null };
    if (!deps.images) return { response: c.text('Las imágenes no están disponibles en este servidor.', 503) };
    if (!deps.uploadLimiter.consume(`admin:${c.get('admin').id}`)) return { response: c.text('Demasiadas subidas seguidas: espera un minuto.', 429) };
    const processed = await processBannerImage(file);
    if (!processed.ok) return { response: reject(processed.error) };
    return { fields: fields.value, processed: processed.value };
  };

  app.post('/banners', async (c) => {
    const tournament = c.get('tournament');
    const prepared = await prepare(c, undefined);
    if (prepared.response) return prepared.response;
    const { fields, processed } = prepared;
    const store = deps.images!; // a picture is required on create, so `processed` implies a store
    const stored = await storeBannerImages(store, tournament.id, processed!).catch((error) => {
      if (error instanceof BannerStorageError) return null;
      throw error;
    });
    if (!stored) return c.text('No se pudo guardar la imagen. Inténtalo de nuevo.', 502);
    const input: NewBanner = {
      ...fields!,
      imageKey: stored.key,
      imageWidth: stored.width,
      imageHeight: stored.height,
      imageKeySmall: stored.keySmall,
      imageWidthSmall: stored.widthSmall,
    };
    try {
      repo.createBanner(tournament.id, input);
    } catch (error) {
      await discardImages(store, [stored.key, stored.keySmall]); // the row was not saved: the files are orphans
      throw error;
    }
    setFlash(c, 'ok', `Banner «${fields!.name}» creado.`);
    return c.redirect(`/admin/t/${tournament.id}/banners`, 303);
  });

  app.post('/banners/:id', async (c) => {
    const tournament = c.get('tournament');
    const banner = ownBanner(tournament.id, c.req.param('id'));
    if (!banner) return c.text('Banner no encontrado.', 404);
    const prepared = await prepare(c, banner);
    if (prepared.response) return prepared.response;
    const { fields, processed } = prepared;
    const store = deps.images;

    let stored = null;
    if (processed && store) {
      stored = await storeBannerImages(store, tournament.id, processed).catch((error) => {
        if (error instanceof BannerStorageError) return null;
        throw error;
      });
      if (!stored) return c.text('No se pudo guardar la imagen. Inténtalo de nuevo.', 502);
    }
    const update: BannerUpdate = {
      ...fields!,
      image: stored ? { key: stored.key, width: stored.width, height: stored.height, keySmall: stored.keySmall, widthSmall: stored.widthSmall } : undefined,
    };
    let saved;
    try {
      saved = repo.updateBanner(banner.id, update);
    } catch (error) {
      if (store && stored) await discardImages(store, [stored.key, stored.keySmall]);
      throw error;
    }
    if (!saved) {
      if (store && stored) await discardImages(store, [stored.key, stored.keySmall]); // deleted meanwhile
      return c.text('Banner no encontrado.', 404);
    }
    if (store && stored) await discardImages(store, [banner.imageKey, banner.imageKeySmall]);
    setFlash(c, 'ok', `Banner «${saved.name}» guardado.`);
    return c.redirect(`/admin/t/${tournament.id}/banners`, 303);
  });

  app.post('/banners/:id/activo', (c) => {
    const tournament = c.get('tournament');
    const banner = ownBanner(tournament.id, c.req.param('id'));
    if (!banner) return c.text('Banner no encontrado.', 404);
    const back = `/admin/t/${tournament.id}/banners`;
    if (banner.active) {
      repo.setBannerActive(banner.id, false);
      setFlash(c, 'ok', `Banner «${banner.name}» desactivado.`);
      return c.redirect(back, 303);
    }
    const conflict = findBannerConflict(repo.listBanners(tournament.id), { ...banner, active: true });
    if (conflict) {
      setFlash(c, 'error', overlapMessage(conflict, tournament.timezone));
      return c.redirect(back, 303);
    }
    repo.setBannerActive(banner.id, true);
    setFlash(c, 'ok', `Banner «${banner.name}» activado.`);
    return c.redirect(back, 303);
  });

  app.post('/banners/:id/eliminar', async (c) => {
    const tournament = c.get('tournament');
    const banner = ownBanner(tournament.id, c.req.param('id'));
    if (!banner) return c.text('Banner no encontrado.', 404);
    repo.deleteBanner(banner.id);
    if (deps.images) await discardImages(deps.images, [banner.imageKey, banner.imageKeySmall]);
    setFlash(c, 'ok', `Banner «${banner.name}» eliminado.`);
    return c.redirect(`/admin/t/${tournament.id}/banners`, 303);
  });

  return app;
}
