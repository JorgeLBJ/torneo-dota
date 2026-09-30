import { randomBytes } from 'node:crypto';
import { retinaKey } from '../domain/emblem.js';
import type { Repository, Team } from '../db/repository.js';
import { planTeamBatch, type BatchRow } from '../domain/team-batch.js';
import { processTeamImage, type ProcessedImage } from '../images/process.js';
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

export type BatchResult = { ok: true; teams: Team[] } | { ok: false; errors: Record<number, string> };

/**
 * Saves the whole Equipos screen. Order matters for safety:
 *  1. validate every row against the final state (nothing is touched if any row is wrong);
 *  2. decode every staged image (a bad file is an error on its row);
 *  3. store all new images; a failure deletes what was stored and changes nothing;
 *  4. commit all rows in ONE transaction (which also reads the image keys being replaced); if it fails, the new
 *     objects are deleted again;
 *  5. only then delete the replaced or cleared objects (best effort).
 * Concurrent saves therefore each delete a distinct object and only the last commit's images stay.
 */
export async function saveTeamBatch(
  repo: Repository,
  store: ImageStore | null,
  tournamentId: number,
  rows: readonly BatchRow[],
  files: ReadonlyMap<string, Uint8Array>,
): Promise<BatchResult> {
  const planned = planTeamBatch(repo.listTeams(tournamentId), rows, new Set(files.keys()));
  if (!planned.ok) return planned;

  const teams = new Map(repo.listTeams(tournamentId).map((team) => [team.id, team]));
  const errors: Record<number, string> = {};
  const processed = new Map<number, ProcessedImage>();
  for (const change of planned.changes) {
    if (change.image !== 'set') continue;
    if (!store) throw new ImageStorageError('no image store');
    const result = await processTeamImage(files.get(change.imageField!)!);
    if (result.ok) processed.set(change.id, result.value);
    else errors[change.id] = result.error;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const uploaded: string[] = [];
  const newKeys = new Map<number, string>();
  try {
    for (const [id, image] of processed) {
      const key = newKey(teams.get(id)!);
      newKeys.set(id, key);
      uploaded.push(key, retinaKey(key));
      await store!.put(key, image.x1, 'image/webp', IMMUTABLE);
      await store!.put(retinaKey(key), image.x2, 'image/webp', IMMUTABLE);
    }
  } catch (error) {
    console.error(`Storing team images failed: ${(error as Error).message}`);
    await discard(store!, uploaded);
    throw new ImageStorageError('storage failed', { cause: error });
  }

  let saved;
  try {
    saved = repo.saveTeamsBatch(
      tournamentId,
      planned.changes.map((change) => ({
        id: change.id,
        fields: change.fields,
        key: change.image === 'set' ? newKeys.get(change.id)! : change.image === 'clear' ? null : undefined,
      })),
    );
  } catch (error) {
    if (store) await discard(store, uploaded); // the commit failed: the new objects are orphans
    throw error;
  }
  if (!saved.ok) {
    if (store) await discard(store, uploaded); // a team was deleted meanwhile
    return { ok: false, errors: { [saved.missingId]: 'Equipo no encontrado.' } };
  }

  if (store) {
    for (const change of planned.changes) {
      const previous = saved.previous[change.id];
      const current = change.image === 'set' ? newKeys.get(change.id) : change.image === 'clear' ? null : previous;
      if (previous && previous !== current) await discard(store, imageKeys(previous));
    }
  }
  return { ok: true, teams: saved.teams };
}

/** Deletes the files of a team that is being deleted. */
export async function deleteTeamImage(store: ImageStore | null, team: Team): Promise<void> {
  if (team.imageKey && store) await discard(store, imageKeys(team.imageKey));
}
