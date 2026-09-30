import { createContext, useContext } from 'hono/jsx';
import type { FC } from 'hono/jsx';
import { resolveEmblem, type EmblemSources } from './domain/emblem.js';
import { heroPortraitUrl } from './emblem-sources.js';
import type { Team } from './db/repository.js';

/** Views render emblems through this context so they never learn where images are stored. */
export const EmblemSourcesContext = createContext<EmblemSources>({ imageUrl: null, heroUrl: heroPortraitUrl });

/** Whether the team shows a picture (custom image or hero) rather than its code tile, given what the store can serve. */
export const hasPicture = (team: Team, sources: EmblemSources): boolean => resolveEmblem(team, sources).kind !== 'tile';

/** The 16:9 picture of a team (custom image with a 2x source, or the hero portrait); null when it only has a code. */
export const EmblemPicture: FC<{ team: Team; cls?: string; eager?: boolean }> = ({ team, cls = '', eager = false }) => {
  const emblem = resolveEmblem(team, useContext(EmblemSourcesContext));
  if (emblem.kind === 'tile') return null;
  if (emblem.kind === 'hero') return <img class={cls} src={emblem.src} alt={team.name} loading={eager ? 'eager' : 'lazy'} />;
  return (
    <img
      class={cls}
      src={emblem.src}
      srcset={`${emblem.src} 1x, ${emblem.src2x} 2x`}
      width="512"
      height="288"
      alt={team.name}
      loading={eager ? 'eager' : 'lazy'}
    />
  );
};
