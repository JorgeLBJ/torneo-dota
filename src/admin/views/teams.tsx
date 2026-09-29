import type { FC } from 'hono/jsx';
import { HEROES, getHero } from '../../data/heroes.js';
import type { Team, Tournament } from '../../db/repository.js';
import { TeamBadge } from './layout.js';
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
    <>
      <input type="hidden" name="hero" form={formId} value={team?.hero ?? ''} data-hero-input />
      <button
        type="button"
        class={`hero-slot${hero ? ' filled' : ''}`}
        data-hero-pick={formId}
        data-team-id={team ? String(team.id) : ''}
        data-team-label={team ? team.name : 'el nuevo equipo'}
        title="Elegir héroe"
      >
        {hero ? <img src={heroImage(hero.slug)} alt="" /> : <span>+ Elegir héroe</span>}
      </button>
      <div class="muted" style="font-size:11px;margin-top:3px" data-hero-name>
        {hero ? hero.name : 'Sin héroe'}
      </div>
    </>
  );
};

export const TeamsView: FC<{ tournament: Tournament; teams: Team[]; hasFixture: boolean }> = ({
  tournament,
  teams,
  hasFixture,
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
        <table>
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
                  <td>
                    <TeamBadge team={team} />
                    <input name="code" form={formId} value={team.code} maxlength={4} aria-label="Código" style="width:70px;margin-left:6px" />
                  </td>
                  <td>
                    <HeroSlot formId={formId} team={team} />
                  </td>
                  <td>
                    <input name="name" form={formId} value={team.name} required maxlength={40} aria-label="Nombre" />
                  </td>
                  <td>
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
              <td>
                <input name="code" form="team-new" maxlength={4} placeholder="Ej. A" aria-label="Código del nuevo equipo" style="width:90px" required />
              </td>
              <td>
                <HeroSlot formId="team-new" />
              </td>
              <td>
                <input name="name" form="team-new" maxlength={40} placeholder="Nombre del equipo" aria-label="Nombre del nuevo equipo" required />
              </td>
              <td>
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
      </p>
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
