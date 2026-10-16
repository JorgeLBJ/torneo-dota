import type { FC } from 'hono/jsx';
import type { Banner, Tournament } from '../../db/repository.js';
import { BANNER_TABS, bannerState, bannerTabLabel, formatBannerWindow, type BannerState } from '../../domain/banners.js';
import { PageHead, Select } from './parts.js';

const STATE_PILLS: Record<BannerState, { cls: string; label: string }> = {
  showing: { cls: 'pill ok', label: '● Mostrándose ahora' },
  scheduled: { cls: 'pill next', label: 'Programado' },
  ended: { cls: 'pill', label: 'Terminado' },
  inactive: { cls: 'pill', label: 'Inactivo' },
};

const MAX_BANNER_MB = 10;

/** What the form shows; strings, exactly as the browser sends them (so a rejected save can be shown again). */
export interface BannerFormValues {
  name: string;
  alt_text: string;
  /** datetime-local value in the tournament's zone ("2026-10-16T18:00") or ''. */
  starts_at: string;
  ends_at: string;
  cta_text: string;
  cta_tab: string;
  active: boolean;
}

export const emptyBannerValues = (): BannerFormValues => ({
  name: '',
  alt_text: '',
  starts_at: '',
  ends_at: '',
  cta_text: '',
  cta_tab: '',
  active: true,
});

