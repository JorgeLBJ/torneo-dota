import { randomBytes } from 'node:crypto';
import { fail, ok, type Checked } from '../checked.js';
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

export interface TeamFields {
  code: string;
  name: string;
  captain: string | null;
  hero: string | null;
}

export interface EmblemChange {
  /** A new picture (the cropped 1024x576 upload). It wins over `clear`. */
  image?: Uint8Array;
  /** Drop the custom image (the hero or the code tile shows again). */
  clear?: boolean;
}

/**
 * Saves a team row in one go: the fields plus, optionally, a new or cleared custom image.
 * Order matters for safety: the image is validated and stored first (a failure changes nothing), then the fields
 * and the image key are committed in one transaction that also reads the key being replaced, and only then are the
 * old objects deleted. Concurrent saves therefore each delete a distinct object and only the last swap stays.
 */
export async function saveTeam(
  repo: Repository,
  store: ImageStore | null,
  team: Team,
  fields: TeamFields,
  change: EmblemChange,
): Promise<Checked<Team>> {
  let newImageKey: string | null | undefined;
  if (change.image) {
    if (!store) throw new ImageStorageError('no image store');
    const processed = await processTeamImage(change.image);
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
    newImageKey = key;
  } else if (change.clear) {
    newImageKey = null;
  }

  const saved = repo.saveTeam(team.id, fields, newImageKey);
  if (!saved) {
    if (store && typeof newImageKey === 'string') await discard(store, imageKeys(newImageKey)); // team deleted meanwhile
    return fail('Equipo no encontrado.');
  }
  if (store && newImageKey !== undefined && saved.previous && saved.previous !== newImageKey) {
    await discard(store, imageKeys(saved.previous));
  }
  return ok(saved.team);
}

/** Deletes the files of a team that is being deleted. */
export async function deleteTeamImage(store: ImageStore | null, team: Team): Promise<void> {
  if (team.imageKey && store) await discard(store, imageKeys(team.imageKey));
}
