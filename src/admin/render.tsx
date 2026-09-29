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
  const tournaments = repo.listTournaments();
  if (!current) return { tournaments, teamCount: 0, played: 0, total: 0 };
  const group = repo.listMatches(current.id, 'group');
  return {
    tournaments,
    current,
    teamCount: repo.listTeams(current.id).length,
    played: group.filter((m) => m.winnerId !== null).length,
    total: group.length,
    publicUrl: publicUrlFor(current),
  };
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
      {body}
    </Layout>
  );
  return c.html(html, opts.status ?? 200);
}
