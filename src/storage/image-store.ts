/**
 * Port for the place team images live. The application only knows this interface; Cloudflare R2 and the
 * local folder are adapters behind it.
 */
export interface ImageStore {
  put(key: string, bytes: Uint8Array, contentType: string, cacheControl: string): Promise<void>;
  /** Removing an object that is already gone is not an error. */
  delete(key: string): Promise<void>;
  /** Where browsers fetch the object from. */
  publicUrl(key: string): string;
}

/** Object keys are plain relative paths made of a few safe characters: no traversal, no surprises. */
export const SAFE_KEY = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_@./-]{0,199}$/;
