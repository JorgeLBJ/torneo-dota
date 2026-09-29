import type { Repository } from '../db/repository.js';
import { hashPassword } from './password.js';

export const INITIAL_ADMIN_USERNAME = 'admin';

export type BootstrapResult = 'exists' | 'created' | 'setup-required';

/**
 * Makes sure the app can be signed in to. With admins already present nothing happens; otherwise the first
 * admin is created from ADMIN_PASSWORD, or, without it, the app waits for the /admin/setup flow.
 */
export async function ensureInitialAdmin(repo: Repository, password: string | undefined): Promise<BootstrapResult> {
  if (repo.countAdmins() > 0) return 'exists';
  if (!password) return 'setup-required';
  repo.createAdmin(INITIAL_ADMIN_USERNAME, await hashPassword(password));
  return 'created';
}
