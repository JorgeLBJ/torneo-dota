import type { FC } from 'hono/jsx';
import type { GsiCaptureLink, GsiCaptureRow } from '../../db/repository.js';
import type { GsiSummary } from '../../dota/gsi.js';
import type { DotaPlayerLine } from '../../dota/snapshot.js';
import { formatDuration } from '../../dota/import.js';
import { formatDateTime } from '../../format/datetime.js';
import type { CaptureState } from '../../gsi/state.js';
import { heroImage } from './parts.js';

export type CaptureFilter = 'todas' | 'en-curso' | 'sin-vincular' | 'vinculadas';

export const FILTERS: { key: CaptureFilter; label: string }[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'en-curso', label: 'En curso' },
  { key: 'sin-vincular', label: 'Sin vincular' },
  { key: 'vinculadas', label: 'Vinculadas' },
];

export const PAGE_SIZE = 50;

export interface CaptureItem {
  row: GsiCaptureRow;
  state: CaptureState;
}

const STATE_LABEL: Record<CaptureState, string> = { live: 'En curso', final: 'Finalizada', incomplete: 'Incompleta' };
const SIDE_LABEL = { radiant: 'Radiant', dire: 'Dire' } as const;

/** "Fecha 3 · Equipo A vs Equipo B · Juego 2" */
export function linkLabel(link: GsiCaptureLink): string {
  const where = link.phase === 'group' ? `Fecha ${link.round}` : link.phase === 'final' ? 'Gran final' : `Semifinal ${link.matchNumber}`;
  const teams = link.team1Name && link.team2Name ? ` · ${link.team1Name} vs ${link.team2Name}` : '';
  const game = link.phase === 'group' && link.gameNumber === 1 ? '' : ` · Juego ${link.gameNumber}`;
  return `${where}${teams}${game}`;
}

const linkHref = (link: GsiCaptureLink): string =>
  link.phase === 'group' ? `/admin/t/${link.tournamentId}/resultados?fecha=todos` : `/admin/t/${link.tournamentId}/playoffs`;

export const LinkedTo: FC<{ link: GsiCaptureLink | null }> = ({ link }) =>
  link ? (
    <a href={linkHref(link)}>
      {link.tournamentName} · {linkLabel(link)}
    </a>
  ) : (
    <span class="pill">Sin vincular</span>
  );

const StatePill: FC<{ state: CaptureState }> = ({ state }) => (
  <span class={`pill${state === 'final' ? ' ok' : state === 'live' ? ' next' : ''}`}>{STATE_LABEL[state]}</span>
);

const duration = (sec: number | null): string => (sec === null ? '—' : formatDuration(sec));

const Score: FC<{ row: Pick<GsiCaptureRow, 'radiantScore' | 'direScore' | 'winner'>; showWinner: boolean }> = ({ row, showWinner }) => {
  if (row.radiantScore === null && row.direScore === null) return <span class="muted">—</span>;
  return (
    <>
      {row.radiantScore ?? '—'} – {row.direScore ?? '—'}
      {showWinner && row.winner ? <span class="muted"> · {SIDE_LABEL[row.winner]}</span> : null}
    </>
  );
};

