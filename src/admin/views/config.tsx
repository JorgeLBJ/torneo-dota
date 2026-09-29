import type { FC } from 'hono/jsx';
import type { ScheduleDay, Tournament } from '../../db/repository.js';
import { PageHead } from './parts.js';

export const PHASE_LABELS: Record<ScheduleDay['phase'], string> = {
  group: 'Grupos',
  semifinal: 'Semifinales',
  final: 'Final',
};

export const ConfigView: FC<{ tournament: Tournament; days: ScheduleDay[] }> = ({ tournament, days }) => (
  <form method="post" action={`/admin/t/${tournament.id}/config`} class="stack">
    {/* First submit button = default action for the Enter key. */}
    <button type="submit" name="action" value="save" class="sr-only" tabindex={-1} aria-hidden="true">
      Guardar
    </button>
    <PageHead title="Configuración" sub="Datos del torneo y calendario.">
      <button class="btn pri" type="submit" name="action" value="save">
        Guardar
      </button>
    </PageHead>
    <div class="grid2">
      <div class="card stack" style="align-content:start">
        <h2>General</h2>
        <label class="f">
          Nombre
          <input name="name" value={tournament.name} required maxlength={80} />
        </label>
        <label class="f">
          URL pública (slug)
          <input name="slug" value={tournament.slug} required maxlength={60} />
        </label>
        <label class="f">
          Juego
          <input name="game" value={tournament.game} required maxlength={60} />
        </label>
        <p class="muted" style="margin:0;font-size:12px">
          Puntos, desempates, playoffs y reglamento se editan en{' '}
          <a href={`/admin/t/${tournament.id}/reglas`}>Reglas</a>.
        </p>
      </div>
      <div class="card stack">
        <h2>Calendario</h2>
        <div class="scroll-x">
          <table class="cal">
            <thead>
              <tr>
                <th>Fase</th>
                <th>Fecha</th>
                <th>Horarios</th>
                <th>Min. c/u</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {days.length === 0 ? (
                <tr>
                  <td colspan={5} class="muted">
                    Sin días. Agrega los días de juego para repartir el fixture.
                  </td>
                </tr>
              ) : null}
              {days.map((d, i) => (
                <tr>
                  <td>
                    <select name="day_phase" aria-label="Fase">
                      {(Object.keys(PHASE_LABELS) as ScheduleDay['phase'][]).map((p) => (
                        <option value={p} selected={p === d.phase}>
                          {PHASE_LABELS[p]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input type="date" name="day_date" value={d.date} aria-label="Fecha" />
                  </td>
                  <td>
                    <input name="day_times" value={d.startTimes.join(', ')} placeholder="14:00, 15:00" aria-label="Horarios" />
                  </td>
                  <td>
                    <input
                      name="day_minutes"
                      value={String(d.slotMinutes)}
                      inputmode="numeric"
                      aria-label="Minutos por partido"
                    />
                  </td>
                  <td>
                    <button class="btn sm danger" type="submit" name="action" value={`remove:${i}`}>
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button class="btn sm" type="submit" name="action" value="add" style="justify-self:start">
          + Agregar día
        </button>
      </div>
    </div>
  </form>
);
