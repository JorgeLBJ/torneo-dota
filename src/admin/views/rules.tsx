import { raw } from 'hono/html';
import type { FC } from 'hono/jsx';
import type { TiebreakerKey, Tournament } from '../../db/repository.js';
import { rulebookHtmlOf } from '../../rulebook.js';
import { PageHead, Select } from './parts.js';

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

const TOOLBAR: (
  | 'sep'
  | { title: string; label: string; cmd: string; arg?: string; swatch?: string }
)[] = [
  { title: 'Título', label: 'T', cmd: 'block', arg: 'h2' },
  { title: 'Subtítulo', label: 't', cmd: 'block', arg: 'h3' },
  'sep',
  { title: 'Negrita (Ctrl+B)', label: 'B', cmd: 'bold' },
  { title: 'Cursiva (Ctrl+I)', label: 'I', cmd: 'italic' },
  { title: 'Subrayado (Ctrl+U)', label: 'U', cmd: 'underline' },
  { title: 'Tachado', label: 'S', cmd: 'strikeThrough' },
  'sep',
  { title: 'Lista con viñetas', label: '• —', cmd: 'insertUnorderedList' },
  { title: 'Lista numerada', label: '1.', cmd: 'insertOrderedList' },
  { title: 'Aumentar sangría (Tab)', label: '⇥', cmd: 'indent' },
  { title: 'Reducir sangría (Mayús+Tab)', label: '⇤', cmd: 'outdent' },
  'sep',
  { title: 'Resaltar dorado', label: '', cmd: 'mark', arg: 'g', swatch: '#e6b65f' },
  { title: 'Resaltar verde (Radiant)', label: '', cmd: 'mark', arg: 'r', swatch: '#6dbf4b' },
  { title: 'Resaltar rojo (Dire)', label: '', cmd: 'mark', arg: 'd', swatch: '#ff7a66' },
  'sep',
  { title: 'Nota destacada', label: '⚠ Nota', cmd: 'callout' },
  { title: 'Enlace', label: '🔗', cmd: 'link' },
  { title: 'Separador', label: '―', cmd: 'hr' },
  { title: 'Quitar formato', label: '⨯', cmd: 'removeFormat' },
];

/**
 * The rulebook editor. Without JavaScript only the HTML textarea shows (and is sanitized on save); with it, the
 * toolbar and the rich area replace the textarea, and the preview uses the same `.rules` stylesheet as the public page.
 */
const RulebookEditor: FC<{ html: string }> = ({ html }) => (
  <div class="rb-editor" data-rb-editor>
    <div class="rb-col">
      <label class="rb-label">Reglamento</label>
      <div class="rb-toolbar" role="toolbar" aria-label="Formato del reglamento" data-rb-toolbar hidden>
        {TOOLBAR.map((item) =>
          item === 'sep' ? (
            <span class="rb-sep"></span>
          ) : (
            <button type="button" title={item.title} aria-label={item.title} data-cmd={item.cmd} data-arg={item.arg}>
              {item.swatch ? <span class="rb-sw" style={`background:${item.swatch}`}></span> : item.label}
            </button>
          ),
        )}
      </div>
      <div class="rb-area" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Reglamento" data-rb-area hidden></div>
      <textarea name="rules_html" rows={14} data-rb-source>
        {html}
      </textarea>
      <span class="rb-hint">Lo que pegues de Word o WhatsApp se limpia: solo quedan estos estilos.</span>
    </div>
    <div class="rb-col">
      <label class="rb-label">Vista previa · idéntica a la web pública (mismas fuentes, colores y tamaños)</label>
      <div class="rb-frame">
        <div class="rules" data-rb-preview>{raw(html)}</div>
      </div>
    </div>
  </div>
);

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
          <h2 style="margin-top:6px">Partidas por partido</h2>
          <div class="grid2" style="grid-template-columns:repeat(3,1fr)">
            {(
              [
                ['group_games', 'Grupos', tournament.groupGames],
                ['semifinal_games', 'Semifinales', tournament.semifinalGames],
                ['final_games', 'Final', tournament.finalGames],
              ] as const
            ).map(([name, label, value]) => (
              <label class="f">
                {label}
                <Select name={name}>
                  <option value="1" selected={value === 1}>
                    Al mejor de 1
                  </option>
                  <option value="3" selected={value === 3}>
                    Al mejor de 3
                  </option>
                  <option value="5" selected={value === 5}>
                    Al mejor de 5
                  </option>
                </Select>
              </label>
            ))}
          </div>
          <p class="muted" style="margin:0;font-size:12px">
            Gana el partido quien llegue primero a la mitad más uno (1, 2 o 3 juegos). La tabla de grupos suma las kills y
            deaths de todos los juegos. Los playoffs son siempre de 4 equipos. Los juegos de desempate son de un solo juego.
          </p>
        </div>
      </div>
      <div class="card stack">
        <h2>Reglamento</h2>
        <label class="f" style="display:flex;gap:6px;align-items:center">
          <input type="hidden" name="show_tiebreak_present" value="1" />
          <input type="checkbox" name="show_tiebreak_box" value="1" checked={tournament.showTiebreakBox} />
          Mostrar el cuadro «Desempate» en la página pública
        </label>
        <p class="muted" style="margin:0;font-size:12px">
          Se muestra en la pestaña «Reglas» de la web pública. Lo que pegues de Word o WhatsApp se limpia: solo quedan los
          estilos de la barra.
        </p>
        <RulebookEditor html={rulebookHtmlOf(tournament)} />
      </div>
    </form>
  );
};
