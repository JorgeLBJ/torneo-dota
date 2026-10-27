import { Hono } from 'hono';
import type { AdminEnv, Deps } from '../context.js';
import { readBody, str } from '../form.js';
import { setFlash } from '../flash.js';
import { adminTimeZone, renderPage } from '../render.js';
import { checkDeleteConfirmation, checkFormat, checkName, checkSlug } from '../validate.js';
import type { Repository } from '../../db/repository.js';
import { describeStatus, loadState } from '../../services/state.js';
import { imageKeys } from '../../services/team-image.js';
import { discardImages } from '../../storage/banner-images.js';
import { TournamentsView } from '../views/tournaments.js';

/** Every image-store object a tournament owns: team images (both sizes) and banner images (both sizes). */
function storedImageKeys(repo: Repository, tournamentId: number): string[] {
  const teams = repo.listTeams(tournamentId).flatMap((team) => (team.imageKey ? imageKeys(team.imageKey) : []));
  const banners = repo.listBanners(tournamentId).flatMap((banner) => [banner.imageKey, banner.imageKeySmall]);
  return [...teams, ...banners];
}

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
      <TournamentsView rows={rows} timeZone={adminTimeZone(deps)} />,
    );
  });

  app.post('/torneos', async (c) => {
    const body = await readBody(c);
    const name = checkName(str(body, 'name'));
    const slug = checkSlug(repo, str(body, 'slug'));
    const format = checkFormat(str(body, 'format'));
    const invalid = !name.ok ? name : !slug.ok ? slug : !format.ok ? format : undefined;
    if (invalid && !invalid.ok) {
      setFlash(c, 'error', invalid.error);
      return c.redirect('/admin/torneos', 303);
    }
    if (!name.ok || !slug.ok || !format.ok) return c.redirect('/admin/torneos', 303);
    const tournament = repo.createTournament({ name: name.value, slug: slug.value, format: format.value });
    if (!repo.getActiveTournament()) repo.setActiveTournament(tournament.id);
    deps.events.tournamentChanged(tournament.id);
    setFlash(c, 'ok', `Torneo "${tournament.name}" creado.`);
    return c.redirect(`/admin/t/${tournament.id}/config`, 303);
  });

  app.post('/t/:tid/activar', (c) => {
    const tournament = c.get('tournament');
    if (tournament.archivedAt) {
      setFlash(c, 'error', `"${tournament.name}" está archivado. Restáuralo antes de marcarlo como activo.`);
      return c.redirect('/admin/torneos', 303);
    }
    const previous = repo.getActiveTournament();
    repo.setActiveTournament(tournament.id);
    deps.events.tournamentChanged(tournament.id);
    if (previous && previous.id !== tournament.id) deps.events.tournamentChanged(previous.id);
    setFlash(c, 'ok', `"${tournament.name}" es ahora el torneo activo (se muestra en la portada).`);
    return c.redirect('/admin/torneos', 303);
  });

  app.post('/t/:tid/archivar', (c) => {
    const tournament = c.get('tournament');
    if (tournament.isActive) {
      setFlash(c, 'error', 'No se puede archivar el torneo activo. Marca otro torneo como activo primero.');
      return c.redirect('/admin/torneos', 303);
    }
    repo.archiveTournament(tournament.id);
    deps.events.tournamentChanged(tournament.id);
    setFlash(c, 'ok', `"${tournament.name}" archivado: ya no aparece en el selector de torneos.`);
    return c.redirect('/admin/torneos', 303);
  });

  app.post('/t/:tid/restaurar', (c) => {
    const tournament = c.get('tournament');
    repo.restoreTournament(tournament.id);
    deps.events.tournamentChanged(tournament.id);
    setFlash(c, 'ok', `"${tournament.name}" restaurado.`);
    return c.redirect('/admin/torneos', 303);
  });

  app.post('/t/:tid/eliminar', async (c) => {
    const tournament = c.get('tournament');
    if (!tournament.archivedAt || tournament.isActive) {
      setFlash(c, 'error', 'Archiva el torneo antes de eliminarlo.');
      return c.redirect('/admin/torneos', 303);
    }
    const body = await readBody(c);
    const confirmation = checkDeleteConfirmation(str(body, 'confirm_name'), tournament.name);
    if (!confirmation.ok) {
      setFlash(c, 'error', confirmation.error);
      return c.redirect('/admin/torneos', 303);
    }
    // The keys are read before the rows go (they cascade with the tournament); the objects are removed after the
    // rows, best effort: a failed delete is logged and leaves an orphan, never a half-deleted tournament.
    const keys = storedImageKeys(repo, tournament.id);
    repo.deleteTournament(tournament.id);
    if (deps.images) await discardImages(deps.images, keys);
    deps.events.tournamentChanged(tournament.id);
    setFlash(c, 'ok', `Torneo "${tournament.name}" eliminado con sus equipos, partidos e imágenes.`);
    return c.redirect('/admin/torneos', 303);
  });

  return app;
}
