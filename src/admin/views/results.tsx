import type { Child, FC, PropsWithChildren } from 'hono/jsx';
import type { Game, Match, Team, Tournament } from '../../db/repository.js';
import type { LiveMark } from '../../domain/live.js';
import { resolveSeries, seriesLengthFor, type SeriesLength, type SeriesState } from '../../domain/series.js';
import type { StandingRow } from '../../domain/standings.js';
import { formatDate, formatLocalDateTime } from '../../format/datetime.js';
import { TeamBadge } from './layout.js';
import { PageHead, Select } from './parts.js';

/** "03/10/2026 14:00:00" (date and/or time of a scheduled match). */
export const scheduleLabel = (m: Pick<Match, 'scheduledDate' | 'startTime'>): string =>
  formatLocalDateTime(m.scheduledDate, m.startTime) || 'Sin horario';

type ResultMatch = Pick<Match, 'winnerId' | 'team1Kills' | 'team1Deaths' | 'team2Kills' | 'team2Deaths'>;

export interface ResultCardProps {
  /** URL of the match; each game posts to `${action}/juego/${n}`. */
  action: string;
  header: Child;
  team1: Team | null;
  team2: Team | null;
  /** Optional text before a team name (for example a playoff seed "1.º "). */
  prefix?: (team: Team) => string;
  match?: ResultMatch;
  /** The games already loaded, and how many make a full series (1, 3 or 5). */
  games?: Game[];
  length?: SeriesLength;
  hidden?: Record<string, string>;
  editHref?: string;
  /** The stored match this card is about (null for a playoff match that does not exist yet). */
  matchId?: number | null;
  /** The live mark of this match (null when it is not live), whether it is the one on the stream, and the time. */
  live?: LiveMark | null;
  onStream?: boolean;
  now?: Date;
}

const dotaLink = (id: number) => `https://www.opendota.com/matches/${id}`;

interface GameFormProps {
  action: string;
  number: number;
  multi: boolean;
  team1: Team;
  team2: Team;
  prefix?: (team: Team) => string;
  game?: Game;
  hidden?: Record<string, string>;
}

/** One game of a series: winner, kills and deaths, plus the optional import from a Dota match. */
const GameForm: FC<GameFormProps> = ({ action, number, multi, team1, team2, prefix, game, hidden }) => {
  const saved = game !== undefined;
  const imported = game?.dotaMatchId != null;
  const row = (team: Team, side: 1 | 2) => {
    const kills = side === 1 ? game?.team1Kills : game?.team2Kills;
    const deaths = side === 1 ? game?.team1Deaths : game?.team2Deaths;
    return (
      <div class="team-row">
        <label class="pick">
          <input type="radio" class="sr-only" name="winner" value={String(team.id)} checked={game?.winnerId === team.id} />
          <TeamBadge team={team} />
          <span>
            {prefix?.(team) ?? ''}
            {team.name}
          </span>
        </label>
        <input name={`t${side}_kills`} inputmode="numeric" maxlength={3} placeholder="K" value={kills == null ? '' : String(kills)} aria-label={`Kills de ${team.name}`} />
        <input name={`t${side}_deaths`} inputmode="numeric" maxlength={3} placeholder="D" value={deaths == null ? '' : String(deaths)} aria-label={`Deaths de ${team.name}`} />
      </div>
    );
  };
  return (
    <form
      class={`game ${saved ? 'saved' : 'open'}`}
      method="post"
      action={`${action}/juego/${number}`}
      data-game-form
      data-team1={String(team1.id)}
      data-team2={String(team2.id)}
    >
      <button type="submit" name="action" value="save" class="sr-only" tabindex={-1} aria-hidden="true">
        Guardar
      </button>
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input type="hidden" name={name} value={value} />
      ))}
      {imported ? <input type="hidden" name="dota_keep" value="1" /> : null}
      {multi ? (
        <div class="game-head">
          <b>Juego {number}</b>
          {saved ? <span class="pill ok">Guardado</span> : <span class="pill next">Pendiente</span>}
        </div>
      ) : null}
      <div class="kd-h">
        <span>Ganador</span>
        <span>Kills</span>
        <span>Deaths</span>
      </div>
      {row(team1, 1)}
      {row(team2, 2)}
      <details class="dota" open={imported}>
        <summary>{imported ? 'Importado de Dota' : 'Importar desde Dota (opcional)'}</summary>
        <div class="dota-body">
          <div class="dota-row">
            <input name="dota_match_id" inputmode="numeric" maxlength={15} placeholder="Match ID de Dota" value={game?.dotaMatchId == null ? '' : String(game.dotaMatchId)} aria-label="Match ID de Dota" />
            <button class="btn sm" type="button" data-dota-search>
              Buscar
            </button>
          </div>
          <p class="dota-status muted" data-dota-status role="status">
            {imported ? (
              <>
                Detalle guardado ·{' '}
                <a href={dotaLink(game!.dotaMatchId!)} target="_blank" rel="noopener">
                  Ver en OpenDota ↗
                </a>
              </>
            ) : null}
          </p>
          <div class="dota-who" data-dota-who hidden={!imported}>
            <label class="f">
              ¿Quién ganó esta partida?
              <Select name="dota_winner">
                <option value="">Elegir…</option>
                <option value={String(team1.id)} selected={imported && game?.winnerId === team1.id}>
                  {team1.name}
                </option>
                <option value={String(team2.id)} selected={imported && game?.winnerId === team2.id}>
                  {team2.name}
                </option>
              </Select>
            </label>
            <button class="btn sm" type="button" data-dota-fill>
              Autocompletar
            </button>
          </div>
        </div>
      </details>
      <div class="rc-foot">
        {saved ? (
          <button class="btn sm danger" type="submit" name="action" value="clear">
            {multi ? 'Borrar juego' : 'Borrar resultado'}
          </button>
        ) : (
          <button class="btn sm" type="reset">
            Deshacer cambios
          </button>
        )}
        <button class="btn sm pri" type="submit" name="action" value="save">
          Guardar
        </button>
      </div>
    </form>
  );
};

