/** What is kept of an imported Dota match: compact, no raw payload, no account ids. */
export interface DotaPlayerLine {
  side: 'radiant' | 'dire';
  /** Steam persona name, or null for anonymous players. */
  nick: string | null;
  /** Our hero slug (portrait under /assets/heroes), or null for a hero we do not know yet. */
  heroSlug: string | null;
  heroName: string;
  kills: number;
  deaths: number;
  assists: number;
  level: number;
  gpm: number;
  xpm: number;
  lastHits: number;
  denies: number;
  heroDamage: number;
}

export interface DotaSnapshot {
  matchId: number;
  durationSec: number;
  radiantWin: boolean;
  radiantScore: number;
  direScore: number;
  firstBloodSec: number | null;
  /** Unix seconds. */
  startTime: number;
  players: DotaPlayerLine[];
  /** Banned hero slugs, in draft order. */
  bans: string[];
}
