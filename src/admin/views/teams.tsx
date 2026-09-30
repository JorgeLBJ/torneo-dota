import { useContext } from 'hono/jsx';
import type { FC } from 'hono/jsx';
import { HEROES, getHero } from '../../data/heroes.js';
import type { Team, Tournament } from '../../db/repository.js';
import { teamColor } from './layout.js';
import { assetUrl } from '../../assets.js';
import { resolveEmblem } from '../../domain/emblem.js';
import { EmblemPicture, EmblemSourcesContext } from '../../emblem-view.js';
import { PageHead, heroImage } from './parts.js';

const ATTRS: [string, string][] = [
  ['any', 'Todos'],
  ['str', 'Fuerza'],
  ['agi', 'Agilidad'],
  ['int', 'Inteligencia'],
  ['all', 'Universal'],
];

/** JSON safe to inline in a <script> element (no "</script>" or HTML comment breakouts). */
const inlineJson = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

/**
 * The team's emblem in ONE compact row: thumbnail (custom image, else hero portrait, else code tile), the source of
 * that emblem, and a single "Cambiar" menu. Every change made here is staged in the row by the page script and only
 * saved with the row's "Guardar"; the attributes below are the saved state it restores on "Deshacer".
 */
const EmblemCell: FC<{ formId: string; team?: Team; imagesEnabled: boolean }> = ({ formId, team, imagesEnabled }) => {
  const hero = team?.hero ? getHero(team.hero) : undefined;
  const custom = Boolean(team?.imageKey) && imagesEnabled;
  const label = custom ? 'Imagen propia' : hero ? hero.name : 'Sin emblema';
  // What the viewer shows at real size: the @2x WebP (the 1x as fallback), or the hero's own portrait.
  const emblem = team ? resolveEmblem(team, useContext(EmblemSourcesContext)) : undefined;
  const view =
    team && emblem?.kind === 'image'
      ? { full: emblem.src2x, fallback: emblem.src }
      : team && emblem?.kind === 'hero'
        ? { full: emblem.src, fallback: undefined }
        : undefined;
  return (
    <div
      class="emblem-cell"
      data-emblem-cell
      data-has-image={custom ? '1' : '0'}
      data-saved-src={emblem?.kind === 'image' ? emblem.src : undefined}
      data-saved-src2x={emblem?.kind === 'image' ? emblem.src2x : undefined}
      data-hero-name={hero?.name}
      data-code={team?.code}
      data-color={team ? teamColor(team.id) : undefined}
      data-team-name={team?.name}
    >
      <input type="hidden" name="hero" form={formId} value={team?.hero ?? ''} data-hero-input />
      <input type="hidden" name="clear_image" form={formId} value="" data-clear-image />
      <button
        type="button"
        class="emblem-thumb"
        data-emblem-thumb
        data-emblem-view
        disabled={!view}
        aria-label={view && team ? `Ver emblema de ${team.name}` : undefined}
        data-full={view?.full}
        data-fallback={view?.fallback}
        data-name={team?.name}
        data-source={view ? label : undefined}
      >
        {team && custom ? (
          <EmblemPicture team={team} eager />
        ) : hero ? (
          <img src={heroImage(hero.slug)} alt="" />
        ) : (
          <span class="emblem-code" style={team ? `--tc:${teamColor(team.id)}` : undefined}>
            {team ? team.code : '?'}
          </span>
        )}
      </button>
      <span class="emblem-label" title={label}>
        <span data-emblem-label>{label}</span>
        <span class="unsaved" data-unsaved hidden>
          Sin guardar
        </span>
      </span>
      <details class="emblem-menu" data-emblem-menu>
        <summary class="btn sm">
          Cambiar <span aria-hidden="true">▾</span>
        </summary>
        <div class="emblem-pop" role="group" aria-label="Cambiar emblema">
          <button type="button" data-hero-pick={formId} data-team-id={team ? String(team.id) : ''} data-team-label={team ? team.name : 'el nuevo equipo'}>
            Elegir héroe
          </button>
          {team && imagesEnabled ? (
            <>
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden data-image-file aria-label={`Imagen del equipo ${team.code}`} />
              <button type="button" data-image-pick data-team-label={team.name}>
                Subir imagen
              </button>
              <button type="button" class="danger" data-remove-image data-team-label={team.name} hidden={!custom}>
                Quitar imagen
              </button>
            </>
          ) : null}
        </div>
      </details>
    </div>
  );
};

