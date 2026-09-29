import type { Context } from 'hono';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Clock } from '../clock.js';
import type { AppConfig } from '../config.js';
import type { Repository, Tournament } from '../db/repository.js';
import { parentHostsFor } from '../domain/stream.js';
import { assetUrl } from '../assets.js';
import { clientKey, publicOrigin, requestHost } from '../security.js';
import { NO_TOURNAMENT_SHARE, buildShare, type Share } from './share.js';
import type { Events } from '../events.js';
import { loadState } from '../services/state.js';
import { buildPublicModel } from './model.js';
import {
  ComingSoonContent,
  NotFoundContent,
  PublicContent,
  PublicDocument,
  type PageLinks,
  type PageMeta,
} from './views.js';

export interface PublicDeps {
  repo: Repository;
  events: Events;
  config: Pick<AppConfig, 'heartbeatMs' | 'publicBaseUrl' | 'sseLimits' | 'streamParentHosts' | 'trustProxy'>;
  now: Clock;
}

const NOT_FOUND_SHARE: Share = {
  title: 'Torneo no encontrado · torneo-dota',
  description: 'Este torneo no existe o cambió de dirección.',
};

export const DEFAULT_HEARTBEAT_MS = 25_000;
const DEFAULT_SSE_LIMITS = { global: 500, perIp: 10 };
/** Reconnect delay suggested to EventSource clients. */
const SSE_RETRY_MS = 3000;
/** Sent with a 503 when the connection limits are reached. */
const SSE_RETRY_AFTER_S = 30;

// Deliberately no X-Frame-Options / frame-ancestors here: this site is embedded in Google Sites.

const linksFor = (tournament: Tournament): PageLinks => ({
  events: `/t/${tournament.slug}/events`,
  partial: `/t/${tournament.slug}/partial`,
});
const ROOT_LINKS: PageLinks = { events: '/events', partial: '/partial' };

export function publicApp({ repo, events, config, now }: PublicDeps) {
  const app = new Hono();

  const content = (tournament: Tournament, parentHosts: readonly string[]) => {
    const model = buildPublicModel(loadState(repo, tournament), repo.listScheduleDays(tournament.id), {
      now: now(),
      parentHosts,
    });
    return { model, node: <PublicContent model={model} /> };
  };

  /** Twitch embeds must name every page that frames the player: this host and, by default, Google Sites. */
  const parentHosts = (c: Context) => parentHostsFor(requestHost(c, config.trustProxy), config.streamParentHosts);

  /** Head data for a page: the share text plus absolute URLs built from the public origin. */
  const metaFor = (c: Context, share: Share, noindex = false): PageMeta => {
    const origin = publicOrigin(c, config);
    return { ...share, url: `${origin}${c.req.path}`, imageUrl: `${origin}${assetUrl('img/og.jpg')}`, noindex };
  };

  const page = (c: Context, tournament: Tournament | undefined, links: PageLinks | undefined, status: 200 | 404 = 200) => {
    c.header('Cache-Control', 'no-cache');
    if (!tournament) {
      return c.html(
        <PublicDocument meta={metaFor(c, status === 404 ? NOT_FOUND_SHARE : NO_TOURNAMENT_SHARE, status === 404)} links={links}>
          {status === 404 ? <NotFoundContent /> : <ComingSoonContent />}
        </PublicDocument>,
        status,
      );
    }
    const { model, node } = content(tournament, parentHosts(c));
    return c.html(
      <PublicDocument meta={metaFor(c, buildShare(model))} links={links}>
        {node}
      </PublicDocument>,
    );
  };

  const fragment = (c: Context, tournament: Tournament | undefined) => {
    c.header('Cache-Control', 'no-cache');
    if (!tournament) return c.html(<ComingSoonContent />);
    return c.html(content(tournament, parentHosts(c)).node);
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

  // ---- Server-sent events ----------------------------------------------------------------------

  const limits = { global: config.sseLimits?.global ?? DEFAULT_SSE_LIMITS.global, perIp: config.sseLimits?.perIp ?? DEFAULT_SSE_LIMITS.perIp };
  let openStreams = 0;
  const perClient = new Map<string, number>();

  /** Takes a connection slot, or returns null when a limit is reached. The returned release is idempotent. */
  const admit = (client: string): (() => void) | null => {
    if (openStreams >= limits.global || (perClient.get(client) ?? 0) >= limits.perIp) return null;
    openStreams++;
    perClient.set(client, (perClient.get(client) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      openStreams--;
      const left = (perClient.get(client) ?? 1) - 1;
      if (left <= 0) perClient.delete(client);
      else perClient.set(client, left);
    };
  };

  /**
   * Streams `hello` on connect, `change` when the page's data changed (the client then re-fetches the
   * fragment) and `ping` as a heartbeat. Everything acquired for the connection (listener, slot, timer)
   * is released by one cleanup, whichever way the connection ends.
   */
  const live = (c: Context, subscribe: (notify: () => void) => () => void) => {
    const release = admit(clientKey(c, config.trustProxy));
    if (!release) {
      return c.text('Demasiadas conexiones en vivo. Reintenta en unos segundos.', 503, { 'Retry-After': String(SSE_RETRY_AFTER_S) });
    }
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let wake: (() => void) | undefined;
      let unsubscribe: (() => void) | undefined;
      const cleanup = () => {
        unsubscribe?.();
        unsubscribe = undefined;
        release();
        clearTimeout(timer);
        wake?.();
      };
      stream.onAbort(cleanup);
      try {
        unsubscribe = subscribe(() => {
          stream.writeSSE({ event: 'change', data: '{}' }).catch(() => undefined);
        });
        await stream.writeSSE({ event: 'hello', data: '{}', retry: SSE_RETRY_MS });
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
        cleanup();
      }
    });
  };

  // The root follows whichever tournament is active. One shared listener serves every root connection:
  // per event it looks the active tournament up once and wakes all of them if it concerns the page.
  const rootStream = (() => {
    const members = new Set<() => void>();
    let unsubscribe: (() => void) | undefined;
    let lastActive: number | null = null;
    const onChange = (changedId: number) => {
      const active = repo.getActiveTournament()?.id ?? null;
      const relevant = changedId === active || active !== lastActive;
      lastActive = active;
      if (relevant) for (const notify of [...members]) notify();
    };
    return {
      join(notify: () => void): () => void {
        if (members.size === 0) {
          lastActive = repo.getActiveTournament()?.id ?? null;
          unsubscribe = events.onAnyChanged(onChange);
        }
        members.add(notify);
        return () => {
          members.delete(notify);
          if (members.size === 0) {
            unsubscribe?.();
            unsubscribe = undefined;
          }
        };
      },
    };
  })();

  app.get('/t/:slug/events', (c) => {
    const tournament = repo.getTournamentBySlug(c.req.param('slug'));
    if (!tournament) return c.text('Torneo no encontrado.', 404);
    return live(c, (notify) => events.onTournamentChanged(tournament.id, notify));
  });
  app.get('/events', (c) => live(c, (notify) => rootStream.join(notify)));

  return app;
}
