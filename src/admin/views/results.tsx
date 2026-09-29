import type { Child, FC } from 'hono/jsx';
import type { Match, Team, Tournament } from '../../db/repository.js';
import type { StandingRow } from '../../domain/standings.js';
import { TeamBadge } from './layout.js';
import { PageHead } from './parts.js';

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "2026-10-03" -> "Sáb 03 oct" (calendar date only, no timezone involved). */
export function dateLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]}`;
}

/** "2026-10-03" -> "03 oct". */
export function shortDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]}`;
}

export const scheduleLabel = (m: Pick<Match, 'scheduledDate' | 'startTime'>): string =>
  [m.scheduledDate ? shortDate(m.scheduledDate) : null, m.startTime].filter(Boolean).join(' ') || 'Sin horario';

export interface ResultCardProps {
  action: string;
  header: Child;
  team1: Team | null;
  team2: Team | null;
  /** Optional text before a team name (for example a playoff seed "1.º "). */
  prefix?: (team: Team) => string;
  match?: Pick<Match, 'winnerId' | 'team1Kills' | 'team1Deaths' | 'team2Kills' | 'team2Deaths'>;
  hidden?: Record<string, string>;
  editHref?: string;
}

export const ResultCard: FC<ResultCardProps> = ({ action, header, team1, team2, prefix, match, hidden, editHref }) => {
  const saved = match?.winnerId != null;
  const row = (team: Team, side: 1 | 2) => {
    const kills = side === 1 ? match?.team1Kills : match?.team2Kills;
    const deaths = side === 1 ? match?.team1Deaths : match?.team2Deaths;
    return (
      <div class="team-row">
        <label class="pick">
          <input type="radio" class="sr-only" name="winner" value={String(team.id)} checked={match?.winnerId === team.id} />
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
        {editHref ? (
          <a class="btn sm" href={editHref} style="justify-self:start">
            Definir equipos
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <form class={`rc ${saved ? 'saved' : 'open'}`} method="post" action={action}>
      <button type="submit" name="action" value="save" class="sr-only" tabindex={-1} aria-hidden="true">
        Guardar
      </button>
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input type="hidden" name={name} value={value} />
      ))}
      <div class="rc-top">
        <span>{header}</span>
        {saved ? <span class="pill ok">Guardado</span> : <span class="pill next">Pendiente</span>}
      </div>
      <div class="kd-h">
        <span>Ganador</span>
        <span>Kills</span>
        <span>Deaths</span>
      </div>
      {row(team1, 1)}
      {row(team2, 2)}
      <div class="rc-foot">
        {saved ? (
          <button class="btn sm danger" type="submit" name="action" value="clear">
            Borrar resultado
          </button>
        ) : (
          <button class="btn sm" type="reset">
            Limpiar
          </button>
        )}
        <button class="btn sm pri" type="submit" name="action" value="save">
          Guardar
        </button>
      </div>
    </form>
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
          <th>G</th>
          <th>P</th>
          <th>Pts</th>
          <th>K</th>
          <th>D</th>
          <th>K−D</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr class={i === qualifiers - 1 ? 'cut' : undefined}>
            <td>{row.rank}</td>
            <td>
              <TeamBadge team={{ id: row.teamId, code: row.code }} /> {row.name}
              {row.unresolvedTie ? <span class="pill next"> Empate</span> : null}
            </td>
            <td>{row.played}</td>
            <td>{row.wins}</td>
            <td>{row.losses}</td>
            <td>
              <b>{row.points}</b>
            </td>
            <td>{row.kills}</td>
            <td>{row.deaths}</td>
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
}

export const ResultsView: FC<ResultsViewProps> = ({ tournament, cards, dates, hasUndated, filter, standings }) => (
  <>
    <PageHead
      title="Resultados"
      sub="Toca el equipo ganador, carga kills y deaths, guarda. La página pública se actualiza al instante."
    >
      <form method="get" class="actions">
        <select name="fecha" data-autosubmit aria-label="Filtrar por fecha" style="width:auto">
          {dates.map((d) => (
            <option value={d} selected={filter === d}>
              {dateLabel(d)}
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
        </select>
        <button class="btn sm" type="submit">
          Ver
        </button>
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
          header={`Partido ${match.matchNumber} · Ronda ${match.round} · ${scheduleLabel(match)}`}
          team1={team1}
          team2={team2}
          match={match}
          hidden={{ fecha: filter }}
          editHref={`/admin/t/${tournament.id}/fixture/partidos/${match.id}`}
        />
      ))}
    </div>
    <h2 style="margin-top:8px">Tabla en vivo</h2>
    <StandingsTable rows={standings} qualifiers={tournament.qualifiers} />
  </>
);