export const CapturesView: FC<{
  items: CaptureItem[];
  counts: Record<CaptureFilter, number>;
  filter: CaptureFilter;
  query: string;
  page: number;
  pages: number;
  timeZone: string;
}> = ({ items, counts, filter, query, page, pages, timeZone }) => {
  const href = (f: CaptureFilter, p = 1) => {
    const params = new URLSearchParams();
    if (f !== 'todas') params.set('estado', f);
    if (query) params.set('q', query);
    if (p > 1) params.set('pagina', String(p));
    const text = params.toString();
    return `/admin/capturas${text ? `?${text}` : ''}`;
  };
  return (
    <div data-live-page="capturas-list" data-live-region>
      <div class="head">
        <div>
          <h1>Capturas GSI</h1>
          <p class="sub">Partidas que nuestros observadores enviaron. Para cargar una finalizada en un juego, escribe su Match ID en Resultados.</p>
        </div>
      </div>
      <form class="toolbar" method="get" action="/admin/capturas">
        {filter !== 'todas' ? <input type="hidden" name="estado" value={filter} /> : null}
        <label class="f">
          Buscar por Match ID
          <input name="q" value={query} inputmode="numeric" maxlength={20} placeholder="9028047526" autocomplete="off" />
        </label>
        <div class="chips">
          {FILTERS.map((f) => (
            <a class={`btn sm${f.key === filter ? ' on' : ''}`} href={href(f.key)} aria-current={f.key === filter ? 'true' : undefined}>
              {f.label} · {counts[f.key]}
            </a>
          ))}
        </div>
      </form>
      <div class="card scroll-x">
        <table class="cards">
          <thead>
            <tr>
              <th>Match ID</th>
              <th>Estado</th>
              <th>Marcador</th>
              <th>Duración</th>
              <th>Observador</th>
              <th>Última actualización</th>
              <th>Vinculada a</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colspan={8} class="muted">
                  Aún no hay capturas.
                </td>
              </tr>
            ) : null}
            {items.map(({ row, state }) => (
              <tr data-capture-key={String(row.dotaMatchId)}>
                <td data-label="Match ID">
                  <b>{row.dotaMatchId}</b>
                </td>
                <td data-label="Estado">
                  <StatePill state={state} />
                </td>
                <td data-label="Marcador">
                  <Score row={row} showWinner={state === 'final'} />
                </td>
                <td data-label="Duración">{duration(row.durationSec)}</td>
                <td data-label="Observador">{row.observerName ?? '—'}</td>
                <td class="muted" data-label="Última actualización">
                  {formatDateTime(row.updatedAt, { timeZone })}
                </td>
                <td data-label="Vinculada a">
                  {row.link || state === 'final' ? <LinkedTo link={row.link} /> : <span class="muted">—</span>}
                </td>
                <td>
                  <a class="btn sm" href={`/admin/capturas/${row.dotaMatchId}`}>
                    Ver
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <nav class="pager" aria-label="Páginas">
          {page > 1 ? (
            <a class="btn sm" href={href(filter, page - 1)}>
              ← Anterior
            </a>
          ) : null}
          <span class="muted">
            Página {page} de {pages}
          </span>
          {page < pages ? (
            <a class="btn sm" href={href(filter, page + 1)}>
              Siguiente →
            </a>
          ) : null}
        </nav>
      ) : null}
      <p class="muted legend">
        <b>En curso</b>: el observador sigue enviando datos. <b>Finalizada</b>: llegó el estado final; ya no se sobrescribe. <b>Incompleta</b>: dejaron de llegar datos antes del final
        (el observador se fue o se cayó).
      </p>
    </div>
  );
};

