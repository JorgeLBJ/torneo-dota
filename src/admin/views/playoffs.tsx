import type { FC } from 'hono/jsx';
import type { Match, Schedule, Team, Tournament } from '../../db/repository.js';
import { POSITIONS, type DeSeries, type DeSide } from '../../domain/double-elimination.js';
import type { BracketSlot } from '../../domain/playoffs.js';
import { seriesLengthFor } from '../../domain/series.js';
import type { TournamentState } from '../../services/state.js';
import { PageHead, Select } from './parts.js';
import { ResultCard, scheduleLabel } from './results.js';

interface PlayoffsViewProps {
  tournament: Tournament;
  state: TournamentState;
  /** Calendar slots used for the header when a playoff match is not stored yet. */
  slots: { semifinal: Schedule[]; final: Schedule[] };
  now: Date;
}

export const PlayoffsView: FC<PlayoffsViewProps> = ({ tournament, state, slots, now }) => {
  const { bracket, teamsById, teams } = state;
  const base = `/admin/t/${tournament.id}/playoffs`;
  // Semifinal teams saved on the matches themselves (a manual pick), as opposed to teams derived from the table.
  const manualStored = state.playoffMatches.some((m) => m.phase === 'semifinal' && (m.team1Id !== null || m.team2Id !== null));
  const hasPlayoffResults = state.playoffMatches.some((m) => m.winnerId !== null);
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
      matchId={slot.matchId}
      live={state.liveMarks.find((mark) => mark.matchId === slot.matchId) ?? null}
      onStream={slot.matchId !== null && tournament.streamMatchId === slot.matchId}
      now={now}
      games={state.gamesByMatch.get(slot.matchId ?? -1) ?? []}
      length={phase === 'final' ? tournament.finalGames : tournament.semifinalGames}
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
                <Select name={name}>
                  <option value="">Elegir…</option>
                  {teams.map((t) => (
                    <option value={String(t.id)} selected={t.id === selected}>
                      {t.code} · {t.name}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          </div>
          <p class="muted" style="margin:0;font-size:12px">
            {hasPlayoffResults
              ? 'Hay resultados de playoffs: para volver al cálculo automático usa "Quitar cruces manuales" (borra esos resultados).'
              : `Para volver al cálculo automático deja los cuatro vacíos y guarda${manualStored ? ', o usa "Quitar cruces manuales"' : ''}.`}
          </p>
          <div class="actions">
            <button class="btn pri" type="submit">
              Guardar cruces
            </button>
            {manualStored ? (
              <button class="btn danger" type="submit" name="action" value="reset" data-confirm-open="resetCrossesDialog">
                Quitar cruces manuales
              </button>
            ) : null}
          </div>
          {manualStored ? (
            <dialog id="resetCrossesDialog" class="confirm-modal" aria-labelledby="resetCrossesTitle">
              <h2 id="resetCrossesTitle">¿Quitar los cruces manuales?</h2>
              <p>
                Los cruces volverán a calcularse automáticamente desde la tabla.
                {hasPlayoffResults ? ' Se borrarán los resultados de semifinales y final.' : ''}
              </p>
              <div class="actions">
                <button class="btn" type="button" autofocus data-confirm-cancel>
                  Cancelar
                </button>
                <button class="btn pri" type="submit" name="action" value="reset">
                  Quitar cruces manuales
                </button>
              </div>
            </dialog>
          ) : null}
        </form>
      </details>
    </>
  );
};

interface DoubleEliminationViewProps {
  tournament: Tournament;
  state: TournamentState;
  now: Date;
}

const SIDES: { side: DeSide; title: string }[] = [
  { side: 'upper', title: 'Bracket superior' },
  { side: 'lower', title: 'Bracket inferior' },
  { side: 'grand', title: 'Gran final' },
];

/** The "Llaves" screen of a double-elimination tournament: positions A–F, then the ten series by side and round. */
export const DoubleEliminationView: FC<DoubleEliminationViewProps> = ({ tournament, state, now }) => {
  const bracket = state.doubleElimination!;
  const { teamsById, teams } = state;
  const base = `/admin/t/${tournament.id}/playoffs`;
  const team = (id: number | null): Team | null => (id === null ? null : (teamsById.get(id) ?? null));
  const placed = POSITIONS.every((p) => bracket.positions[p] !== null);
  const anyStored = state.playoffMatches.length > 0;
  const hasResults = state.playoffMatches.some((m) => (state.gamesByMatch.get(m.id) ?? []).length > 0);
  const champion = team(bracket.championId);

  const card = (s: DeSeries) => {
    const length = seriesLengthFor(tournament, s.phase, false);
    const t1 = team(s.team1Id);
    const t2 = team(s.team2Id);
    const match = state.playoffMatches.find((m) => m.id === s.matchId);
    return (
      <div class="de-series">
        {t1 && t2 ? null : (
          <p class="de-seats muted">
            {t1?.name ?? s.sources[0]} vs {t2?.name ?? s.sources[1]} · Al mejor de {length}
          </p>
        )}
        <form method="post" action={`${base}/llave/${s.key}/horario`} class="de-when">
          <input type="date" name="date" value={match?.scheduledDate ?? ''} aria-label={`Fecha de ${s.code}`} />
          <input type="time" name="time" value={match?.startTime ?? ''} aria-label={`Hora de ${s.code}`} />
          <button class="btn sm" type="submit">
            Guardar horario
          </button>
        </form>
        <ResultCard
          action={`${base}/llave/${s.key}`}
          header={`${s.code} · ${s.label} · BO${length}`}
          team1={t1}
          team2={t2}
          match={match}
          matchId={s.matchId}
          live={state.liveMarks.find((mark) => mark.matchId === s.matchId) ?? null}
          onStream={s.matchId !== null && tournament.streamMatchId === s.matchId}
          now={now}
          games={state.gamesByMatch.get(s.matchId ?? -1) ?? []}
          length={length}
        />
      </div>
    );
  };

  return (
    <>
      <PageHead title="Llaves" sub="Doble eliminación: los ganadores avanzan y los perdedores de la llave superior bajan a la inferior." />
      <form method="post" action={`${base}/posiciones`} class="card stack">
        <h2>Posiciones</h2>
        <p class="muted" style="margin:0;font-size:12px">
          A vs B y C vs D abren la llave superior; E espera al ganador de A/B y F al de C/D. Cambiar una posición borra
          los resultados que dependían de ella.
        </p>
        <div class="de-positions">
          {POSITIONS.map((p) => (
            <label class="f">
              Posición {p}
              <Select name={`pos_${p.toLowerCase()}`}>
                <option value="">Elegir…</option>
                {teams.map((t) => (
                  <option value={String(t.id)} selected={t.id === bracket.positions[p]}>
                    {t.code} · {t.name}
                  </option>
                ))}
              </Select>
            </label>
          ))}
        </div>
        {teams.length < POSITIONS.length ? (
          <p class="note" style="margin:0">
            Hacen falta 6 equipos: agrégalos en <a href={`/admin/t/${tournament.id}/equipos`}>Equipos</a>.
          </p>
        ) : null}
        <div class="actions">
          <button class="btn pri" type="submit" name="action" value="save">
            Guardar posiciones
          </button>
          {anyStored ? (
            <button class="btn danger" type="submit" name="action" value="reset" data-confirm-open="resetBracketDialog">
              Reiniciar llaves
            </button>
          ) : null}
        </div>
        {anyStored ? (
          <dialog id="resetBracketDialog" class="confirm-modal" aria-labelledby="resetBracketTitle">
            <h2 id="resetBracketTitle">¿Reiniciar las llaves?</h2>
            <p>
              Se borran las posiciones A–F{hasResults ? ' y todos los resultados de las llaves' : ''}. No se puede deshacer.
            </p>
            <div class="actions">
              <button class="btn" type="button" autofocus data-confirm-cancel>
                Cancelar
              </button>
              <button class="btn pri" type="submit" name="action" value="reset">
                Reiniciar llaves
              </button>
            </div>
          </dialog>
        ) : null}
      </form>
      {placed ? null : (
        <div class="note">Asigna las seis posiciones para empezar a cargar resultados.</div>
      )}
      {SIDES.map(({ side, title }) => {
        const series = bracket.series.filter((s) => s.side === side);
        const rounds = [...new Set(series.map((s) => s.round))];
        return (
          <section class="stack de-side">
            <h2>{title}</h2>
            <div class="de-rounds">
              {rounds.map((round) => (
                <div class="stack">{series.filter((s) => s.round === round).map(card)}</div>
              ))}
              {side === 'grand' ? (
                <div class="champ">
                  <div class="muted" style="font-size:11px;letter-spacing:.12em;text-transform:uppercase">
                    Campeón
                  </div>
                  <b>{champion ? champion.name : 'Por definir'}</b>
                </div>
              ) : null}
            </div>
          </section>
        );
      })}
    </>
  );
};
