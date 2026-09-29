import type { Context } from 'hono';
import { Hono } from 'hono';
import type { Repository, Tournament } from '../db/repository.js';
import { loadState } from '../services/state.js';
import { buildPublicModel } from './model.js';
import {
  ComingSoonContent,
  NotFoundContent,
  PublicContent,
  PublicDocument,
  type PageLinks,
} from './views.js';

export interface PublicDeps {
  repo: Repository;
}

// Deliberately no X-Frame-Options / frame-ancestors here: this site is embedded in Google Sites.

const linksFor = (tournament: Tournament): PageLinks => ({
  events: `/t/${tournament.slug}/events`,
  partial: `/t/${tournament.slug}/partial`,
});
const ROOT_LINKS: PageLinks = { events: '/events', partial: '/partial' };

export function publicApp({ repo }: PublicDeps) {
  const app = new Hono();

  const content = (tournament: Tournament) => {
    const model = buildPublicModel(loadState(repo, tournament), repo.listScheduleDays(tournament.id));
    return { model, node: <PublicContent model={model} /> };
  };

  const page = (c: Context, tournament: Tournament | undefined, links: PageLinks | undefined, status: 200 | 404 = 200) => {
    c.header('Cache-Control', 'no-cache');
    if (!tournament) {
      return c.html(
        <PublicDocument title={status === 404 ? 'Torneo no encontrado' : 'Próximamente · Torneos'} links={links}>
          {status === 404 ? <NotFoundContent /> : <ComingSoonContent />}
        </PublicDocument>,
        status,
      );
    }
    const { model, node } = content(tournament);
    return c.html(
      <PublicDocument title={model.name} links={links}>
        {node}
      </PublicDocument>,
    );
  };

  const fragment = (c: Context, tournament: Tournament | undefined) => {
    c.header('Cache-Control', 'no-cache');
    if (!tournament) return c.html(<ComingSoonContent />);
    return c.html(content(tournament).node);
  };

  app.get('/', (c) => page(c, repo.getActiveTournament(), ROOT_LINKS));
  app.get('/partial', (c) => fragment(c, repo.getActiveTournament()));

  app.get('/t/:slug', (c) => {
    const tournament = repo.getTournamentBySlug(c.req.param('slug'));
    return tournament ? page(c, tournament, linksFor(tournament)) : page(c, undefined, undefined, 404);
  });
  app.get('/t/:slug/partial', (c) => {
    const tournament = repo.getTournamentBySlug(c.req.param('slug'));
    if (!tournament) return c.text('Torneo no encontrado.', 404);
    return fragment(c, tournament);
  });

  return app;
}