/** "Serie 2 – 1 · gana Team Fe" / "Serie 1 – 1 · en juego" for a match of more than one game. */
const seriesLine = (state: SeriesState, team1: Team, team2: Team): string => {
  const score = `${state.wins[0]} – ${state.wins[1]}`;
  if (state.winnerId !== null) return `Serie ${score} · gana ${state.winnerId === team1.id ? team1.name : team2.name}`;
  return state.wins[0] + state.wins[1] === 0 ? `Al mejor de ${state.length} · gana quien llegue a ${state.needed}` : `Serie ${score} · en juego`;
};

const minutesSince = (iso: string, now: Date): number => Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60000));

/** One button of a live action; each is its own form, because the game form cannot be nested. */
const LiveButton: FC<PropsWithChildren<{ action: string; number: number; verb: string; cls: string; hidden?: Record<string, string> }>> = ({ action, number, verb, cls, hidden, children }) => (
  <form class="live-form" method="post" action={`${action}/juego/${number}/en-vivo`}>
    {Object.entries(hidden ?? {}).map(([name, value]) => (
      <input type="hidden" name={name} value={value} />
    ))}
    <input type="hidden" name="action" value={verb} />
    <button class={`btn sm ${cls}`} type="submit">
      {children}
    </button>
  </form>
);

/** The live actions of one game: mark it, or (when live) remove it and move it on or off the stream. */
const LiveForm: FC<{ action: string; number: number; isLive: boolean; onStream: boolean; hidden?: Record<string, string> }> = ({ action, number, isLive, onStream, hidden }) =>
  isLive ? (
    <div class="live-actions">
      <LiveButton action={action} number={number} verb="clear" cls="stop" hidden={hidden}>
        ■ Quitar en vivo
      </LiveButton>
      <LiveButton action={action} number={number} verb={onStream ? 'unstream' : 'stream'} cls={onStream ? 'tv on' : 'tv'} hidden={hidden}>
        {onStream ? '📺 En el stream' : '📺 Pasar al stream'}
      </LiveButton>
    </div>
  ) : (
    <LiveButton action={action} number={number} verb="mark" cls="live" hidden={hidden}>
      ▶ Marcar en vivo
    </LiveButton>
  );

export const ResultCard: FC<ResultCardProps> = ({ action, header, team1, team2, prefix, match, games = [], length = 1, hidden, editHref, matchId = null, live = null, onStream = false, now = new Date() }) => {
  const saved = match?.winnerId != null;
  const isLive = live !== null && matchId !== null && live.matchId === matchId;
  const tv = isLive && onStream;
  if (!team1 || !team2) {
    return (
      <div class="rc open">
        <div class="rc-top">
          <span>{header}</span>
          <span class="pill">Por definir</span>
        </div>
        <p class="muted" style="margin:0">
          Este partido todavía no tiene los dos equipos definidos.
        </p>
        <button class="btn sm live" type="button" disabled>
          ▶ Marcar en vivo
        </button>
        <span class="hint">Se habilita cuando están los dos equipos.</span>
        {editHref ? (
          <a class="btn sm" href={editHref} style="justify-self:start">
            Definir equipos
          </a>
        ) : null}
      </div>
    );
  }

  const multi = length > 1;
  const state = resolveSeries(team1.id, team2.id, length, games);
  const byNumber = new Map(games.map((g) => [g.gameNumber, g]));
  return (
    <div class={`rc series ${saved ? 'saved' : 'open'}${tv ? ' tv' : isLive ? ' on' : ''}`}>
      <div class="rc-top">
        <span>{header}</span>
        {tv ? (
          <span class="live-badge tv">📺 EN TRANSMISIÓN · {minutesSince(live!.startedAt, now)} min</span>
        ) : isLive ? (
          <span class="live-badge">● EN VIVO · {minutesSince(live!.startedAt, now)} min</span>
        ) : saved ? (
          <span class="pill ok">Guardado</span>
        ) : games.length > 0 ? (
          <span class="pill next">En juego</span>
        ) : (
          <span class="pill next">Pendiente</span>
        )}
      </div>
      {multi ? <p class="series-line">{seriesLine(state, team1, team2)}</p> : null}
      {Array.from({ length }, (_, i) => i + 1).map((number) => {
        const game = byNumber.get(number);
        if (game || number === state.nextGame) {
          const thisLive = isLive && live!.gameNumber === number;
          return (
            <>
              {thisLive || (!game && number === state.nextGame) ? <LiveForm action={action} number={number} isLive={thisLive} onStream={onStream} hidden={hidden} /> : null}
              <GameForm action={action} number={number} multi={multi} team1={team1} team2={team2} prefix={prefix} game={game} hidden={hidden} />
            </>
          );
        }
        return (
          <div class="game off">
            <b>Juego {number}</b>
            <span class="muted">{state.decided ? 'No se juega: la serie ya está decidida.' : `Carga primero el juego ${number - 1}.`}</span>
          </div>
        );
      })}
      {state.nextGame !== null || isLive ? (
        <span class="hint">
          {isLive
            ? 'Al guardar el resultado de este juego, el «en vivo» se apaga solo.'
            : 'Se pueden marcar varios a la vez. Solo uno puede estar «en el stream». Cada uno se apaga al guardar su resultado.'}
        </span>
      ) : null}
    </div>
  );
};

