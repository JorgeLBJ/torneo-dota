import type { FC } from 'hono/jsx';
import { HEROES, getHero } from '../../data/heroes.js';
import type { Team, Tournament } from '../../db/repository.js';
import { teamColor } from './layout.js';
import { assetUrl } from '../../assets.js';
import { EmblemPicture } from '../../emblem-view.js';
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

const HeroSlot: FC<{ formId: string; team?: Team }> = ({ formId, team }) => {
  const hero = team?.hero ? getHero(team.hero) : undefined;
  return (
    <div class="hero-cell">
      <input type="hidden" name="hero" form={formId} value={team?.hero ?? ''} data-hero-input />
      <button
        type="button"
        class={`hero-slot${hero ? ' filled' : ''}`}
        data-hero-pick={formId}
        data-team-id={team ? String(team.id) : ''}
        data-team-label={team ? team.name : 'el nuevo equipo'}
        title="Elegir héroe"
      >
        {hero ? <img src={heroImage(hero.slug)} alt="" /> : <span>+ Héroe</span>}
      </button>
      <span class="muted hero-name" data-hero-name>
        {hero ? hero.name : 'Sin héroe'}
      </span>
    </div>
  );
};

/** The team's own picture, when it has one (shown next to the hero picker, which still chooses the fallback). */
const CustomImage: FC<{ team: Team; base: string; enabled: boolean }> = ({ team, base, enabled }) => {
  if (!enabled) return null;
  return (
    <div class="img-row">
      <input type="file" accept="image/jpeg,image/png,image/webp" hidden data-image-file aria-label={`Imagen del equipo ${team.code}`} />
      <button type="button" class="btn sm" data-image-pick data-upload-url={`${base}/${team.id}/imagen`} data-team-label={team.name}>
        Subir imagen
      </button>
      {team.imageKey ? (
        <span class="img-thumb">
          <EmblemPicture team={team} eager />
        </span>
      ) : null}
      {team.imageKey ? (
        <form method="post" action={`${base}/${team.id}/imagen/quitar`} class="inline">
          <button class="btn sm" type="submit">
            Quitar imagen
          </button>
        </form>
      ) : null}
    </div>
  );
};

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
          <img id="cropImage" alt="Imagen que se va a recortar" />
        </div>
        <div class="im-side">
          <p class="muted" style="margin:0;font-size:12px">
            Arrastra para encuadrar. Acerca con la rueda, pellizcando o con el control. El recorte es 16:9, como el
            espacio del héroe.
          </p>
          <label class="im-zoom">
            <span>Zoom</span>
            <input type="range" id="cropZoom" min="0" max="100" value="0" step="1" />
          </label>
          <div class="actions">
            <button class="btn sm" type="button" id="cropRotate">
              Girar 90°
            </button>
          </div>
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
          Guardar
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
              <th>Emblema (héroe)</th>
              <th>Nombre</th>
              <th>Capitán</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => {
              const formId = `team-${team.id}`;
              return (
                <tr>
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
                    <HeroSlot formId={formId} team={team} />
                    <CustomImage team={team} base={base} enabled={imagesEnabled} />
                  </td>
                  <td data-label="Nombre">
                    <input name="name" form={formId} value={team.name} required maxlength={40} aria-label="Nombre" />
                  </td>
                  <td data-label="Capitán">
                    <input name="captain" form={formId} value={team.captain ?? ''} maxlength={40} placeholder="Opcional" aria-label="Capitán" />
                  </td>
                  <td>
                    <div class="actions">
                      <form id={formId} method="post" action={`${base}/${team.id}`} class="inline">
                        <button class="btn sm" type="submit">
                          Guardar
                        </button>
                      </form>
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
                <HeroSlot formId="team-new" />
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
      {imagesEnabled ? <ImageModal /> : null}
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
