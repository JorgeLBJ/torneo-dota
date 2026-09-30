import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { SAFE_KEY, type ImageStore } from './image-store.js';

/** Development/fallback adapter: files in a folder, served by the app itself under /uploads. */
export class LocalImageStore implements ImageStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  private pathOf(key: string): string {
    if (!SAFE_KEY.test(key)) throw new Error(`Invalid image key "${key}"`);
    const path = resolve(join(this.dir, key));
    if (!path.startsWith(this.dir + sep)) throw new Error(`Invalid image key "${key}"`);
    return path;
  }

  async put(key: string, bytes: Uint8Array, _contentType?: string, _cacheControl?: string): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  publicUrl(key: string): string {
    return `/uploads/${key}`;
  }

  /** For the /uploads route: the bytes, or null if the key is invalid or the file does not exist. */
  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathOf(key));
    } catch {
      return null;
    }
  }
}
