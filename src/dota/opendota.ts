import { fail, ok, type Checked } from '../checked.js';
import { heroByDotaId } from '../data/heroes.js';
import type { DotaPlayerLine, DotaSnapshot } from './snapshot.js';
import { DotaLookupError, type DotaMatchSource } from './source.js';

const BASE_URL = 'https://api.opendota.com/api/matches';
const USER_AGENT = 'torneo-dota (+https://github.com/JorgeLBJ/torneo-dota)';
const NICK_MAX = 40;

const MESSAGES = {
  not_found: 'Partida no encontrada. Revisa el Match ID.',
  rate_limited: 'OpenDota recibió demasiadas consultas. Espera un minuto e inténtalo de nuevo.',
  unavailable: 'OpenDota no responde ahora. Inténtalo de nuevo en unos minutos o carga los datos a mano.',
  incomplete: 'La partida no tiene sus 10 jugadores todavía (puede que OpenDota aún no la haya procesado). Inténtalo más tarde.',
} as const;

const lookupError = (code: keyof typeof MESSAGES) => new DotaLookupError(code, MESSAGES[code]);

/** A Dota match id: a positive integer of up to 15 digits (real ids have 10). */
export function parseDotaMatchId(input: string): Checked<number> {
  const text = input.trim();
  if (!/^[0-9]{1,15}$/.test(text) || Number(text) < 1) {
    return fail('El Match ID de Dota debe ser un número entero positivo (por ejemplo 9023462170).');
  }
  return ok(Number(text));
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

function cleanNick(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NICK_MAX).trim();
  return text === '' ? null : text;
}

function mapPlayer(raw: Record<string, unknown>, side: 'radiant' | 'dire'): DotaPlayerLine {
  const heroId = num(raw.hero_id);
  const hero = heroByDotaId(heroId);
  return {
    side,
    nick: cleanNick(raw.personaname),
    heroSlug: hero?.slug ?? null,
    heroName: hero?.name ?? `Héroe ${heroId}`,
    kills: num(raw.kills),
    deaths: num(raw.deaths),
    assists: num(raw.assists),
    level: num(raw.level),
    gpm: num(raw.gold_per_min),
    xpm: num(raw.xp_per_min),
    lastHits: num(raw.last_hits),
    denies: num(raw.denies),
    heroDamage: num(raw.hero_damage),
  };
}

/** Keeps only the compact fields of an OpenDota match; anything that is not a full 5v5 is refused. */
export function mapOpenDotaMatch(raw: unknown): DotaSnapshot {
  if (typeof raw !== 'object' || raw === null) throw lookupError('incomplete');
  const match = raw as Record<string, unknown>;
  const players = Array.isArray(match.players) ? (match.players as Record<string, unknown>[]) : [];
  const isRadiant = (p: Record<string, unknown>) => (typeof p.isRadiant === 'boolean' ? p.isRadiant : num(p.player_slot) < 128);
  const radiant = players.filter(isRadiant);
  const dire = players.filter((p) => !isRadiant(p));
  if (players.length !== 10 || radiant.length !== 5 || dire.length !== 5) throw lookupError('incomplete');

  const picksBans = Array.isArray(match.picks_bans) ? (match.picks_bans as Record<string, unknown>[]) : [];
  const bans = picksBans
    .filter((entry) => entry.is_pick === false)
    .sort((a, b) => num(a.order) - num(b.order))
    .map((entry) => heroByDotaId(num(entry.hero_id))?.slug)
    .filter((slug): slug is string => slug !== undefined);

  return {
    matchId: num(match.match_id),
    durationSec: num(match.duration),
    radiantWin: match.radiant_win === true,
    radiantScore: num(match.radiant_score),
    direScore: num(match.dire_score),
    firstBloodSec: typeof match.first_blood_time === 'number' ? match.first_blood_time : null,
    startTime: num(match.start_time),
    players: [...radiant.map((p) => mapPlayer(p, 'radiant')), ...dire.map((p) => mapPlayer(p, 'dire'))],
    bans,
  };
}

export interface OpenDotaOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
}

/** Adapter for https://api.opendota.com: timeout, one retry on a server error, and Spanish error messages. */
export class OpenDotaSource implements DotaMatchSource {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;

  constructor(options: OpenDotaOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.retryDelayMs = options.retryDelayMs ?? 400;
  }

  async fetch(matchId: number): Promise<DotaSnapshot> {
    let response = await this.request(matchId);
    if (response.status >= 500) {
      if (this.retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      response = await this.request(matchId);
    }
    if (response.status === 404) throw lookupError('not_found');
    if (response.status === 429) throw lookupError('rate_limited');
    if (!response.ok) throw lookupError('unavailable');
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw lookupError('unavailable');
    }
    return mapOpenDotaMatch(body);
  }

  private async request(matchId: number): Promise<Response> {
    try {
      return await this.fetchImpl(`${BASE_URL}/${matchId}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw lookupError('unavailable');
    }
  }
}
