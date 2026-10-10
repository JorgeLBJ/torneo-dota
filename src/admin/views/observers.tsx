import type { FC } from 'hono/jsx';
import type { ObserverToken } from '../../db/repository.js';
import { formatDateTime } from '../../format/datetime.js';

/** The token and cfg of an observer that was created in this very response. */
export interface CreatedObserver {
  name: string;
  token: string;
  cfg: string;
  filename: string;
  installer: string;
  installerFilename: string;
}

const CreatedPanel: FC<{ created: CreatedObserver }> = ({ created }) => (
  <section class="card" aria-labelledby="createdTitle">
    <h2 id="createdTitle">Token de «{created.name}»</h2>
    <div class="note" role="alert">
      Este token se muestra una sola vez y no se guarda en el servidor. Descarga el archivo ahora; si lo pierdes, revoca el token y crea otro.
    </div>
    <ol>
      <li>
        Descarga el instalador y ábrelo (doble clic). Si Windows muestra «Windows protegió su PC», pulsa <b>Más información</b> y luego{' '}
        <b>Ejecutar de todas formas</b>.
      </li>
      <li>
        Abre Dota desde el acceso directo <b>Dota 2 (Torneo)</b> del escritorio (siempre desde ahí durante el torneo).
      </li>
      <li>Entra al lobby como espectador y quédate hasta el final de la partida.</li>
    </ol>
    <p>
      <button class="btn pri" type="button" data-installer-download={created.installerFilename}>
        Descargar instalador (.bat)
      </button>
    </p>
    <p class="muted">El instalador contiene el token de este observador: no lo compartas.</p>
    <details>
      <summary>Instalación manual</summary>
      <ol>
        <li>
          Descarga <b>{created.filename}</b> y cópialo en la carpeta{' '}
          <code>{'…\\steamapps\\common\\dota 2 beta\\game\\dota\\cfg\\gamestate_integration\\'}</code> (créala si no existe).
        </li>
        <li>
          En Steam, abre las propiedades de Dota 2 y agrega la opción de lanzamiento <code>-gamestateintegration</code>.
        </li>
        <li>Reinicia Dota 2 y entra a la sala de la partida como espectador.</li>
      </ol>
      <p>
        <button class="btn" type="button" data-cfg-download={created.filename}>
          Descargar .cfg
        </button>
      </p>
    </details>
    <details>
      <summary>Ver contenido de los archivos</summary>
      <pre id="cfgText" data-token={created.token}>{created.cfg}</pre>
      <pre id="installerText">{created.installer}</pre>
    </details>
  </section>
);

export type ObserverFilter = 'activos' | 'todos';

export const ObserversView: FC<{
  /** Every observer; the view applies the filter. */
  observers: ObserverToken[];
  filter: ObserverFilter;
  captureCounts: Map<number, number>;
  created?: CreatedObserver;
  notice?: string;
  timeZone: string;
}> = ({ observers: all, filter, captureCounts, created, notice, timeZone }) => {
  const activeCount = all.filter((o) => !o.revokedAt).length;
  const observers = filter === 'activos' ? all.filter((o) => !o.revokedAt) : all;
  const query = filter === 'todos' ? '?ver=todos' : '';
  const chips: { key: ObserverFilter; label: string; count: number; href: string }[] = [
    { key: 'activos', label: 'Activos', count: activeCount, href: '/admin/observadores' },
    { key: 'todos', label: 'Todos', count: all.length, href: '/admin/observadores?ver=todos' },
  ];
  return (
  <>
    <div class="head">
      <div>
        <h1>Observadores</h1>
        <p class="sub">
          Personas que miran cada partida como espectadores. Su cliente de Dota envía el estado del juego a la web para poder importar el resultado.
        </p>
      </div>
    </div>
    {notice ? <div class="note" role="status">{notice}</div> : null}
    {created ? <CreatedPanel created={created} /> : null}
    <div class="chips">
      {chips.map((chip) => (
        <a class={`btn sm${chip.key === filter ? ' on' : ''}`} href={chip.href} aria-current={chip.key === filter ? 'true' : undefined}>
          {chip.label} · {chip.count}
        </a>
      ))}
    </div>
    <div class="card scroll-x">
      <table class="cards">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Token</th>
            <th>Creado</th>
            <th>Última señal</th>
            <th>Capturas</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {observers.length === 0 ? (
            <tr>
              <td colspan={7} class="muted">
                {all.length === 0 ? 'Aún no hay observadores.' : 'No hay observadores activos.'}
              </td>
            </tr>
          ) : null}
          {observers.map((o) => (
            <tr>
              <td data-label="Nombre">
                <b>{o.name}</b>
              </td>
              <td class="muted" data-label="Token">
                <code>{o.tokenPrefix}…</code>
              </td>
              <td class="muted" data-label="Creado">{formatDateTime(o.createdAt, { timeZone })}</td>
              <td class="muted" data-label="Última señal">{o.lastSeenAt ? formatDateTime(o.lastSeenAt, { timeZone }) : '—'}</td>
              <td data-label="Capturas">{captureCounts.get(o.id) ?? 0}</td>
              <td data-label="Estado">
                {o.revokedAt ? <span class="pill">Revocado</span> : <span class="pill ok">Activo</span>}
              </td>
              <td>
                {o.revokedAt ? null : (
                  <form method="post" action={`/admin/observadores/${o.id}/revocar${query}`}>
                    <button class="btn sm danger" type="submit" data-confirm-open={`revokeDialog${o.id}`}>
                      Revocar
                    </button>
                    <dialog id={`revokeDialog${o.id}`} class="confirm-modal" aria-labelledby={`revokeTitle${o.id}`}>
                      <h2 id={`revokeTitle${o.id}`}>¿Revocar a {o.name}?</h2>
                      <p>Su cliente de Dota dejará de ser aceptado. Para volver a capturar necesitará un token nuevo.</p>
                      <div class="actions">
                        <button class="btn" type="button" autofocus data-confirm-cancel>
                          Cancelar
                        </button>
                        <button class="btn pri" type="submit">
                          Revocar token
                        </button>
                      </div>
                    </dialog>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <form class="card row-form" method="post" action="/admin/observadores">
      <h2>Agregar observador</h2>
      <label class="f">
        Nombre del observador
        <input name="name" autocomplete="off" required maxlength={60} />
      </label>
      <button class="btn pri" type="submit">
        Crear token
      </button>
    </form>
  </>
  );
};
