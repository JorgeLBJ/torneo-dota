import type { ImageStore } from '../../src/storage/image-store.js';

export interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
  cacheControl: string;
}

/** In-memory image store for tests, with switches to simulate failures. */
export class MemoryImageStore implements ImageStore {
  readonly objects = new Map<string, StoredObject>();
  readonly deleted: string[] = [];
  failPut = false;
  failDelete = false;

  async put(key: string, bytes: Uint8Array, contentType: string, cacheControl: string): Promise<void> {
    // Fails on the second file of a pair, so the first one has to be cleaned up.
    if (this.failPut && key.includes('@2x')) throw new Error('simulated put failure');
    this.objects.set(key, { bytes, contentType, cacheControl });
  }

  async delete(key: string): Promise<void> {
    if (this.failDelete) throw new Error('simulated delete failure');
    this.deleted.push(key);
    this.objects.delete(key);
  }

  publicUrl(key: string): string {
    return `https://images.example/${key}`;
  }

  keys(): string[] {
    return [...this.objects.keys()].sort();
  }
}
