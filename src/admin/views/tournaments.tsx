import type { FC } from 'hono/jsx';
import type { Tournament } from '../../db/repository.js';
import { publicUrlFor } from '../render.js';

export interface TournamentRow {
  tournament: Tournament;
  teamCount: number;
  status: string;
  statusClass: 'ok' | 'next' | '';
}

export const TournamentsView: FC<{ rows: TournamentRow[] }> = ({ rows }) => (
  <>
    <div class="head">
      <div>
        <h1>Torneos</h1>
        <p class="sub">Cada torneo tiene su propia URL pública. El torneo activo se muestra en la portada.</p>
      </div>
    </div>
    <div class="card scroll-x">
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>URL pública</th>
            <th>Equipos</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colspan={5} class="muted">
                Todavía no hay torneos. Crea el primero abajo.
              </td>
            </tr>
          ) : null}
          {rows.map(({ tournament: t, teamCount, status, statusClass }) => (
            <tr>
              <td>
                <b>{t.name}</b> {t.isActive ? <span class="pill next">Activo</span> : null}
              </td>
              <td class="muted">
                <a href={publicUrlFor(t)} target="_blank" rel="noopener">
                  /t/{t.slug}
                </a>
              </td>
              <td>{teamCount}</td>
              <td>
                <span class={`pill ${statusClass}`}>{status}</span>
              </td>
              <td>
                <div class="actions">
                  <a class="btn sm" href={`/admin/t/${t.id}/resultados`}>
                    Abrir
                  </a>
                  {t.isActive ? null : (
                    <form method="post" action={`/admin/t/${t.id}/activar`}>
                      <button class="btn sm" type="submit">
                        Marcar como activo
                      </button>
                    </form>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <form class="card stack narrow" method="post" action="/admin/torneos">
      <h2>Nuevo torneo</h2>
      <label class="f">
        Nombre
        <input name="name" required maxlength={80} placeholder="Torneo All vs All · Oct 2026" />
      </label>
      <label class="f">
        URL pública (slug)
        <input name="slug" required maxlength={60} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="torneo-oct-2026" />
      </label>
      <button class="btn pri" type="submit">
        + Crear torneo
      </button>
    </form>
  </>
);
