import type { Repository } from '../db/repository.js';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RESERVED_SLUGS = new Set(['admin', 'assets', 'api', 't', 'static']);

export { fail, ok, type Checked } from '../checked.js';
import { fail, ok, type Checked } from '../checked.js';

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

const USERNAME = /^[a-z0-9._-]{3,32}$/;

/** Lower-cases and validates an admin username. */
export function checkUsername(raw: string): Checked<string> {
  const value = raw.trim().toLowerCase();
  return USERNAME.test(value)
    ? ok(value)
    : fail('El usuario debe tener entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo.');
}

/** A password to set (not the one to verify): 8 to 200 characters. */
export function checkNewPassword(password: string): Checked<string> {
  return password.length >= 8 && password.length <= 200 ? ok(password) : fail('La contraseña debe tener al menos 8 caracteres.');
}
