import { describe, expect, it } from 'vitest';
import { resolveEmblem, retinaKey } from '../src/domain/emblem.js';

const sources = { imageUrl: (key: string) => `https://cdn.example/${key}`, heroUrl: (slug: string) => `/assets/heroes/${slug}.png` };

describe('resolveEmblem', () => {
  it('prefers the custom image, with its 2x version', () => {
    expect(resolveEmblem({ code: 'A', hero: 'axe', imageKey: 'teams/1/2-abc.webp' }, sources)).toEqual({
      kind: 'image',
      src: 'https://cdn.example/teams/1/2-abc.webp',
      src2x: 'https://cdn.example/teams/1/2-abc@2x.webp',
    });
  });

  it('falls back to the hero portrait, then to a tile with the code', () => {
    expect(resolveEmblem({ code: 'A', hero: 'axe', imageKey: null }, sources)).toEqual({ kind: 'hero', src: '/assets/heroes/axe.png' });
    expect(resolveEmblem({ code: 'A', hero: null, imageKey: null }, sources)).toEqual({ kind: 'tile', code: 'A' });
  });

  it('ignores a stored image when no image store is configured', () => {
    expect(resolveEmblem({ code: 'A', hero: 'axe', imageKey: 'teams/1/2-abc.webp' }, { ...sources, imageUrl: null })).toEqual({ kind: 'hero', src: '/assets/heroes/axe.png' });
    expect(resolveEmblem({ code: 'B', hero: null, imageKey: 'teams/1/2-abc.webp' }, { ...sources, imageUrl: null })).toEqual({ kind: 'tile', code: 'B' });
  });

  it('derives the 2x key', () => {
    expect(retinaKey('teams/7/9-deadbeef.webp')).toBe('teams/7/9-deadbeef@2x.webp');
  });
});
