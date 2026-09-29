import type { Context } from 'hono';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppConfig } from '../config.js';
import type { Repository, Tournament } from '../db/repository.js';
import type { Events } from '../events.js';
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
  events: Events;
  config: Pick<AppConfig, 'heartbeatMs' | 'now'>;
}

export const DEFAULT_HEARTBEAT_MS = 25_000;

// Deliberately no X-Frame-Options / frame-ancestors here: this site is embedded in Google Sites.

const linksFor = (tournament: Tournament): PageLinks => ({
  events: `/t/${tournament.slug}/events`,
  partial: `/t/${tournament.slug}/partial`,
});
const ROOT_LINKS: PageLinks = { events: '/events', partial: '/partial' };

export function publicApp({ repo, events, config }: PublicDeps) {
  const app = new Hono();

  const content = (tournament: Tournament) => {
    const model = buildPublicModel(loadState(repo, tournament), repo.listScheduleDays(tournament.id), {
      now: config.now?.() ?? new Date(),
    });
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

  /**
   * Server-sent events: `hello` on connect, `change` when the page's data changed (the client then
   * re-fetches the fragment), `ping` as a heartbeat. The listener is always released on disconnect.
   */
  const live = (c: Context, subscribe: (notify: () => void) => () => void) => {
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let wake: (() => void) | undefined;
      const off = subscribe(() => {
        stream.writeSSE({ event: 'change', data: '{}' }).catch(() => undefined);
      });
      stream.onAbort(() => {
        off();
        clearTimeout(timer);
        wake?.();
      });
      try {
        await stream.writeSSE({ event: 'hello', data: '{}', retry: 3000 });
        while (!stream.aborted) {
          await new Promise<void>((resolve) => {
            wake = resolve;
            timer = setTimeout(resolve, config.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
          });
          if (stream.aborted) break;
          await stream.writeSSE({ event: 'ping', data: '{}' });
        }
      } catch {
        // The client went away mid-write; nothing to report.
      } finally {
        off();
        clearTimeout(timer);
      }
    });
  };

  app.get('/t/:slug/events', (c) => {
    const tournament = repo.getTournamentBySlug(c.req.param('slug'));
    if (!tournament) return c.text('Torneo no encontrado.', 404);
    return live(c, (notify) => events.onTournamentChanged(tournament.id, notify));
  });

  // The root follows whichever tournament is active, so it listens to every change and
  // reports the ones that concern the active tournament or switch which one is active.
  app.get('/events', (c) =>
    live(c, (notify) => {
      let lastActive = repo.getActiveTournament()?.id ?? null;
      return events.onAnyChanged((id) => {
        const active = repo.getActiveTournament()?.id ?? null;
        const relevant = id === active || active !== lastActive;
        lastActive = active;
        if (relevant) notify();
      });
    }),
  );

  return app;
}
