import type { Repository } from '../db/repository.js';
import { hashPassword } from './password.js';

export const INITIAL_ADMIN_USERNAME = 'admin';

/** Creates the first admin from ADMIN_PASSWORD; refuses to continue when there is none and no password. */
export async function ensureInitialAdmin(repo: Repository, password: string | undefined): Promise<void> {
  if (repo.countAdmins() > 0) return;
  if (!password) {
    throw new Error('No admin exists: set the ADMIN_PASSWORD environment variable to create the first admin.');
  }
  repo.createAdmin(INITIAL_ADMIN_USERNAME, await hashPassword(password));
}