/** Lightbox for the emblem thumbnails (filled in by admin.js). */
const EmblemViewer: FC = () => (
  <dialog id="emblemViewer" class="viewer-modal" aria-labelledby="emblemViewerCaption">
    <button class="viewer-close" type="button" data-viewer-close aria-label="Cerrar">
      ×
    </button>
    <div class="viewer-scroll">
      <img id="emblemViewerImage" alt="" />
    </div>
    <p id="emblemViewerCaption" class="viewer-caption"></p>
  </dialog>
);

/** Shared confirmations of the emblem menu (filled in by admin.js). */
const EmblemDialogs: FC = () => (
  <>
    <dialog id="removeImageDialog" class="confirm-modal" aria-labelledby="removeImageTitle">
      <h2 id="removeImageTitle">¿Quitar la imagen?</h2>
      <p>
        <span data-remove-team></span> volverá a usar su héroe (o su código si no tiene). Se aplicará cuando guardes la fila.
      </p>
      <div class="actions">
        <button class="btn" type="button" autofocus data-dialog-cancel>
          Cancelar
        </button>
        <button class="btn danger" type="button" data-remove-confirm>
          Quitar imagen
        </button>
      </div>
    </dialog>
    <dialog id="replaceImageDialog" class="confirm-modal" aria-labelledby="replaceImageTitle">
      <h2 id="replaceImageTitle">¿Reemplazar la imagen propia por el héroe?</h2>
      <p>La imagen se quitará cuando guardes la fila; el héroe la sustituye en toda la web.</p>
      <div class="actions">
        <button class="btn" type="button" autofocus data-dialog-cancel>
          Cancelar
        </button>
        <button class="btn pri" type="button" data-replace-confirm>
          Reemplazar por el héroe
        </button>
      </div>
    </dialog>
  </>
);

/** Crop dialog: the admin frames the picture at 16:9 (the avatar slot) before it is uploaded. */
const ImageModal: FC = () => (
  <>
    <link rel="stylesheet" href={assetUrl('vendor/cropperjs/cropper.min.css')} />
    <script src={assetUrl('vendor/cropperjs/cropper.min.js')} defer></script>
    <dialog id="imageModal" class="image-modal" aria-labelledby="imageTitle">
      <div class="hm-head">
        <h2 id="imageTitle" style="margin:0">
          Imagen para <span id="imageTeam" style="color:var(--gold)"></span>
        </h2>
      </div>
      <p class="flash error" id="imageError" role="alert" hidden></p>
      <div class="im-layout" id="imageEditor">
        <div class="im-stage">
          <div class="im-fill" id="cropFill" hidden></div>
          <img id="cropImage" alt="Imagen que se va a recortar" />
        </div>
        <div class="im-side">
          <p class="muted" style="margin:0;font-size:12px">
            Arrastra para encuadrar. Acerca o aleja con la rueda, pellizcando o con el control. El recorte es 16:9, como
            el espacio del héroe; lo que la imagen no cubra se rellena con el fondo.
          </p>
          <label class="im-zoom">
            <span>Zoom</span>
            <input type="range" id="cropZoom" min="0" max="100" value="0" step="1" />
          </label>
          <div class="actions">
            <button class="btn sm" type="button" id="cropFit">
              Ajustar completa
            </button>
            <button class="btn sm" type="button" id="cropRotate">
              Girar 90°
            </button>
          </div>
          <fieldset class="im-bg">
            <legend>Fondo</legend>
            <label>
              <input type="radio" name="cropBg" value="blur" checked />
              <span>Desenfocado</span>
            </label>
            <label>
              <input type="radio" name="cropBg" value="dark" />
              <span>Oscuro</span>
            </label>
            <label>
              <input type="radio" name="cropBg" value="clear" />
              <span>Transparente</span>
            </label>
          </fieldset>
          <div class="im-previews" aria-hidden="true">
            <div class="im-prev-item">
              <div class="im-preview im-preview-lg"></div>
              <span class="muted">Tarjeta</span>
            </div>
            <div class="im-prev-item">
              <div class="im-preview im-preview-md"></div>
              <span class="muted">Tabla</span>
            </div>
            <div class="im-prev-item">
              <div class="im-preview im-preview-sm"></div>
              <span class="muted">Chip</span>
            </div>
          </div>
        </div>
      </div>
      <div class="actions im-foot">
        <button class="btn" type="button" id="cropCancel">
          Cancelar
        </button>
        <button class="btn pri" type="button" id="cropSave">
          Usar imagen
        </button>
      </div>
    </dialog>
  </>
);

