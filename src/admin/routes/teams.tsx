import { Hono } from 'hono';
import { getHero, isHeroSlug } from '../../data/heroes.js';
import type { Team } from '../../db/repository.js';
import type { AdminEnv, Deps } from '../context.js';
import { readBody, str, type Body } from '../form.js';
import { setFlash } from '../flash.js';
import { renderPage } from '../render.js';
import { fail, ok, type Checked } from '../validate.js';
import { TeamsView } from '../views/teams.js';

interface TeamInput {
  code: string;
  name: string;
  captain: string | null;
  hero: string | null;
}

function parseTeam(body: Body, others: Team[]): Checked<TeamInput> {
  const code = str(body, 'code').toUpperCase();
  if (!/^[A-Z0-9]{1,4}$/.test(code)) return fail('El código debe tener de 1 a 4 letras o números.');
  const name = str(body, 'name');
  if (name.length < 1 || name.length > 40) return fail('El nombre del equipo es obligatorio (máximo 40 caracteres).');
  const captain = str(body, 'captain');
  if (captain.length > 40) return fail('El nombre del capitán admite hasta 40 caracteres.');
  const duplicate = others.find((t) => t.code === code);
  if (duplicate) return fail(`Ya existe un equipo con el código "${code}".`);
  const hero = str(body, 'hero');
  if (hero !== '') {
    if (!isHeroSlug(hero)) return fail('Elige un héroe válido de la lista.');
    const owner = others.find((t) => t.hero === hero);
    if (owner) return fail(`El héroe ${getHero(hero)!.name} ya lo usa el equipo ${owner.code}.`);
  }
  return ok({ code, name, captain: captain === '' ? null : captain, hero: hero === '' ? null : hero });
}

export function teamRoutes(deps: Deps) {
  const app = new Hono<AdminEnv>();
  const { repo } = deps;

  app.get('/equipos', (c) => {
    const tournament = c.get('tournament');
    return renderPage(
      c,
      deps,
      { title: 'Equipos', active: 'equipos', tournament },
      <TeamsView
        tournament={tournament}
        teams={repo.listTeams(tournament.id)}
        hasFixture={repo.listMatches(tournament.id, 'group').length > 0}
      />,
    );
  });

  app.post('/equipos', async (c) => {
    const tournament = c.get('tournament');
    const back = `/admin/t/${tournament.id}/equipos`;
    const parsed = parseTeam(await readBody(c), repo.listTeams(tournament.id));
    if (!parsed.ok) {
      setFlash(c, 'error', parsed.error);
      return c.redirect(back, 303);
    }
    repo.createTeam(tournament.id, parsed.value);
    deps.events.tournamentChanged(tournament.id);
    if (repo.listMatches(tournament.id, 'group').length > 0) {
      setFlash(c, 'warn', `Equipo ${parsed.value.code} agregado. Regenera el fixture para incluirlo.`);
    } else {
      setFlash(c, 'ok', `Equipo ${parsed.value.code} agregado.`);
    }
    return c.redirect(back, 303);
  });

  /** Loads a team of the current tournament or answers 404. */
  const ownTeam = (tournamentId: number, raw: string | undefined): Team | undefined => {
    const id = Number(raw);
    const team = Number.isInteger(id) ? repo.getTeam(id) : undefined;
    return team && team.tournamentId === tournamentId ? team : undefined;
  };

  app.post('/equipos/:teamId', async (c) => {
    const tournament = c.get('tournament');
    const team = ownTeam(tournament.id, c.req.param('teamId'));
    if (!team) return c.text('Equipo no encontrado.', 404);
    const others = repo.listTeams(tournament.id).filter((t) => t.id !== team.id);
    const parsed = parseTeam(await readBody(c), others);
    if (!parsed.ok) {
      setFlash(c, 'error', parsed.error);
    } else {
      repo.updateTeam(team.id, parsed.value);
      deps.events.tournamentChanged(tournament.id);
      setFlash(c, 'ok', `Equipo ${parsed.value.code} guardado.`);
    }
    return c.redirect(`/admin/t/${tournament.id}/equipos`, 303);
  });

  app.post('/equipos/:teamId/eliminar', (c) => {
    const tournament = c.get('tournament');
    const team = ownTeam(tournament.id, c.req.param('teamId'));
    if (!team) return c.text('Equipo no encontrado.', 404);
    if (repo.teamHasMatches(team.id)) {
      setFlash(
        c,
        'error',
        `No se puede eliminar a ${team.name} (${team.code}) porque tiene partidos en el fixture. Regenera el fixture sin ese equipo o elimina sus partidos primero.`,
      );
    } else {
      repo.deleteTeam(team.id);
      deps.events.tournamentChanged(tournament.id);
      setFlash(c, 'ok', `Equipo ${team.code} eliminado.`);
    }
    return c.redirect(`/admin/t/${tournament.id}/equipos`, 303);
  });

  return app;
}