export const BannersView: FC<{
  tournament: Tournament;
  banners: Banner[];
  now: Date;
  /** Public URL of a stored object, or null when the server has no image store. */
  imageUrl: ((key: string) => string) | null;
}> = ({ tournament, banners, now, imageUrl }) => {
  const base = `/admin/t/${tournament.id}/banners`;
  return (
    <>
      <PageHead
        title="Banners de inicio"
        sub="Imagen que se abre como ventana al entrar a la página pública. Se muestra una vez por visita; solo puede haber uno vigente a la vez."
      >
        <a class="btn pri" href={`${base}/nuevo`}>
          Nuevo banner
        </a>
      </PageHead>
      <section class="card stack">
        <h2>Banners del torneo</h2>
        <div class="scroll-x">
          <table class="cards">
            <thead>
              <tr>
                <th>Imagen</th>
                <th>Nombre</th>
                <th>Se muestra</th>
                <th>Botón lleva a</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {banners.length === 0 ? (
                <tr>
                  <td colspan={6} class="muted">
                    Aún no hay banners.
                  </td>
                </tr>
              ) : null}
              {banners.map((b) => {
                const state = bannerState(b, now);
                const pill = STATE_PILLS[state];
                return (
                  <tr class={state === 'showing' ? 'row-live' : undefined}>
                    <td data-label="Imagen">
                      {imageUrl ? (
                        <img class="banner-thumb" src={imageUrl(b.imageKeySmall)} alt="" width={128} height={Math.round((128 * b.imageHeight) / b.imageWidth)} loading="lazy" />
                      ) : (
                        <span class="banner-thumb ph">Sin imagen</span>
                      )}
                    </td>
                    <td data-label="Nombre">
                      <b>{b.name}</b>
                      <div class="muted">
                        {b.imageWidth}×{b.imageHeight} · WebP
                      </div>
                    </td>
                    <td data-label="Se muestra">
                      {formatBannerWindow(b, tournament.timezone)}
                      {b.startsAt || b.endsAt ? <div class="muted">hora de {tournament.timezone}</div> : null}
                    </td>
                    <td data-label="Botón lleva a">
                      {b.ctaText ? (
                        <>
                          «{b.ctaText}» → <b>{b.ctaTab ? bannerTabLabel(b.ctaTab) : 'Solo cierra'}</b>
                        </>
                      ) : (
                        'Sin botón'
                      )}
                    </td>
                    <td data-label="Estado">
                      <span class={pill.cls}>{pill.label}</span>
                    </td>
                    <td>
                      <div class="actions banner-actions">
                        <a class="btn sm" href={`${base}/${b.id}/editar`}>
                          Editar
                        </a>
                        <form method="post" action={`${base}/${b.id}/activo`}>
                          <button class="btn sm" type="submit">
                            {b.active ? 'Desactivar' : 'Activar'}
                          </button>
                        </form>
                        <DeleteForm base={base} banner={b} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div class="legend muted">
          <span>
            <b>Mostrándose ahora</b>: activo y dentro de sus fechas.
          </span>
          <span>
            <b>Programado</b>: activo, empieza más adelante.
          </span>
          <span>
            <b>Terminado</b>: su fecha de fin ya pasó.
          </span>
          <span>
            <b>Inactivo</b>: apagado a mano; no se muestra aunque esté en fechas.
          </span>
        </div>
      </section>
    </>
  );
};

const DeleteForm: FC<{ base: string; banner: Banner; large?: boolean }> = ({ base, banner, large }) => (
  <form method="post" action={`${base}/${banner.id}/eliminar`}>
    <button class={`btn danger${large ? '' : ' sm'}`} type="submit" data-confirm-open={`deleteBanner${banner.id}`}>
      {large ? 'Borrar banner' : 'Borrar'}
    </button>
    <dialog id={`deleteBanner${banner.id}`} class="confirm-modal" aria-labelledby={`deleteBannerTitle${banner.id}`}>
      <h2 id={`deleteBannerTitle${banner.id}`}>¿Borrar «{banner.name}»?</h2>
      <p>Se elimina el banner y sus imágenes. No se puede deshacer.</p>
      <div class="actions">
        <button class="btn" type="button" autofocus data-confirm-cancel>
          Cancelar
        </button>
        <button class="btn pri" type="submit">
          Borrar banner
        </button>
      </div>
    </dialog>
  </form>
);

export const BannerFormView: FC<{
  tournament: Tournament;
  /** Present when editing. */
  banner?: Banner;
  values: BannerFormValues;
  error?: string;
  imageUrl: ((key: string) => string) | null;
  /** Public page of the tournament, for "Ver en la página pública". */
  publicUrl: string;
}> = ({ tournament, banner, values, error, imageUrl, publicUrl }) => {
  const base = `/admin/t/${tournament.id}/banners`;
  const editing = banner !== undefined;
  const current = banner && imageUrl ? imageUrl(banner.imageKey) : null;
  return (
    <>
      <PageHead title={editing ? `Editar banner · ${banner.name}` : 'Nuevo banner'} sub="Se abre como ventana al entrar a la página pública del torneo.">
        <a class="btn" href={base}>
          Volver a Banners
        </a>
      </PageHead>
      <form id="bannerForm" class="card banner-grid" method="post" action={editing ? `${base}/${banner.id}` : base} enctype="multipart/form-data" data-banner-form>
        <div class="stack">
          <div class="drop">
            {current ? <img src={current} alt="Imagen actual del banner" width={banner!.imageWidth} height={banner!.imageHeight} data-banner-preview-img /> : <div class="banner-thumb ph" data-banner-preview-empty>Sin imagen</div>}
            <label class="f">
              {editing ? 'Cambiar imagen (opcional)' : 'Imagen del banner'}
              <input type="file" name="image" accept="image/jpeg,image/png,image/webp" data-banner-file />
            </label>
            <small class="muted">
              PNG/JPG/WebP hasta {MAX_BANNER_MB} MB · se convierte a WebP y se ofrece en 1920 y 1280 px de ancho, sin recortar.
            </small>
          </div>
          <label class="f">
            Texto alternativo (accesibilidad)
            <input name="alt_text" value={values.alt_text} required maxlength={200} />
          </label>
          <div class="stack">
            <small class="muted">Vista previa</small>
            <div class="mini-preview">
              {current ? <img src={current} alt="" data-banner-preview-img-2 /> : <div class="banner-thumb ph" data-banner-preview-empty-2>Sin imagen</div>}
              <span class="cta-preview" data-banner-cta-preview hidden={values.cta_text === ''}>
                {values.cta_text}
              </span>
            </div>
          </div>
        </div>
        <div class="stack">
          <label class="f">
            Nombre (solo para el admin)
            <input name="name" value={values.name} required maxlength={80} />
          </label>
          <div class="banner-two">
            <label class="f">
              Mostrar desde
              <input type="datetime-local" name="starts_at" value={values.starts_at} />
            </label>
            <label class="f">
              Hasta
              <input type="datetime-local" name="ends_at" value={values.ends_at} />
            </label>
          </div>
          <small class="muted">Hora del torneo ({tournament.timezone}). Sin fechas = se muestra mientras esté activo.</small>
          <div class="banner-two">
            <label class="f">
              Texto del botón
              <input name="cta_text" value={values.cta_text} maxlength={40} placeholder="Ver playoffs" data-banner-cta-text />
            </label>
            <label class="f">
              El botón lleva a
              <Select name="cta_tab">
                <option value="" selected={values.cta_tab === ''}>
                  Solo cerrar
                </option>
                {BANNER_TABS.map((tab) => (
                  <option value={tab.key} selected={values.cta_tab === tab.key}>
                    {tab.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <label class="f check">
            <input type="checkbox" name="active" value="1" checked={values.active} />
            <span>
              <b>Activo</b> · se mostrará en sus fechas
            </span>
          </label>
          {error ? (
            <div class="flash error" role="alert">
              <b>No se puede guardar:</b> {error}
            </div>
          ) : null}
        </div>
      </form>
      <div class="banner-foot">
        {banner ? <DeleteForm base={base} banner={banner} large /> : <span></span>}
        <div class="actions">
          <a class="btn" href={publicUrl} target="_blank" rel="noopener">
            Ver en la página pública ↗
          </a>
          <button class="btn pri" type="submit" form="bannerForm">
            Guardar
          </button>
        </div>
      </div>
    </>
  );
};