export const TeamsView: FC<{ tournament: Tournament; teams: Team[]; hasFixture: boolean; imagesEnabled?: boolean }> = ({
  tournament,
  teams,
  hasFixture,
  imagesEnabled = false,
}) => {
  const base = `/admin/t/${tournament.id}/equipos`;
  const taken: Record<string, string> = {};
  for (const team of teams) if (team.hero) taken[team.hero] = team.code;
  return (
    <>
      <PageHead
        title="Equipos"
        sub={
          hasFixture
            ? 'Si cambias equipos después de generar el fixture, hay que regenerarlo.'
            : 'Agrega los equipos y luego genera el fixture.'
        }
      />
      <div class="card scroll-x">
        <table class="cards teams">
          <thead>
            <tr>
              <th>Código</th>
              <th>Emblema</th>
              <th>Nombre</th>
              <th>Capitán</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => {
              const formId = `team-${team.id}`;
              return (
                <tr data-team-row data-team-id={String(team.id)}>
                  <td data-label="Código">
                    <input
                      class="code-input"
                      style={`--tc:${teamColor(team.id)}`}
                      name="code"
                      form={formId}
                      value={team.code}
                      maxlength={4}
                      aria-label="Código"
                    />
                  </td>
                  <td data-label="Emblema">
                    <EmblemCell formId={formId} team={team} imagesEnabled={imagesEnabled} />
                  </td>
                  <td data-label="Nombre">
                    <input name="name" form={formId} value={team.name} required maxlength={40} aria-label="Nombre" />
                  </td>
                  <td data-label="Capitán">
                    <input name="captain" form={formId} value={team.captain ?? ''} maxlength={40} placeholder="Opcional" aria-label="Capitán" />
                  </td>
                  <td>
                    <div class="actions">
                      <form id={formId} method="post" action={`${base}/${team.id}`} class="inline" data-team-form>
                        <button class="btn sm" type="submit">
                          Guardar
                        </button>
                      </form>
                      <button class="btn sm" type="button" data-undo hidden>
                        Deshacer cambios
                      </button>
                      <form method="post" action={`${base}/${team.id}/eliminar`} class="inline">
                        <button class="btn sm danger" type="submit">
                          Eliminar
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
            <tr>
              <td data-label="Código">
                <input class="code-input" name="code" form="team-new" maxlength={4} placeholder="Ej. A" aria-label="Código del nuevo equipo" required />
              </td>
              <td data-label="Emblema">
                <EmblemCell formId="team-new" imagesEnabled={imagesEnabled} />
              </td>
              <td data-label="Nombre">
                <input name="name" form="team-new" maxlength={40} placeholder="Nombre del equipo" aria-label="Nombre del nuevo equipo" required />
              </td>
              <td data-label="Capitán">
                <input name="captain" form="team-new" maxlength={40} placeholder="Opcional" aria-label="Capitán del nuevo equipo" />
              </td>
              <td>
                <form id="team-new" method="post" action={base} class="inline">
                  <button class="btn pri sm" type="submit">
                    + Agregar equipo
                  </button>
                </form>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted" style="margin:0;font-size:12px">
        El héroe es el emblema del equipo en la web pública: aparece en tarjetas de partido, tabla y playoffs. Cada
        héroe solo puede usarlo un equipo.
        {imagesEnabled
          ? ' Si el equipo sube su propia imagen, reemplaza al héroe en toda la web; al quitarla vuelve el héroe.'
          : ' Las imágenes personalizadas no están disponibles en este servidor (falta configurar el almacenamiento).'}
      </p>
      <EmblemViewer />
      {imagesEnabled ? <ImageModal /> : null}
      {imagesEnabled ? <EmblemDialogs /> : null}
      <dialog id="heroModal" class="hero-modal">
        <div class="hm-head">
          <h2 style="margin:0">
            Héroe para <span id="heroTeam" style="color:var(--gold)"></span>
          </h2>
          <button class="btn sm" type="button" data-hero-close>
            Cerrar
          </button>
        </div>
        <div class="hm-tools">
          <input id="heroSearch" placeholder="Buscar héroe…" autocomplete="off" aria-label="Buscar héroe" />
          <div class="attrs">
            {ATTRS.map(([key, label]) => (
              <button class={`btn sm${key === 'any' ? ' on' : ''}`} type="button" data-attr={key}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div class="hero-grid" id="heroGrid"></div>
      </dialog>
      <script
        type="application/json"
        id="heroes-data"
        dangerouslySetInnerHTML={{ __html: inlineJson({ heroes: HEROES, taken }) }}
      />
    </>
  );
};
