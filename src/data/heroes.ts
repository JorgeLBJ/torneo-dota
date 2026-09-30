import heroData from './heroes.json' with { type: 'json' };

export type HeroAttr = 'str' | 'agi' | 'int' | 'all';

export interface Hero {
  slug: string;
  /** The hero id OpenDota (and the Dota client) use. */
  id: number;
  name: string;
  attr: HeroAttr;
}

// Bundled with the code (a static import), so it resolves the same from any working directory.
export const HEROES: readonly Hero[] = heroData as Hero[];

const BY_SLUG = new Map(HEROES.map((h) => [h.slug, h]));

export const getHero = (slug: string): Hero | undefined => BY_SLUG.get(slug);
export const isHeroSlug = (slug: string): boolean => BY_SLUG.has(slug);

const BY_DOTA_ID = new Map(HEROES.map((h) => [h.id, h]));

export const heroByDotaId = (id: number): Hero | undefined => BY_DOTA_ID.get(id);
