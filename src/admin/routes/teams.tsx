import { Hono } from 'hono';
import { getHero, isHeroSlug } from '../../data/heroes.js';
import type { Team } from '../../db/repository.js';
import type { AdminEnv, Deps } from '../context.js';
import { readBody, str, type Body } from '../form.js';
import { setFlash } from '../flash.js';
import { renderPage } from '../render.js';
import { resolveEmblem, type EmblemSources } from '../../domain/emblem.js';
import { emblemSourcesFor } from '../../emblem-sources.js';
import type { BatchRow } from '../../domain/team-batch.js';
import { ImageStorageError, deleteTeamImage, saveTeamBatch } from '../../services/team-image.js';
import { fail, ok, type Checked } from '../validate.js';
import { TeamsView } from '../views/teams.js';

/** What the page script needs to redraw a saved row in place. */
function rowJson(team: Team, sources: EmblemSources) {
  const hero = team.hero ? getHero(team.hero) : undefined;
  const emblem = resolveEmblem(team, sources);
  return {
    id: team.id,
    code: team.code,
    name: team.name,
    captain: team.captain,
    hero: team.hero,
    heroName: hero?.name ?? null,
    emblem:
      emblem.kind === 'image'
        ? { kind: 'image' as const, src: emblem.src, src2x: emblem.src2x, label: 'Imagen propia' }
        : emblem.kind === 'hero'
          ? { kind: 'hero' as const, src: emblem.src, label: hero?.name ?? 'Héroe' }
          : { kind: 'tile' as const, label: 'Sin emblema' },
  };
}

const EMBLEMS = new Set(['keep', 'hero', 'image', 'none']);

/** The `rows` part of a batch, or null when it is not the expected JSON. */
function parseRows(raw: unknown): BatchRow[] | null {
  if (typeof raw !== 'string') return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(data) || data.length > 200) return null;
  const rows: BatchRow[] = [];
  for (const item of data) {
    if (typeof item !== 'object' || item === null) return null;
    const r = item as Record<string, unknown>;
    if (!Number.isInteger(r.id) || typeof r.code !== 'string' || typeof r.name !== 'string' || typeof r.emblem !== 'string' || !EMBLEMS.has(r.emblem)) return null;
    rows.push({
      id: r.id as number,
      code: r.code,
      name: r.name,
      captain: typeof r.captain === 'string' ? r.captain : '',
      hero: typeof r.hero === 'string' && r.hero !== '' ? r.hero : null,
      emblem: r.emblem as BatchRow['emblem'],
      imageField: typeof r.imageField === 'string' ? r.imageField : undefined,
    });
  }
  return rows;
}

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
  const emblemSources = emblemSourcesFor(deps.images);

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
        imagesEnabled={deps.images !== null}
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

  /**
   * "Guardar cambios": every changed row of the screen in ONE request. `rows` is JSON (see BatchRow) and each staged
   * image travels as its own file part. Answers JSON only, because only the page script calls it.
   */
  app.post('/equipos/lote', async (c) => {
    const tournament = c.get('tournament');
    const body = await c.req.parseBody({ all: true });
    const rows = parseRows(Array.isArray(body['rows']) ? body['rows'][0] : body['rows']);
    if (!rows) return c.json({ error: 'Solicitud no válida.' }, 400);
    if (rows.length === 0) return c.json({ error: 'No hay cambios que guardar.' }, 400);

    const files = new Map<string, Uint8Array>();
    for (const [field, value] of Object.entries(body)) {
      const file = Array.isArray(value) ? value[0] : value;
      if (file instanceof File && file.size > 0) files.set(field, new Uint8Array(await file.arrayBuffer()));
    }
    if (files.size > 0) {
      if (!deps.images) return c.json({ error: 'Las imágenes personalizadas no están disponibles en este servidor.' }, 503);
      if (!deps.uploadLimiter.consume(`admin:${c.get('admin').id}`)) {
        return c.json({ error: 'Demasiadas subidas seguidas: espera un minuto.' }, 429);
      }
    } else if (rows.some((row) => row.emblem === 'image') && !deps.images) {
      return c.json({ error: 'Las imágenes personalizadas no están disponibles en este servidor.' }, 503);
    }

    let saved;
    try {
      saved = await saveTeamBatch(repo, deps.images, tournament.id, rows, files);
    } catch (error) {
      if (!(error instanceof ImageStorageError)) throw error;
      return c.json({ error: 'No se pudo guardar la imagen. Inténtalo de nuevo.' }, 502);
    }
    if (!saved.ok) return c.json({ errors: saved.errors }, 400);

    deps.events.tournamentChanged(tournament.id);
    const count = saved.teams.length;
    return c.json({
      ok: true,
      message: `Cambios guardados (${count} ${count === 1 ? 'equipo' : 'equipos'}).`,
      teams: saved.teams.map((team) => rowJson(team, emblemSources)),
    });
  });

  app.post('/equipos/:teamId/eliminar', async (c) => {
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
      await deleteTeamImage(deps.images, team);
      deps.events.tournamentChanged(tournament.id);
      setFlash(c, 'ok', `Equipo ${team.code} eliminado.`);
    }
    return c.redirect(`/admin/t/${tournament.id}/equipos`, 303);
  });

  return app;
}
