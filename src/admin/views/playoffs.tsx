import type { FC } from 'hono/jsx';
import type { Match, Schedule, Team, Tournament } from '../../db/repository.js';
import type { BracketSlot } from '../../domain/playoffs.js';
import type { TournamentState } from '../../services/state.js';
import { PageHead } from './parts.js';
import { ResultCard, scheduleLabel } from './results.js';

interface PlayoffsViewProps {
  tournament: Tournament;
  state: TournamentState;
  /** Calendar slots used for the header when a playoff match is not stored yet. */
  slots: { semifinal: Schedule[]; final: Schedule[] };
}

export const PlayoffsView: FC<PlayoffsViewProps> = ({ tournament, state, slots }) => {
  const { bracket, teamsById, teams } = state;
  const base = `/admin/t/${tournament.id}/playoffs`;
  const team = (id: number | null): Team | null => (id === null ? null : (teamsById.get(id) ?? null));
  const seedPrefix = (t: Team): string => {
    const seed = bracket.seeds.indexOf(t.id);
    return seed >= 0 ? `${seed + 1}.º ` : '';
  };
  const stored = (slot: BracketSlot): Match | undefined => state.playoffMatches.find((m) => m.id === slot.matchId);
  const when = (slot: BracketSlot, fallback: Schedule | undefined): string =>
    scheduleLabel(
      stored(slot) ?? { scheduledDate: fallback?.scheduledDate ?? null, startTime: fallback?.startTime ?? null },
    );

  const card = (slot: BracketSlot, phase: 'semifinal' | 'final', number: number, title: string, fallback?: Schedule) => (
    <ResultCard
      action={`${base}/${phase}/${number}`}
      header={`${title} · ${when(slot, fallback)}`}
      team1={team(slot.team1Id)}
      team2={team(slot.team2Id)}
      prefix={seedPrefix}
      match={stored(slot)}
    />
  );

  const champion = team(bracket.championId);
  const missing = state.pendingGroup;
  const tie = state.groupComplete && !bracket.seeded;

  return (
    <>
      <PageHead title="Playoffs" sub="Se arman solos desde la tabla cuando termina la fase de grupos." />
      {state.groupMatches.length === 0 ? (
        <div class="note">
          Todavía no hay fase de grupos. Genera el fixture en <a href={`/admin/t/${tournament.id}/fixture`}>Fixture</a>.
        </div>
      ) : missing > 0 ? (
        <div class="note">
          Fase de grupos: {missing === 1 ? 'falta 1 partido' : `faltan ${missing} partidos`}. Los cruces se completan
          automáticamente al cargar el último resultado.
        </div>
      ) : tie ? (
        <div class="note">
          Hay un empate sin resolver en la zona de clasificación. Juega una partida de desempate (en Fixture) o elige
          los equipos de las semifinales manualmente.
        </div>
      ) : null}
      <div class="bracket">
        <div class="stack">
          {card(bracket.semifinals[0], 'semifinal', 1, 'Semifinal 1', slots.semifinal[0])}
          {card(bracket.semifinals[1], 'semifinal', 2, 'Semifinal 2', slots.semifinal[1])}
        </div>
        <div class="stack">
          {card(bracket.final, 'final', 1, 'Gran final', slots.final[0])}
          <div class="champ">
            <div class="muted" style="font-size:11px;letter-spacing:.12em;text-transform:uppercase">
              Campeón
            </div>
            <b>{champion ? champion.name : 'Por definir'}</b>
          </div>
        </div>
      </div>
      <details class="card">
        <summary>Elegir equipos de las semifinales manualmente</summary>
        <form method="post" action={`${base}/cruces`} class="stack" style="margin-top:12px">
          <p class="muted" style="margin:0;font-size:12px">
            Úsalo cuando hay un empate que se resolvió fuera de la app. Guardar borra los resultados de playoffs
            existentes.
          </p>
          <div class="grid2">
            {(
              [
                ['sf1_a', 'Semifinal 1 · equipo 1', bracket.semifinals[0].team1Id],
                ['sf1_b', 'Semifinal 1 · equipo 2', bracket.semifinals[0].team2Id],
                ['sf2_a', 'Semifinal 2 · equipo 1', bracket.semifinals[1].team1Id],
                ['sf2_b', 'Semifinal 2 · equipo 2', bracket.semifinals[1].team2Id],
              ] as [string, string, number | null][]
            ).map(([name, label, selected]) => (
              <label class="f">
                {label}
                <select name={name}>
                  <option value="">Elegir…</option>
                  {teams.map((t) => (
                    <option value={String(t.id)} selected={t.id === selected}>
                      {t.code} · {t.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button class="btn pri" type="submit" style="justify-self:start">
            Guardar cruces
          </button>
        </form>
      </details>
    </>
  );
};
