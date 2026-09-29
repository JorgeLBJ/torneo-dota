import type { FC } from 'hono/jsx';
import type { Match, Team, Tournament } from '../../db/repository.js';
import type { RoundRobinSummary } from '../../domain/fixture.js';
import { TeamBadge } from './layout.js';
import { PageHead } from './parts.js';
import { scheduleLabel } from './results.js';

export interface FixtureViewProps {
  tournament: Tournament;
  teams: Team[];
  matches: Match[];
  summary: RoundRobinSummary;
  hasResults: boolean;
}

const summaryText = (teamCount: number, s: RoundRobinSummary): string => {
  if (teamCount < 2) return `${teamCount} equipos: se necesitan al menos 2 para generar el fixture.`;
  const byes = s.byesPerRound === 0 ? 'sin descansos' : `${s.byesPerRound} descansa por ronda`;
  return `${teamCount} equipos → ${s.rounds} rondas · ${s.matches} partidos · ${byes}`;
};

export const FixtureView: FC<FixtureViewProps> = ({ tournament, teams, matches, summary, hasResults }) => {
  const base = `/admin/t/${tournament.id}/fixture`;
  const byId = new Map(teams.map((t) => [t.id, t]));
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  const format = tournament.groupLegs === 2 ? 'Ida y vuelta' : 'Una vuelta';

  const badge = (id: number | null) => {
    const team = id === null ? undefined : byId.get(id);
    return team ? <TeamBadge team={team} /> : <span class="badge ph">?</span>;
  };

  return (
    <>
      <PageHead title="Fixture" sub="Se adapta solo a la cantidad de equipos.">
        <form method="post" action={`${base}/regenerar`} class="actions">
          {hasResults ? (
            <label class="f" style="display:flex;gap:6px;align-items:center">
              <input type="checkbox" name="confirm" value="yes" />
              Confirmo que se borrarán los resultados cargados
            </label>
          ) : null}
          <button class="btn pri" type="submit">
            ⟳ Regenerar
          </button>
        </form>
      </PageHead>
      <div class="card" style="display:flex;flex-wrap:wrap;gap:12px 24px;align-items:end">
        <div style="display:grid;gap:2px">
          <span class="muted" style="font-size:11px;letter-spacing:.1em;text-transform:uppercase">
            Formato
          </span>
          <b>{format}</b>
          <span class="muted" style="font-size:12px">
            Se cambia en <a href={`/admin/t/${tournament.id}/reglas`}>Reglas</a>.
          </span>
        </div>
        <div style="display:grid;gap:2px">
          <span class="muted" style="font-size:11px;letter-spacing:.1em;text-transform:uppercase">
            Resultado
          </span>
          <b>{summaryText(teams.length, summary)}</b>
        </div>
        <div class="muted" style="font-size:12px;flex-basis:100%">
          Referencia: 6 equipos → 5 rondas · 8 equipos → 7 rondas · 10 equipos → 9 rondas. Ida y vuelta duplica las
          rondas.
        </div>
      </div>
      <div class="note">
        Regenerar crea el fixture y lo reparte en el calendario de grupos. Puedes mover partidos entre rondas, agregar
        partidos sueltos o rondas extra (por ejemplo, una partida de desempate).
      </div>
      <div class="card">
        {rounds.length === 0 ? <p class="muted">Todavía no hay partidos. Usa Regenerar para crear el fixture.</p> : null}
        {rounds.map((round) => {
          const inRound = matches.filter((m) => m.round === round);
          const playing = new Set(inRound.flatMap((m) => [m.team1Id, m.team2Id]));
          const resting = teams.length % 2 === 1 ? teams.filter((t) => !playing.has(t.id)) : [];
          return (
            <div class="round">
              <div class="rh">
                <b>Ronda {round}</b>
                <span class="muted">{scheduleLabel(inRound[0]!)}</span>
              </div>
              <div class="pairs">
                {inRound.map((m) => (
                  <span class="pair">
                    {badge(m.team1Id)} vs {badge(m.team2Id)}
                    {m.winnerId !== null ? <span class="pill ok">✓</span> : null}
                    <a class="btn sm" href={`${base}/partidos/${m.id}`} title="Editar" aria-label={`Editar partido ${m.matchNumber}`}>
                      ✎
                    </a>
                  </span>
                ))}
                {resting.length === 1 ? <span class="pair bye">Descansa {badge(resting[0]!.id)}</span> : null}
                <form method="post" action={`${base}/rondas/${round}/partido`} class="inline">
                  <button class="btn sm" type="submit">
                    + partido
                  </button>
                </form>
              </div>
            </div>
          );
        })}
      </div>
      <div class="actions">
        <form method="post" action={`${base}/rondas`} class="inline">
          <button class="btn" type="submit">
            + Agregar ronda
          </button>
        </form>
        <form method="post" action={`${base}/desempate`} class="inline">
          <button class="btn" type="submit">
            + Agregar partida de desempate
          </button>
        </form>
      </div>
    </>
  );
};

export const MatchEditView: FC<{ tournament: Tournament; teams: Team[]; match: Match }> = ({ tournament, teams, match }) => {
  const base = `/admin/t/${tournament.id}/fixture`;
  const teamSelect = (name: string, selected: number | null, label: string) => (
    <label class="f">
      {label}
      <select name={name}>
        <option value="">Por definir</option>
        {teams.map((t) => (
          <option value={String(t.id)} selected={t.id === selected}>
            {t.code} · {t.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <PageHead title="Editar partido" sub={`Partido ${match.matchNumber} · Ronda ${match.round}`}>
        <a class="btn sm" href={base}>
          ← Volver al fixture
        </a>
      </PageHead>
      <form class="card stack narrow" method="post" action={`${base}/partidos/${match.id}`}>
        <label class="f">
          Ronda
          <input type="number" name="round" value={String(match.round)} min={1} required />
        </label>
        <div class="grid2">
          <label class="f">
            Fecha
            <input type="date" name="date" value={match.scheduledDate ?? ''} />
          </label>
          <label class="f">
            Hora de inicio
            <input type="time" name="start_time" value={match.startTime ?? ''} />
          </label>
          <label class="f">
            Hora de fin
            <input type="time" name="end_time" value={match.endTime ?? ''} />
          </label>
        </div>
        {teamSelect('team1', match.team1Id, 'Equipo 1')}
        {teamSelect('team2', match.team2Id, 'Equipo 2')}
        {match.winnerId !== null ? (
          <p class="muted" style="margin:0;font-size:12px">
            Este partido tiene resultado: si cambias los equipos, el resultado se borra.
          </p>
        ) : null}
        <button class="btn pri" type="submit">
          Guardar
        </button>
      </form>
      <form method="post" action={`${base}/partidos/${match.id}/eliminar`}>
        <button class="btn danger" type="submit">
          Eliminar partido
        </button>
      </form>
    </>
  );
};
