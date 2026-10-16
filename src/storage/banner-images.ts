import { randomBytes } from 'node:crypto';
import type { ProcessedBanner } from '../images/process.js';
import type { ImageStore } from './image-store.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';

/** The bytes could not be written to the image store. */
export class BannerStorageError extends Error {}

export interface StoredBannerImages {
  key: string;
  width: number;
  height: number;
  keySmall: string;
  widthSmall: number;
}

/** Fresh object keys for a banner: "banners/3/ab12cd34ef56.webp" and "banners/3/ab12cd34ef56-1280.webp". */
export function newBannerKeys(tournamentId: number): { key: string; keySmall: string } {
  const key = `banners/${tournamentId}/${randomBytes(6).toString('hex')}.webp`;
  return { key, keySmall: key.replace(/\.webp$/, '-1280.webp') };
}

/** Removes objects, logging instead of throwing: losing track of an orphan must never block the admin. */
export async function discardImages(store: ImageStore, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    try {
      await store.delete(key);
    } catch (error) {
      console.error(`Could not delete image ${key}: ${(error as Error).message}`);
    }
  }
}

/** Writes both variants of a banner; if either write fails, whatever was written is removed again. */
export async function storeBannerImages(store: ImageStore, tournamentId: number, image: ProcessedBanner): Promise<StoredBannerImages> {
  const { key, keySmall } = newBannerKeys(tournamentId);
  try {
    await store.put(key, image.large.bytes, 'image/webp', IMMUTABLE);
    await store.put(keySmall, image.small.bytes, 'image/webp', IMMUTABLE);
  } catch (error) {
    console.error(`Storing banner images failed: ${(error as Error).message}`);
    await discardImages(store, [key, keySmall]);
    throw new BannerStorageError('storage failed', { cause: error });
  }
  return { key, width: image.large.width, height: image.large.height, keySmall, widthSmall: image.small.width };
}
