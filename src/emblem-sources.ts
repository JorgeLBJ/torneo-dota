import type { EmblemSources } from './domain/emblem.js';
import type { ImageStore } from './storage/image-store.js';

export const heroPortraitUrl = (slug: string): string => `/assets/heroes/${slug}.png`;

/** Where emblem pictures come from, given the configured image store (null: custom images are off). */
export const emblemSourcesFor = (store: ImageStore | null): EmblemSources => ({
  imageUrl: store ? (key) => store.publicUrl(key) : null,
  heroUrl: heroPortraitUrl,
});