const compact = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const SideTable: FC<{ side: 'radiant' | 'dire'; players: DotaPlayerLine[]; won: boolean }> = ({ side, players, won }) => (
  <section class="card">
    <h2>
      {SIDE_LABEL[side]}
      {won ? <span class="pill ok">Ganó</span> : null}
    </h2>
    <div class="scroll-x">
      <table class="cards cap-players">
        <thead>
          <tr>
            <th>Jugador</th>
            <th>Héroe</th>
            <th>Nivel</th>
            <th>K / D / A</th>
            <th>LH / DN</th>
            <th>GPM</th>
            <th>XPM</th>
            <th>Patrimonio</th>
          </tr>
        </thead>
        <tbody>
          {players.length === 0 ? (
            <tr>
              <td colspan={8} class="muted">
                Sin jugadores en esta captura.
              </td>
            </tr>
          ) : null}
          {players.map((p) => (
            <tr>
              <td data-label="Jugador">{p.nick ?? <span class="muted">—</span>}</td>
              <td data-label="Héroe">
                <span class="cap-hero">
                  {p.heroSlug ? <img src={heroImage(p.heroSlug)} alt="" loading="lazy" /> : null}
                  {p.heroName}
                </span>
              </td>
              <td data-label="Nivel">{p.level}</td>
              <td data-label="K / D / A">
                {p.kills} / {p.deaths} / {p.assists}
              </td>
              <td data-label="LH / DN">
                {p.lastHits} / {p.denies}
              </td>
              <td data-label="GPM">{p.gpm}</td>
              <td data-label="XPM">{p.xpm}</td>
              <td data-label="Patrimonio">{p.netWorth === undefined ? '—' : compact(p.netWorth)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);

export const CaptureDetailView: FC<{ item: CaptureItem; summary: GsiSummary; rawJson: string; timeZone: string }> = ({ item, summary, rawJson, timeZone }) => {
  const { row, state } = item;
  const id = row.dotaMatchId;
  return (
    <div data-live-page="capturas-detail" data-live-region>
      <p>
        <a href="/admin/capturas">← Capturas GSI</a>
      </p>
      <div class="head">
        <div>
          <h1>Match {id}</h1>
          <p class="sub">
            Capturada por {row.observerName ?? 'un observador desconocido'} · {formatDateTime(row.firstReceivedAt, { timeZone })} → {formatDateTime(row.updatedAt, { timeZone })} · <StatePill state={state} />
          </p>
        </div>
        <div class="scorebox" aria-label="Marcador">
          <div class={summary.winner === 'radiant' ? 'win' : ''}>
            <small>Radiant{summary.winner === 'radiant' ? ' · ganó' : ''}</small>
            <b>{row.radiantScore ?? '—'}</b>
          </div>
          <div class="muted">{duration(row.durationSec)}</div>
          <div class={summary.winner === 'dire' ? 'win' : ''}>
            <small>Dire{summary.winner === 'dire' ? ' · ganó' : ''}</small>
            <b>{row.direScore ?? '—'}</b>
          </div>
        </div>
      </div>
      {row.link || state === 'final' ? (
        <p>
          {row.link ? 'Vinculada a ' : null}
          <LinkedTo link={row.link} />
        </p>
      ) : null}
      {state === 'final' && row.link === null ? (
        <p class="note" role="status">
          Para cargarla en un juego, escribe este Match ID en Resultados y pulsa «Buscar».
        </p>
      ) : null}
      <SideTable side="radiant" players={summary.radiant} won={summary.winner === 'radiant'} />
      <SideTable side="dire" players={summary.dire} won={summary.winner === 'dire'} />
      <details class="card">
        <summary>JSON crudo enviado por Dota (para revisar campos)</summary>
        <pre class="raw-json">{rawJson}</pre>
      </details>
      <form class="card" method="post" action={`/admin/capturas/${id}/borrar`}>
        <h2>Borrar captura</h2>
        <p class="muted">Útil si el observador envió datos equivocados: al borrarla puede volver a enviar la partida correcta.</p>
        <button class="btn danger" type="submit" data-confirm-open="deleteDialog">
          Borrar captura
        </button>
        <dialog id="deleteDialog" class="confirm-modal" aria-labelledby="deleteTitle">
          <h2 id="deleteTitle">¿Borrar la captura {id}?</h2>
          <p>
            Se elimina solo la captura guardada.
            {row.link
              ? ' El juego del torneo ya vinculado conserva su resultado y su detalle: borrar la captura no modifica el juego guardado.'
              : ' Si algún juego del torneo ya usó esta partida, borrar la captura no modifica ese juego.'}
          </p>
          <div class="actions">
            <button class="btn" type="button" autofocus data-confirm-cancel>
              Cancelar
            </button>
            <button class="btn pri" type="submit">
              Borrar captura
            </button>
          </div>
        </dialog>
      </form>
    </div>
  );
};
