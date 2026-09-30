import type { FC } from 'hono/jsx';
import type { TiebreakerKey, Tournament } from '../../db/repository.js';
import { PageHead, Rulebook, Select } from './parts.js';

export const TIEBREAKER_LABELS: Record<TiebreakerKey, string> = {
  kd: 'Diferencia K − D',
  h2h: 'Resultado directo',
  extra: 'Juego adicional',
  kills: 'Más kills',
};

const ALL_CRITERIA: TiebreakerKey[] = ['kd', 'h2h', 'kills', 'extra'];

/** Short explanations shown as a tooltip and under the list. */
const HELP: Partial<Record<TiebreakerKey, string>> = {
  h2h: 'partido jugado entre los empatados',
  extra: 'partido extra entre los empatados (Fixture > Agregar partida de desempate)',
};

export const RulesView: FC<{ tournament: Tournament }> = ({ tournament }) => {
  const order = tournament.tiebreakers;
  const unused = ALL_CRITERIA.filter((key) => !order.includes(key));
  return (
    <form method="post" action={`/admin/t/${tournament.id}/reglas`} class="stack">
      <button type="submit" name="action" value="save" class="sr-only" tabindex={-1} aria-hidden="true">
        Guardar
      </button>
      <PageHead
        title="Reglas"
        sub='La tabla y los playoffs se calculan con estas reglas. El reglamento se publica en la pestaña "Reglas" de la web.'
      >
        <button class="btn pri" type="submit" name="action" value="save">
          Guardar
        </button>
      </PageHead>
      <input type="hidden" name="tiebreakers" value={order.join(',')} />
      <div class="grid2">
        <div class="card stack" style="align-content:start">
          <h2>Puntuación</h2>
          <div class="grid2" style="grid-template-columns:1fr 1fr">
            <label class="f">
              Victoria
              <input type="number" name="points_win" value={String(tournament.pointsWin)} min={0} max={99} required />
            </label>
            <label class="f">
              Derrota
              <input type="number" name="points_loss" value={String(tournament.pointsLoss)} min={0} max={99} required />
            </label>
          </div>
          <h2 style="margin-top:6px">Desempate</h2>
          <p class="muted" style="margin:-6px 0 0;font-size:12px">
            Se aplican en este orden a los equipos que siguen empatados. Usa las flechas para reordenar, × para quitar
            uno y guarda.
          </p>
          {order.length > 0 ? (
            <ol class="tb-list">
              {order.map((key, i) => (
                <li>
                  <span class="pair" title={HELP[key]}>
                    {TIEBREAKER_LABELS[key]}
                  </span>
                  <button
                    class="btn sm"
                    type="submit"
                    name="action"
                    value={`up:${key}`}
                    disabled={i === 0}
                    aria-label={`Subir ${TIEBREAKER_LABELS[key]}`}
                  >
                    ↑
                  </button>
                  <button
                    class="btn sm"
                    type="submit"
                    name="action"
                    value={`down:${key}`}
                    disabled={i === order.length - 1}
                    aria-label={`Bajar ${TIEBREAKER_LABELS[key]}`}
                  >
                    ↓
                  </button>
                  <button
                    class="btn sm danger"
                    type="submit"
                    name="action"
                    value={`remove:${key}`}
                    aria-label={`Quitar ${TIEBREAKER_LABELS[key]}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p class="muted" style="margin:0">
              Sin criterios: los equipos con los mismos puntos quedan empatados.
            </p>
          )}
          {unused.length > 0 ? (
            <div class="tb-add">
              <Select name="new_tiebreaker" aria-label="Criterio para agregar">
                {unused.map((key) => (
                  <option value={key}>{TIEBREAKER_LABELS[key]}</option>
                ))}
              </Select>
              <button class="btn sm" type="submit" name="action" value="add">
                + Agregar
              </button>
            </div>
          ) : null}
          <p class="muted" style="margin:0;font-size:12px">
            Resultado directo: {HELP.h2h}. Juego adicional: {HELP.extra}.
          </p>
          <p class="muted" style="margin:0;font-size:12px">
            Si siguen empatados, el torneo queda con empate sin resolver y los cruces de semifinales se eligen a mano.
          </p>
        </div>
        <div class="card stack" style="align-content:start">
          <h2>Formato</h2>
          <label class="f">
            Fase de grupos
            <Select name="group_legs">
              <option value="1" selected={tournament.groupLegs === 1}>
                Todos contra todos · una vuelta
              </option>
              <option value="2" selected={tournament.groupLegs === 2}>
                Todos contra todos · ida y vuelta
              </option>
            </Select>
          </label>
          <label class="f">
            Clasifican a playoffs
            <Select disabled>
              <option>4 (semis 1v4 · 2v3 + final)</option>
            </Select>
          </label>
          <p class="muted" style="margin:0;font-size:12px">
            Por ahora los playoffs son siempre de 4 equipos, al mejor de 1.
          </p>
        </div>
      </div>
      <div class="card stack">
        <h2>Reglamento</h2>
        <p class="muted" style="margin:0;font-size:12px">
          Texto que se muestra en la web pública. Usa <code>## Título</code> para secciones y <code>- </code> para
          listas.
        </p>
        <textarea name="rules_text" rows={12}>
          {tournament.rulesText}
        </textarea>
      </div>
      {tournament.rulesText.trim() ? (
        <div class="card stack">
          <h2>Vista previa</h2>
          <Rulebook text={tournament.rulesText} />
        </div>
      ) : null}
    </form>
  );
};
