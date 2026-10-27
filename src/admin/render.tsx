import { emblemSourcesFor } from '../emblem-sources.js';
import { EmblemSourcesContext } from '../emblem-view.js';
import type { Context } from 'hono';
import type { Child } from 'hono/jsx';
import type { Tournament } from '../db/repository.js';
import type { AdminEnv, Deps } from './context.js';
import { takeFlash } from './flash.js';
import { Layout, type NavInfo, type Section } from './views/layout.js';

export function publicUrlFor(t: Tournament): string {
  return t.isActive ? '/' : `/t/${t.slug}`;
}

export function navFor(deps: Deps, current?: Tournament): NavInfo {
  const { repo } = deps;
  // Archived tournaments leave the selector, except the one being viewed (so its own pages stay navigable).
  const tournaments = repo.listTournaments().filter((t) => !t.archivedAt || t.id === current?.id);
  const unlinkedCaptures = repo.countUnlinkedFinalGsiCaptures();
  if (!current) return { tournaments, teamCount: 0, played: 0, total: 0, unlinkedCaptures };
  const group = repo.listMatches(current.id, 'group');
  return {
    tournaments,
    current,
    teamCount: repo.listTeams(current.id).length,
    played: group.filter((m) => m.winnerId !== null).length,
    total: group.length,
    publicUrl: publicUrlFor(current),
    unlinkedCaptures,
  };
}

/** Zone used on the global (not per-tournament) admin screens: the active tournament's, else Lima. */
export const DEFAULT_ADMIN_TIME_ZONE = 'America/Lima';
export function adminTimeZone(deps: Deps): string {
  return deps.repo.getActiveTournament()?.timezone || DEFAULT_ADMIN_TIME_ZONE;
}

export interface PageOptions {
  title: string;
  active: Section;
  tournament?: Tournament;
  status?: 200 | 400 | 404 | 409;
}

/** Renders a backoffice page inside the shared shell. */
export function renderPage(c: Context<AdminEnv>, deps: Deps, opts: PageOptions, body: Child) {
  const html = (
    <Layout
      title={opts.title}
      active={opts.active}
      admin={c.get('admin')}
      nav={navFor(deps, opts.tournament)}
      flash={takeFlash(c)}
    >
      <EmblemSourcesContext.Provider value={emblemSourcesFor(deps.images)}>{body}</EmblemSourcesContext.Provider>
    </Layout>
  );
  return c.html(html, opts.status ?? 200);
}
