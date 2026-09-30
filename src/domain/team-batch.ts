import { getHero, isHeroSlug } from '../data/heroes.js';
import type { Team } from '../db/repository.js';

/**
 * Saving the Equipos screen is ONE batch. Each row says what its emblem becomes:
 *  - keep:  leave the emblem as stored;
 *  - hero:  that hero (any custom image is dropped);
 *  - image: the uploaded file (any hero is dropped);
 *  - none:  neither.
 * A team has a hero OR an image, never both. Everything is validated against the FINAL state of the whole tournament
 * (so two teams can swap heroes or codes in one batch), and nothing is planned unless every row is valid.
 */
export type EmblemMode = 'keep' | 'hero' | 'image' | 'none';

export interface BatchRow {
  id: number;
  code: string;
  name: string;
  captain: string;
  hero: string | null;
  emblem: EmblemMode;
  /** Name of the multipart file part that carries the new image (emblem "image"). */
  imageField?: string;
}

export interface PlannedChange {
  id: number;
  fields: { code: string; name: string; captain: string | null; hero: string | null };
  /** keep: leave the stored image; set: replace it with `imageField`; clear: remove it. */
  image: 'keep' | 'set' | 'clear';
  imageField?: string;
}

export type BatchPlan = { ok: true; changes: PlannedChange[] } | { ok: false; errors: Record<number, string> };

const HERO_ERROR = 'Elige un héroe válido de la lista.';

export function planTeamBatch(existing: readonly Team[], rows: readonly BatchRow[], files: ReadonlySet<string>): BatchPlan {
  const errors: Record<number, string> = {};
  const fail = (id: number, message: string) => {
    if (!(id in errors)) errors[id] = message;
  };
  const byId = new Map(existing.map((team) => [team.id, team]));
  const planned = new Map<number, PlannedChange>();

  for (const row of rows) {
    const team = byId.get(row.id);
    if (!team) {
      fail(row.id, 'Equipo no encontrado.');
      continue;
    }
    if (planned.has(row.id)) {
      fail(row.id, 'El equipo aparece dos veces en los cambios.');
      continue;
    }
    const code = row.code.trim().toUpperCase();
    const name = row.name.trim();
    const captain = row.captain.trim();
    if (!/^[A-Z0-9]{1,4}$/.test(code)) fail(row.id, 'El código debe tener de 1 a 4 letras o números.');
    else if (name.length < 1 || name.length > 40) fail(row.id, 'El nombre del equipo es obligatorio (máximo 40 caracteres).');
    else if (captain.length > 40) fail(row.id, 'El nombre del capitán admite hasta 40 caracteres.');

    let hero: string | null;
    let image: PlannedChange['image'];
    switch (row.emblem) {
      case 'hero':
        if (!row.hero || !isHeroSlug(row.hero)) fail(row.id, HERO_ERROR);
        hero = row.hero && isHeroSlug(row.hero) ? row.hero : null;
        image = 'clear';
        break;
      case 'image':
        if (!row.imageField || !files.has(row.imageField)) fail(row.id, 'Falta el archivo de la imagen.');
        hero = null;
        image = 'set';
        break;
      case 'none':
        hero = null;
        image = 'clear';
        break;
      default:
        hero = team.hero;
        image = 'keep';
    }
    planned.set(row.id, {
      id: row.id,
      fields: { code, name, captain: captain === '' ? null : captain, hero },
      image,
      ...(image === 'set' ? { imageField: row.imageField } : {}),
    });
  }

  // Uniqueness on the final state: batch rows replace what is stored, the other teams stay as they are.
  const final = existing.map((team) => {
    const change = planned.get(team.id);
    return { id: team.id, code: change?.fields.code ?? team.code, hero: change ? change.fields.hero : team.hero };
  });
  for (const row of rows) {
    const change = planned.get(row.id);
    if (!change || row.id in errors) continue;
    const others = final.filter((team) => team.id !== row.id);
    if (others.some((team) => team.code === change.fields.code)) {
      fail(row.id, `Ya existe un equipo con el código "${change.fields.code}".`);
      continue;
    }
    const hero = change.fields.hero;
    if (hero) {
      const holder = others.find((team) => team.hero === hero);
      if (holder) fail(row.id, `El héroe ${getHero(hero)!.name} ya lo usa el equipo ${holder.code}.`);
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, changes: rows.map((row) => planned.get(row.id)!) };
}
