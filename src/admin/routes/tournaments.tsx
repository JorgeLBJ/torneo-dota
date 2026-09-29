import { Hono } from 'hono';
import type { AdminEnv, Deps } from '../context.js';
import { readBody, str } from '../form.js';
import { setFlash } from '../flash.js';
import { renderPage } from '../render.js';
import { describeStatus, loadState } from '../../services/state.js';
import { TournamentsView } from '../views/tournaments.js';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RESERVED_SLUGS = new Set(['admin', 'assets', 'api', 't', 'static']);

export function tournamentListRoutes(deps: Deps) {
  const app = new Hono<AdminEnv>();
  const { repo } = deps;

  app.get('/', (c) => {
    const active = repo.getActiveTournament();
    return c.redirect(active ? `/admin/t/${active.id}/resultados` : '/admin/torneos', 303);
  });

  app.get('/torneos', (c) => {
    const rows = repo.listTournaments().map((tournament) => {
      const state = loadState(repo, tournament);
      const { label, cls } = describeStatus(state);
      return { tournament, teamCount: state.teams.length, status: label, statusClass: cls };
    });
    return renderPage(c, deps, { title: 'Torneos', active: 'torneos', tournament: repo.getActiveTournament() }, (
      <TournamentsView rows={rows} />
    ));
  });

  app.post('/torneos', async (c) => {
    const body = await readBody(c);
    const name = str(body, 'name');
    const slug = str(body, 'slug').toLowerCase();
    const fail = (message: string) => {
      setFlash(c, 'error', message);
      return c.redirect('/admin/torneos', 303);
    };
    if (name.length < 1 || name.length > 80) return fail('Escribe un nombre de hasta 80 caracteres.');
    if (slug.length < 2 || slug.length > 60 || !SLUG.test(slug)) {
      return fail('La URL pública solo admite minúsculas, números y guiones (por ejemplo: torneo-oct-2026).');
    }
    if (RESERVED_SLUGS.has(slug)) return fail(`La URL pública "${slug}" está reservada.`);
    if (repo.getTournamentBySlug(slug)) return fail(`Ya existe un torneo con la URL "${slug}".`);

    const tournament = repo.createTournament({ name, slug });
    if (!repo.getActiveTournament()) repo.setActiveTournament(tournament.id);
    deps.events.tournamentChanged(tournament.id);
    setFlash(c, 'ok', `Torneo "${name}" creado.`);
    return c.redirect(`/admin/t/${tournament.id}/config`, 303);
  });

  app.post('/t/:id/activar', (c) => {
    const id = Number(c.req.param('id'));
    const tournament = Number.isInteger(id) ? repo.getTournamentById(id) : undefined;
    if (!tournament) return c.text('Torneo no encontrado.', 404);
    const previous = repo.getActiveTournament();
    repo.setActiveTournament(tournament.id);
    deps.events.tournamentChanged(tournament.id);
    if (previous) deps.events.tournamentChanged(previous.id);
    setFlash(c, 'ok', `"${tournament.name}" es ahora el torneo activo (se muestra en la portada).`);
    return c.redirect('/admin/torneos', 303);
  });

  return app;
}
