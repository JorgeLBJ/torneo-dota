import { Hono } from 'hono';
import type { AdminEnv, Deps } from '../context.js';
import { readBody, str } from '../form.js';
import { setFlash } from '../flash.js';
import { renderPage } from '../render.js';
import { checkName, checkSlug } from '../validate.js';
import { describeStatus, loadState } from '../../services/state.js';
import { TournamentsView } from '../views/tournaments.js';

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
    return renderPage(
      c,
      deps,
      { title: 'Torneos', active: 'torneos', tournament: repo.getActiveTournament() },
      <TournamentsView rows={rows} />,
    );
  });

  app.post('/torneos', async (c) => {
    const body = await readBody(c);
    const name = checkName(str(body, 'name'));
    const slug = checkSlug(repo, str(body, 'slug'));
    const invalid = !name.ok ? name : !slug.ok ? slug : undefined;
    if (invalid && !invalid.ok) {
      setFlash(c, 'error', invalid.error);
      return c.redirect('/admin/torneos', 303);
    }
    if (!name.ok || !slug.ok) return c.redirect('/admin/torneos', 303);
    const tournament = repo.createTournament({ name: name.value, slug: slug.value });
    if (!repo.getActiveTournament()) repo.setActiveTournament(tournament.id);
    deps.events.tournamentChanged(tournament.id);
    setFlash(c, 'ok', `Torneo "${tournament.name}" creado.`);
    return c.redirect(`/admin/t/${tournament.id}/config`, 303);
  });

  app.post('/t/:tid/activar', (c) => {
    const tournament = c.get('tournament');
    const previous = repo.getActiveTournament();
    repo.setActiveTournament(tournament.id);
    deps.events.tournamentChanged(tournament.id);
    if (previous) deps.events.tournamentChanged(previous.id);
    setFlash(c, 'ok', `"${tournament.name}" es ahora el torneo activo (se muestra en la portada).`);
    return c.redirect('/admin/torneos', 303);
  });

  return app;
}
