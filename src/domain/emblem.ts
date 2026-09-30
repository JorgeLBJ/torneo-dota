// What a team shows in its avatar slot: its own uploaded image, else its hero portrait, else a tile with its code.

export interface EmblemTeam {
  code: string;
  hero: string | null;
  imageKey: string | null;
}

export type Emblem =
  | { kind: 'image'; src: string; src2x: string }
  | { kind: 'hero'; src: string }
  | { kind: 'tile'; code: string };

/** The 2x object lives next to the 1x one: "teams/1/3-ab12.webp" -> "teams/1/3-ab12@2x.webp". */
export const retinaKey = (key: string): string => key.replace(/\.webp$/, '@2x.webp');

export interface EmblemSources {
  /** Public URL of an object in the image store; null when no store is configured. */
  imageUrl: ((key: string) => string) | null;
  heroUrl: (slug: string) => string;
}

export function resolveEmblem(team: EmblemTeam, sources: EmblemSources): Emblem {
  if (team.imageKey && sources.imageUrl) {
    return { kind: 'image', src: sources.imageUrl(team.imageKey), src2x: sources.imageUrl(retinaKey(team.imageKey)) };
  }
  if (team.hero) return { kind: 'hero', src: sources.heroUrl(team.hero) };
  return { kind: 'tile', code: team.code };
}
