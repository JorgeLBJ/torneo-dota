import { LocalImageStore } from './local.js';
import type { ImageStore } from './image-store.js';
import { R2ImageStore } from './r2.js';

export type ImageStoreChoice =
  | { kind: 'r2'; store: ImageStore; message: string }
  | { kind: 'local'; store: LocalImageStore; message: string }
  | { kind: 'disabled'; store: null; message: string };

const R2_VARS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL'] as const;

/**
 * R2 when fully configured. Otherwise a local folder in development, or when IMAGE_STORE=local asks for it
 * explicitly; in production without either, custom team images are switched off rather than silently kept on
 * a disk that may not survive.
 */
export function imageStoreFromEnv(env: NodeJS.ProcessEnv = process.env): ImageStoreChoice {
  const missing = R2_VARS.filter((name) => !env[name]?.trim());
  if (missing.length === 0) {
    const store = new R2ImageStore({
      accountId: env.R2_ACCOUNT_ID!.trim(),
      accessKeyId: env.R2_ACCESS_KEY_ID!.trim(),
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!.trim(),
      bucket: env.R2_BUCKET!.trim(),
      publicBaseUrl: env.R2_PUBLIC_BASE_URL!.trim(),
    });
    return { kind: 'r2', store, message: `Team images: Cloudflare R2 bucket "${env.R2_BUCKET!.trim()}"` };
  }
  const partial = missing.length < R2_VARS.length;
  if (env.IMAGE_STORE === 'local' || (env.NODE_ENV !== 'production' && !partial)) {
    const dir = env.IMAGES_DIR?.trim() || './data/uploads';
    const store = new LocalImageStore(dir);
    return { kind: 'local', store, message: `Team images: local folder ${store.dir} (served at /uploads)` };
  }
  return {
    kind: 'disabled',
    store: null,
    message: partial
      ? `Team images disabled: incomplete R2 configuration, missing ${missing.join(', ')}`
      : 'Team images disabled: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_BASE_URL (or IMAGE_STORE=local to keep them on this server)',
  };
}
