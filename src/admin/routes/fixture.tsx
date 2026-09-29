import { Hono } from 'hono';
import type { Match } from '../../db/repository.js';
import { addMinutes, describeRoundRobin, isValidTime } from '../../domain/fixture.js';
import {
  FixtureError,
  addBlankMatch,
  addRound,
  editMatch,
  regenerateFixture,
  tiedTeamIds,
} from '../../services/fixture.js';
import { loadState } from '../../services/state.js';
import type { AdminEnv, Deps } from '../context.js';
import { isDate, positiveInt, readBody, str } from '../form.js';
import { setFlash } from '../flash.js';
import { renderPage } from '../render.js';
import { FixtureView, MatchEditView } from '../views/fixture.js';

export function fixtureRoutes(deps: Deps) {
  const app = new Hono<AdminEnv>();
  const { repo } = deps;

  const ownGroupMatch = (tournamentId: number, raw: string | undefined): Match | undefined => {
    const id = Number(raw);
    const match = Number.isInteger(id) ? repo.getMatch(id) : undefined;
    return match && match.tournamentId === tournamentId && match.phase === 'group' ? match : undefined;
  };

  app.get('/fixture', (c) => {
    const tournament = c.get('tournament');
    const teams = repo.listTeams(tournament.id);
    return renderPage(
      c,
      deps,
      { title: 'Fixture', active: 'fixture', tournament },
      <FixtureView
        tournament={tournament}
        teams={teams}
        matches={repo.listMatches(tournament.id, 'group')}
        summary={describeRoundRobin(teams.length, tournament.groupLegs)}
        hasResults={repo.hasResults(tournament.id)}
      />,
    );
  });

  app.post('/fixture/regenerar', async (c) => {
    const tournament = c.get('tournament');
    const back = `/admin/t/${tournament.id}/fixture`;
    const body = await readBody(c);
    if (repo.hasResults(tournament.id) && str(body, 'confirm') !== 'yes') {
      setFlash(c, 'error', 'Hay resultados cargados. Regenerar los borra: marca la casilla para confirmar que quieres continuar.');
      return c.redirect(back, 303);
    }
    try {
      const result = regenerateFixture(repo, tournament);
      deps.events.tournamentChanged(tournament.id);
      setFlash(
        c,
        result.scheduled ? 'ok' : 'warn',
        `Fixture generado: ${result.rounds} rondas, ${result.matches} partidos.` +
          (result.scheduled ? '' : ' No hay días de grupos en el calendario, así que los partidos no tienen fecha.'),
      );
    } catch (error) {
      if (!(error instanceof FixtureError)) throw error;
      setFlash(c, 'error', error.message);
    }
    return c.redirect(back, 303);
  });

  app.get('/fixture/partidos/:mid', (c) => {
    const tournament = c.get('tournament');
    const match = ownGroupMatch(tournament.id, c.req.param('mid'));
    if (!match) return c.text('Partido no encontrado.', 404);
    return renderPage(
      c,
      deps,
      { title: 'Editar partido', active: 'fixture', tournament },
      <MatchEditView tournament={tournament} teams={repo.listTeams(tournament.id)} match={match} />,
    );
  });

  app.post('/fixture/partidos/:mid', async (c) => {
    const tournament = c.get('tournament');
    const match = ownGroupMatch(tournament.id, c.req.param('mid'));
    if (!match) return c.text('Partido no encontrado.', 404);
    const editUrl = `/admin/t/${tournament.id}/fixture/partidos/${match.id}`;
    const body = await readBody(c);
    const error = (message: string) => {
      setFlash(c, 'error', message);
      return c.redirect(editUrl, 303);
    };

    const round = positiveInt(str(body, 'round'));
    if (round === null || round > 999) return error('La ronda debe ser un número entero mayor que 0.');
    const date = str(body, 'date');
    if (date !== '' && !isDate(date)) return error('La fecha no es válida.');
    const start = str(body, 'start_time');
    let end = str(body, 'end_time');
    if ((start !== '' && !isValidTime(start)) || (end !== '' && !isValidTime(end))) {
      return error('La hora no es válida (usa HH:MM).');
    }
    if (end !== '' && start === '') return error('Indica también la hora de inicio.');
    if (start !== '' && end === '') end = addMinutes(start, 60);

    const validIds = new Set(repo.listTeams(tournament.id).map((t) => t.id));
    const teamId = (key: string): number | null | undefined => {
      const raw = str(body, key);
      if (raw === '') return null;
      const id = Number(raw);
      return Number.isInteger(id) && validIds.has(id) ? id : undefined;
    };
    const team1Id = teamId('team1');
    const team2Id = teamId('team2');
    if (team1Id === undefined || team2Id === undefined) return error('Elige equipos de este torneo.');
    if (team1Id !== null && team1Id === team2Id) return error('Los dos equipos deben ser distintos.');

    const { resultCleared } = editMatch(repo, match, {
      round,
      scheduledDate: date === '' ? null : date,
      startTime: start === '' ? null : start,
      endTime: end === '' ? null : end,
      team1Id,
      team2Id,
    });
    deps.events.tournamentChanged(tournament.id);
    if (resultCleared) setFlash(c, 'warn', 'Partido guardado. Se borró el resultado porque cambiaron los equipos.');
    else setFlash(c, 'ok', 'Partido guardado.');
    return c.redirect(`/admin/t/${tournament.id}/fixture`, 303);
  });

  app.post('/fixture/partidos/:mid/eliminar', (c) => {
    const tournament = c.get('tournament');
    const match = ownGroupMatch(tournament.id, c.req.param('mid'));
    if (!match) return c.text('Partido no encontrado.', 404);
    const back = `/admin/t/${tournament.id}/fixture`;
    if (match.winnerId !== null) {
      setFlash(c, 'error', 'No se puede eliminar un partido con resultado. Bórralo primero en Resultados.');
      return c.redirect(back, 303);
    }
    repo.deleteMatch(match.id);
    repo.renumberGroupMatches(tournament.id);
    deps.events.tournamentChanged(tournament.id);
    setFlash(c, 'ok', 'Partido eliminado.');
    return c.redirect(back, 303);
  });

  app.post('/fixture/rondas/:round/partido', (c) => {
    const tournament = c.get('tournament');
    const round = positiveInt(c.req.param('round'));
    if (round === null) return c.text('Ronda no encontrada.', 404);
    const match = addBlankMatch(repo, tournament.id, round);
    deps.events.tournamentChanged(tournament.id);
    return c.redirect(`/admin/t/${tournament.id}/fixture/partidos/${match.id}`, 303);
  });

  app.post('/fixture/rondas', (c) => {
    const tournament = c.get('tournament');
    const match = addRound(repo, tournament.id);
    deps.events.tournamentChanged(tournament.id);
    return c.redirect(`/admin/t/${tournament.id}/fixture/partidos/${match.id}`, 303);
  });

  app.post('/fixture/desempate', (c) => {
    const tournament = c.get('tournament');
    const match = addRound(repo, tournament.id);
    const tied = tiedTeamIds(loadState(repo, tournament).standings);
    if (tied) repo.updateMatchTeams(match.id, tied[0], tied[1]);
    deps.events.tournamentChanged(tournament.id);
    setFlash(c, 'ok', 'Partida de desempate creada: completa la fecha y los equipos.');
    return c.redirect(`/admin/t/${tournament.id}/fixture/partidos/${match.id}`, 303);
  });

  return app;
}
