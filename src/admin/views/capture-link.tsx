import type { FC } from 'hono/jsx';
import type { Match, Team, Tournament } from '../../db/repository.js';
import { Select } from './parts.js';

export interface LinkMatchOption {
  match: Match;
  label: string;
}

export interface LinkSlot {
  number: number;
  /** The game already has a saved result. */
  hasResult: boolean;
}

export interface LinkFormProps {
  captureId: number;
  tournaments: Tournament[];
  tournamentId: number | null;
  matches: LinkMatchOption[];
  matchId: number | null;
  teams: [Team, Team] | null;
  slots: LinkSlot[];
  /** What the admin already picked (kept across the confirmation step). */
  chosen: { game: number | null; radiant: number | null };
  /** The game picked already has a result: the next submit has to say it is fine to replace it. */
  confirm: boolean;
}

/** "Fecha 2 · Equipo A vs Equipo B" for the match select. */
export function matchOptionLabel(match: Match, teams: Map<number, Team>): string {
  const where = match.phase === 'group' ? `Fecha ${match.round}` : match.phase === 'final' ? 'Gran final' : `Semifinal ${match.matchNumber}`;
  const name = (id: number | null) => (id === null ? '—' : (teams.get(id)?.name ?? '—'));
  return `${where}${match.isTiebreak ? ' (desempate)' : ''} · ${name(match.team1Id)} vs ${name(match.team2Id)}`;
}

/**
 * Two steps without a client build: the first form (GET) picks tournament and match and reloads the page; the second
 * (POST) picks the game slot and who played Radiant, and saves.
 */
export const LinkForm: FC<LinkFormProps> = ({ captureId, tournaments, tournamentId, matches, matchId, teams, slots, chosen, confirm }) => (
  <section class="card link-card">
    <h2>Vincular a un juego del torneo</h2>
    <form class="link-grid" method="get" action={`/admin/capturas/${captureId}`}>
      <label class="f">
        Torneo
        <Select name="torneo" data-autosubmit>
          {tournaments.map((t) => (
            <option value={String(t.id)} selected={t.id === tournamentId}>
              {t.name}
            </option>
          ))}
        </Select>
      </label>
      <label class="f">
        Partido
        <Select name="partido" data-autosubmit>
          <option value="">Elegir…</option>
          {matches.map(({ match, label }) => (
            <option value={String(match.id)} selected={match.id === matchId}>
              {label}
            </option>
          ))}
        </Select>
      </label>
      <noscript>
        <button class="btn" type="submit">
          Continuar
        </button>
      </noscript>
    </form>
    {tournamentId !== null && matches.length === 0 ? <p class="muted">Este torneo no tiene partidos con los dos equipos definidos.</p> : null}
    {teams && matchId !== null && tournamentId !== null ? (
      <form class="link-grid" method="post" action={`/admin/capturas/${captureId}/vincular`}>
        <input type="hidden" name="torneo" value={String(tournamentId)} />
        <input type="hidden" name="partido" value={String(matchId)} />
        {confirm ? <input type="hidden" name="confirmar" value="1" /> : null}
        <label class="f">
          Juego
          <Select name="juego">
            {slots.map((s) => (
              <option value={String(s.number)} selected={s.number === (chosen.game ?? slots.find((x) => !x.hasResult)?.number ?? slots[0]?.number)}>
                Juego {s.number}
                {s.hasResult ? ' · ya tiene resultado' : ''}
              </option>
            ))}
          </Select>
        </label>
        <label class="f">
          ¿Quién jugó de Radiant?
          <Select name="radiant">
            {teams.map((team) => (
              <option value={String(team.id)} selected={team.id === chosen.radiant}>
                {team.name}
              </option>
            ))}
          </Select>
        </label>
        {confirm ? (
          <div class="note" role="alert">
            Ese juego ya tiene un resultado guardado. Si continúas, se reemplaza por el de esta captura.
          </div>
        ) : null}
        <button class={`btn ${confirm ? 'danger' : 'pri'}`} type="submit">
          {confirm ? 'Sobrescribir y vincular' : 'Vincular y guardar resultado'}
        </button>
      </form>
    ) : null}
    <p class="muted">
      Guarda ganador, kills/deaths y el detalle por jugador en ese juego, igual que «Importar desde Dota». Si ese juego ya tiene resultado, se pide confirmación.
    </p>
  </section>
);
