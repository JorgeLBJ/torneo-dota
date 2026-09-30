import { Hono } from 'hono';
import { getHero, isHeroSlug } from '../../data/heroes.js';
import type { Team } from '../../db/repository.js';
import type { AdminEnv, Deps } from '../context.js';
import { readBody, str, type Body } from '../form.js';
import { setFlash } from '../flash.js';
import { renderPage } from '../render.js';
import { resolveEmblem, type EmblemSources } from '../../domain/emblem.js';
import { emblemSourcesFor } from '../../emblem-sources.js';
import { ImageStorageError, deleteTeamImage, saveTeam } from '../../services/team-image.js';
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

const INVALID_IMAGE = 'La imagen debe ser JPG, PNG o WebP de hasta 5 MB.';

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
   * Saves one team row. Plain form posts (no JavaScript) redirect with a flash. The page script sends the same fields
   * as multipart, adds the cropped image when one is staged, and asks for JSON so it can update just that row.
   */
  app.post('/equipos/:teamId', async (c) => {
    const tournament = c.get('tournament');
    const json = (c.req.header('accept') ?? '').includes('application/json');
    const back = `/admin/t/${tournament.id}/equipos`;
    const refuse = (message: string, status: 400 | 404 | 429 | 502 | 503) => {
      if (json) return c.json({ error: message }, status);
      setFlash(c, 'error', message);
      return c.redirect(back, 303);
    };
    const team = ownTeam(tournament.id, c.req.param('teamId'));
    if (!team) return json ? c.json({ error: 'Equipo no encontrado.' }, 404) : c.text('Equipo no encontrado.', 404);

    const body = await readBody(c);
    const others = repo.listTeams(tournament.id).filter((t) => t.id !== team.id);
    const parsed = parseTeam(body, others);
    if (!parsed.ok) return refuse(parsed.error, 400);

    const rawImage = Array.isArray(body['image']) ? body['image'][0] : body['image'];
    if (typeof rawImage === 'string' && rawImage !== '') return refuse(INVALID_IMAGE, 400);
    const file = rawImage instanceof File && rawImage.size > 0 ? rawImage : null;
    if (file) {
      if (!deps.images) return refuse('Las imágenes personalizadas no están disponibles en este servidor.', 503);
      if (!deps.uploadLimiter.consume(`admin:${c.get('admin').id}`)) {
        return refuse('Demasiadas subidas seguidas: espera un minuto.', 429);
      }
    }

    let saved;
    try {
      saved = await saveTeam(repo, deps.images, team, parsed.value, {
        image: file ? new Uint8Array(await file.arrayBuffer()) : undefined,
        clear: str(body, 'clear_image') === '1',
      });
    } catch (error) {
      if (!(error instanceof ImageStorageError)) throw error;
      return refuse('No se pudo guardar la imagen. Inténtalo de nuevo.', 502);
    }
    if (!saved.ok) return refuse(saved.error, saved.error === 'Equipo no encontrado.' ? 404 : 400);

    deps.events.tournamentChanged(tournament.id);
    const message = `Equipo ${saved.value.code} guardado.`;
    if (json) return c.json({ ok: true, message, team: rowJson(saved.value, emblemSources) });
    setFlash(c, 'ok', message);
    return c.redirect(back, 303);
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
