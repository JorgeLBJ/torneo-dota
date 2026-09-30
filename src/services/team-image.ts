import { randomBytes } from 'node:crypto';
import { fail, type Checked } from '../checked.js';
import { retinaKey } from '../domain/emblem.js';
import type { Repository, Team } from '../db/repository.js';
import { processTeamImage } from '../images/process.js';
import type { ImageStore } from '../storage/image-store.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';

/** The bytes could not be written to the image store. */
export class ImageStorageError extends Error {}

const newKey = (team: Team): string => `teams/${team.tournamentId}/${team.id}-${randomBytes(6).toString('hex')}.webp`;

/** Removes objects, logging instead of throwing: losing track of an orphan must never block the admin. */
async function discard(store: ImageStore, keys: string[]): Promise<void> {
  for (const key of keys) {
    try {
      await store.delete(key);
    } catch (error) {
      console.error(`Could not delete image ${key}: ${(error as Error).message}`);
    }
  }
}

export const imageKeys = (key: string): string[] => [key, retinaKey(key)];

/**
 * Processes and stores a new image for the team, then points the team at it and drops the previous one.
 * Order matters: the team only switches once both files are stored, so a failure leaves the old image intact.
 */
export async function setTeamImage(repo: Repository, store: ImageStore, team: Team, bytes: Uint8Array): Promise<Checked<Team>> {
  const processed = await processTeamImage(bytes);
  if (!processed.ok) return fail(processed.error);

  const key = newKey(team);
  try {
    await store.put(key, processed.value.x1, 'image/webp', IMMUTABLE);
    await store.put(retinaKey(key), processed.value.x2, 'image/webp', IMMUTABLE);
  } catch (error) {
    console.error(`Storing the image for team ${team.id} failed: ${(error as Error).message}`);
    await discard(store, imageKeys(key));
    throw new ImageStorageError('storage failed', { cause: error });
  }

  // The previous key is read while swapping (never from the stale `team`), and its files are deleted only after
  // the swap committed: concurrent uploads each delete a distinct object and only the last swap stays.
  const swapped = repo.swapTeamImageKey(team.id, key);
  if (!swapped) {
    await discard(store, imageKeys(key)); // the team was deleted while the image was being stored
    return fail('Equipo no encontrado.');
  }
  if (swapped.previous) await discard(store, imageKeys(swapped.previous));
  return { ok: true, value: repo.getTeam(team.id)! };
}

/** Drops the team's custom image (it falls back to the hero) and deletes its files. */
export async function removeTeamImage(repo: Repository, store: ImageStore | null, team: Team): Promise<void> {
  const swapped = repo.swapTeamImageKey(team.id, null);
  if (swapped?.previous && store) await discard(store, imageKeys(swapped.previous));
}

/** Deletes the files of a team that is being deleted. */
export async function deleteTeamImage(store: ImageStore | null, team: Team): Promise<void> {
  if (team.imageKey && store) await discard(store, imageKeys(team.imageKey));
}
