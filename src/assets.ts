import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

const cache = new Map<string, string>();

/**
 * URL of a file under ./public, fingerprinted with its content hash. The URL
 * changes whenever the file does, which is what makes the year-long
 * `Cache-Control` on /assets/* safe for CSS and JS.
 */
export function assetUrl(path: string): string {
  const cached = cache.get(path);
  if (cached) return cached;
  let url = `/assets/${path}`;
  try {
    const hash = createHash('sha1').update(readFileSync(`${PUBLIC_DIR}/${path}`)).digest('hex').slice(0, 10);
    url = `${url}?v=${hash}`;
    cache.set(path, url);
  } catch {
    // Missing file: serve the bare path (and do not cache, so a later deploy is picked up).
  }
  return url;
}