const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

export const StandingsTable: FC<{ rows: StandingRow[]; qualifiers: number }> = ({ rows, qualifiers }) => (
  <div class="card scroll-x">
    <table class="std">
      <thead>
        <tr>
          <th>#</th>
          <th>Equipo</th>
          <th>PJ</th>
          <th class="opt">G</th>
          <th class="opt">P</th>
          <th>Pts</th>
          <th class="opt">K</th>
          <th class="opt">D</th>
          <th>K−D</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr class={i === qualifiers - 1 ? 'cut' : undefined}>
            <td>{row.rank}</td>
            <td>
              <TeamBadge team={{ id: row.teamId, code: row.code }} /> {row.name}
              {row.unresolvedTie ? <span class="pill next">Empate</span> : null}
            </td>
            <td>{row.played}</td>
            <td class="opt">{row.wins}</td>
            <td class="opt">{row.losses}</td>
            <td>
              <b>{row.points}</b>
            </td>
            <td class="opt">{row.kills}</td>
            <td class="opt">{row.deaths}</td>
            <td>{signed(row.diff)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <p class="muted" style="margin:10px 0 0;font-size:12px">
      La línea dorada marca el corte de clasificación (top {qualifiers}).
    </p>
  </div>
);

export interface ResultsViewProps {
  tournament: Tournament;
  cards: { match: Match; team1: Team | null; team2: Team | null }[];
  dates: string[];
  hasUndated: boolean;
  filter: string;
  standings: StandingRow[];
  gamesByMatch: Map<number, Game[]>;
  liveMarks: LiveMark[];
  now: Date;
}

export const ResultsView: FC<ResultsViewProps> = ({ tournament, cards, dates, hasUndated, filter, standings, gamesByMatch, liveMarks, now }) => (
  <>
    <PageHead
      title="Resultados"
      sub="Toca el equipo ganador, carga kills y deaths, guarda. En series de varios juegos se guarda juego por juego. La página pública se actualiza al instante."
    >
      <form method="get" class="actions">
        <Select name="fecha" data-autosubmit aria-label="Filtrar por fecha" style="width:auto">
          {dates.map((d) => (
            <option value={d} selected={filter === d}>
              {formatDate(d)}
            </option>
          ))}
          {hasUndated ? (
            <option value="sin-fecha" selected={filter === 'sin-fecha'}>
              Sin fecha
            </option>
          ) : null}
          <option value="todos" selected={filter === 'todos'}>
            Todos
          </option>
        </Select>
        <noscript>
          <button class="btn sm" type="submit">
            Ver
          </button>
        </noscript>
      </form>
    </PageHead>
    {cards.length === 0 ? (
      <div class="note">
        No hay partidos para mostrar. Genera el fixture en <a href={`/admin/t/${tournament.id}/fixture`}>Fixture</a>.
      </div>
    ) : null}
    <div class="rcards">
      {cards.map(({ match, team1, team2 }) => (
        <ResultCard
          action={`/admin/t/${tournament.id}/resultados/${match.id}`}
          header={
            <>
              {`Partido ${match.matchNumber} · Ronda ${match.round} · ${scheduleLabel(match)}`}
              {match.isTiebreak ? <span class="pill next">Juego adicional</span> : null}
            </>
          }
          team1={team1}
          team2={team2}
          match={match}
          matchId={match.id}
          live={liveMarks.find((mark) => mark.matchId === match.id) ?? null}
          onStream={tournament.streamMatchId === match.id}
          now={now}
          games={gamesByMatch.get(match.id) ?? []}
          length={seriesLengthFor(tournament, match.phase, match.isTiebreak)}
          hidden={{ fecha: filter }}
          editHref={`/admin/t/${tournament.id}/fixture/partidos/${match.id}`}
        />
      ))}
    </div>
    <h2 style="margin-top:8px">Tabla en vivo</h2>
    <StandingsTable rows={standings} qualifiers={tournament.qualifiers} />
  </>
);
