import { readFileSync } from 'node:fs';

export type HeroAttr = 'str' | 'agi' | 'int' | 'all';

export interface Hero {
  slug: string;
  name: string;
  attr: HeroAttr;
}

export const HEROES: readonly Hero[] = JSON.parse(
  readFileSync(new URL('./heroes.json', import.meta.url), 'utf8'),
) as Hero[];

const BY_SLUG = new Map(HEROES.map((h) => [h.slug, h]));

export const getHero = (slug: string): Hero | undefined => BY_SLUG.get(slug);
export const isHeroSlug = (slug: string): boolean => BY_SLUG.has(slug);
