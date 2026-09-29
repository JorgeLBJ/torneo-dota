import type { Repository } from '../db/repository.js';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RESERVED_SLUGS = new Set(['admin', 'assets', 'api', 't', 'static']);

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

export const ok = <T>(value: T): Checked<T> => ({ ok: true, value });
export const fail = (error: string): Checked<never> => ({ ok: false, error });

export function checkName(name: string): Checked<string> {
  return name.length >= 1 && name.length <= 80 ? ok(name) : fail('Escribe un nombre de hasta 80 caracteres.');
}

/** Validates a tournament slug; `ownId` is excluded from the uniqueness check. */
export function checkSlug(repo: Repository, slug: string, ownId?: number): Checked<string> {
  const value = slug.toLowerCase();
  if (value.length < 2 || value.length > 60 || !SLUG.test(value)) {
    return fail('La URL pública solo admite minúsculas, números y guiones (por ejemplo: torneo-oct-2026).');
  }
  if (RESERVED_SLUGS.has(value)) return fail(`La URL pública "${value}" está reservada.`);
  const existing = repo.getTournamentBySlug(value);
  if (existing && existing.id !== ownId) return fail(`Ya existe un torneo con la URL "${value}".`);
  return ok(value);
}
