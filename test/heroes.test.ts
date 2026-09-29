import { describe, expect, it } from 'vitest';
import { HEROES, getHero, isHeroSlug } from '../src/data/heroes.js';

describe('hero list', () => {
  it('has 127 heroes with slug, name and attribute', () => {
    expect(HEROES).toHaveLength(127);
    for (const h of HEROES) {
      expect(h.slug).toMatch(/^[a-z0-9_]+$/);
      expect(h.name.length).toBeGreaterThan(0);
      expect(['str', 'agi', 'int', 'all']).toContain(h.attr);
    }
    expect(new Set(HEROES.map((h) => h.slug)).size).toBe(127);
  });

  it('validates slugs', () => {
    expect(isHeroSlug('axe')).toBe(true);
    expect(isHeroSlug('not_a_hero')).toBe(false);
    expect(isHeroSlug('')).toBe(false);
    expect(getHero('antimage')?.name).toBe('Anti-Mage');
    expect(getHero('nope')).toBeUndefined();
  });
});
