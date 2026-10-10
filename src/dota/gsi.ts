import { getHero, heroByDotaId } from '../data/heroes.js';
import type { DotaPlayerLine, DotaSnapshot } from './snapshot.js';
import { DotaLookupError } from './source.js';

/**
 * Maps the latest Game State Integration payload an observer sent (spectator shape) to the snapshot the admin
 * import understands. The shape follows Valve's documented spectator payload and has NOT been checked against a
 * real capture yet: every read is tolerant, and the mapper must be revisited with a real POST_GAME payload.
 *
 *   map:    { matchid, clock_time, win_team: 'radiant' | 'dire' | 'none', radiant_score, dire_score }
 *   player: { team2: { player0..player4: { name, kills, deaths, assists, last_hits, denies, gpm, xpm, hero_damage } },
 *             team3: { player5..player9: { ... } } }          (team2 = Radiant, team3 = Dire)
 *   hero:   { team2: { player0: { id, name: 'npc_dota_hero_axe', level } }, team3: { ... } }
 *   draft:  { team2: { ban0_id, ban0_class, ... }, team3: { ... } }
 */

export const NOT_FINISHED_MESSAGE =
  'La partida capturada aún no terminó. Espera a que el observador vea el final de la partida e inténtalo de nuevo.';
const INCOMPLETE_MESSAGE =
  'La captura de la partida está incompleta (faltan jugadores o el ganador). Revisa que el observador estuviera viendo la partida completa.';

const NICK_MAX = 40;
const HERO_PREFIX = 'npc_dota_hero_';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function cleanNick(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NICK_MAX).trim();
  return text === '' ? null : text;
}

/** 'npc_dota_hero_new_guy' -> 'New Guy' (only used for heroes missing from our catalog). */
const prettyHero = (className: string): string =>
  className
    .slice(HERO_PREFIX.length)
    .split('_')
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');

/** The five `playerN` entries of a team block, in slot order. */
function teamEntries(block: unknown): Obj[] {
  if (!isObj(block)) return [];
  return Object.keys(block)
    .map((key) => ({ key, slot: /^player(\d+)$/.exec(key)?.[1] }))
    .filter((e): e is { key: string; slot: string } => e.slot !== undefined && isObj(block[e.key]))
    .sort((a, b) => Number(a.slot) - Number(b.slot))
    .map((e) => ({ slot: Number(e.slot), ...(block[e.key] as Obj) }));
}

function mapSide(state: Obj, team: 'team2' | 'team3', side: 'radiant' | 'dire'): DotaPlayerLine[] {
  const players = isObj(state.player) ? teamEntries(state.player[team]) : [];
  const heroes = isObj(state.hero) && isObj(state.hero[team]) ? (state.hero[team] as Obj) : {};
  return players.map((p) => {
    const hero = isObj(heroes[`player${p.slot as number}`]) ? (heroes[`player${p.slot as number}`] as Obj) : {};
    const className = typeof hero.name === 'string' && hero.name.startsWith(HERO_PREFIX) ? hero.name : null;
    const known = heroByDotaId(num(hero.id)) ?? (className ? getHero(className.slice(HERO_PREFIX.length)) : undefined);
    return {
      side,
      nick: cleanNick(p.name),
      heroSlug: known?.slug ?? null,
      heroName: known?.name ?? (className ? prettyHero(className) : `Héroe ${num(hero.id)}`),
      kills: num(p.kills),
      deaths: num(p.deaths),
      assists: num(p.assists),
      level: num(hero.level),
      gpm: num(p.gpm ?? p.gold_per_min),
      xpm: num(p.xpm),
      lastHits: num(p.last_hits),
      denies: num(p.denies),
      heroDamage: num(p.hero_damage),
      ...(typeof p.net_worth === 'number' && Number.isFinite(p.net_worth) ? { netWorth: p.net_worth } : {}),
    };
  });
}

/** Banned hero slugs from `draft.team2/team3.banN_class|banN_id`: by ban index, Radiant first (best effort order). */
function mapBans(draft: unknown): string[] {
  if (!isObj(draft)) return [];
  const bans: { index: number; team: number; slug: string }[] = [];
  for (const [team, teamNo] of [['team2', 0], ['team3', 1]] as const) {
    const block = draft[team];
    if (!isObj(block)) continue;
    for (const key of Object.keys(block)) {
      const m = /^ban(\d+)_(class|id)$/.exec(key);
      if (!m) continue;
      const value = block[key];
      const slug =
        m[2] === 'class' && typeof value === 'string' && value.startsWith(HERO_PREFIX)
          ? getHero(value.slice(HERO_PREFIX.length))?.slug
          : m[2] === 'id'
            ? heroByDotaId(num(value))?.slug
            : undefined;
      if (slug && !bans.some((b) => b.team === teamNo && b.index === Number(m[1]))) bans.push({ index: Number(m[1]), team: teamNo, slug });
    }
  }
  return bans.sort((a, b) => a.index - b.index || a.team - b.team).map((b) => b.slug);
}

/** What an admin can read from any stored state, final or not: nothing here throws, missing values are null. */
export interface GsiSummary {
  radiant: DotaPlayerLine[];
  dire: DotaPlayerLine[];
  radiantScore: number | null;
  direScore: number | null;
  durationSec: number | null;
  winner: 'radiant' | 'dire' | null;
}

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function summarizeGsiState(raw: unknown): GsiSummary {
  const state = isObj(raw) ? raw : {};
  const map = isObj(state.map) ? state.map : {};
  const clock = numOrNull(map.clock_time);
  return {
    radiant: mapSide(state, 'team2', 'radiant'),
    dire: mapSide(state, 'team3', 'dire'),
    radiantScore: numOrNull(map.radiant_score),
    direScore: numOrNull(map.dire_score),
    durationSec: clock === null ? null : Math.floor(clock),
    winner: map.win_team === 'radiant' || map.win_team === 'dire' ? map.win_team : null,
  };
}

/**
 * `startTime` is not in the payload: callers pass when the first state of the match arrived (an approximation of the
 * start, early by the pre-game time). `firstBloodSec` is not in the payload either.
 */
export function mapGsiState(raw: unknown, meta: { startTime: number }): DotaSnapshot {
  const incomplete = () => new DotaLookupError('incomplete', INCOMPLETE_MESSAGE);
  if (!isObj(raw) || !isObj(raw.map)) throw incomplete();
  const map = raw.map;
  const radiant = mapSide(raw, 'team2', 'radiant');
  const dire = mapSide(raw, 'team3', 'dire');
  if (radiant.length !== 5 || dire.length !== 5) throw incomplete();
  // Without a real winner the game is not decided: never guess Dire.
  if (map.win_team !== 'radiant' && map.win_team !== 'dire') throw incomplete();
  const matchId = typeof map.matchid === 'string' ? Number(map.matchid) : num(map.matchid);

  return {
    matchId: Number.isSafeInteger(matchId) && matchId > 0 ? matchId : 0,
    durationSec: Math.max(0, Math.floor(num(map.clock_time))),
    radiantWin: map.win_team === 'radiant',
    radiantScore: num(map.radiant_score),
    direScore: num(map.dire_score),
    firstBloodSec: null,
    startTime: meta.startTime,
    players: [...radiant, ...dire],
    bans: mapBans(raw.draft),
  };
}
