import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { getHero, heroByDotaId } from '../src/data/heroes.js';
import { CachedDotaSource, DotaLookupError } from '../src/dota/source.js';
import { OpenDotaSource, mapOpenDotaMatch, parseDotaMatchId } from '../src/dota/opendota.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/opendota-9023462170.json', import.meta.url), 'utf8')) as Record<string, unknown>;

describe('hero ids', () => {
  it('every hero has its OpenDota id and can be found by it', () => {
    expect(getHero('antimage')!.id).toBe(1);
    expect(heroByDotaId(114)?.slug).toBe('monkey_king');
    expect(heroByDotaId(9999)).toBeUndefined();
  });
});

describe('parseDotaMatchId', () => {
  it('accepts a positive integer of up to 15 digits, with surrounding spaces', () => {
    expect(parseDotaMatchId(' 9023462170 ')).toEqual({ ok: true, value: 9023462170 });
  });

  it('rejects anything else with a Spanish message', () => {
    const message = 'El Match ID de Dota debe ser un número entero positivo (por ejemplo 9023462170).';
    for (const bad of ['', 'abc', '0', '-5', '12.5', '1e9', '9023462170x', '1'.repeat(16), '０１']) {
      expect(parseDotaMatchId(bad)).toEqual({ ok: false, error: message });
    }
  });
});

describe('mapOpenDotaMatch (the real match 9023462170)', () => {
  const snapshot = mapOpenDotaMatch(fixture);

  it('keeps the match facts', () => {
    expect(snapshot).toMatchObject({
      matchId: 9023462170,
      durationSec: 3966,
      radiantWin: true,
      radiantScore: 42,
      direScore: 41,
      firstBloodSec: -25, // first_blood_time says 0: the real time is in objectives, before the horn
      startTime: 1790791891,
    });
  });

  it('lists 5 radiant then 5 dire players with our hero slugs and names', () => {
    expect(snapshot.players).toHaveLength(10);
    expect(snapshot.players.map((p) => p.side)).toEqual([...Array(5).fill('radiant'), ...Array(5).fill('dire')]);
    expect(snapshot.players[0]).toEqual({
      side: 'radiant',
      nick: 'NothingToGay',
      heroSlug: 'monkey_king',
      heroName: 'Monkey King',
      kills: 16,
      deaths: 8,
      assists: 16,
      level: 30,
      gpm: 866,
      xpm: 1088,
      lastHits: 869,
      denies: 18,
      heroDamage: 61119,
    });
    expect(snapshot.players.every((p) => p.heroSlug !== null && getHero(p.heroSlug) !== undefined)).toBe(true);
  });

  it('team kills add up to the side scores that OpenDota reports', () => {
    const sum = (side: 'radiant' | 'dire', key: 'kills' | 'deaths') => snapshot.players.filter((p) => p.side === side).reduce((n, p) => n + p[key], 0);
    expect(sum('radiant', 'kills')).toBe(snapshot.radiantScore);
    expect(sum('dire', 'kills')).toBe(snapshot.direScore);
    expect(sum('radiant', 'deaths')).toBe(sum('dire', 'kills'));
  });

  it('bans are hero slugs only, in draft order; picks are not bans', () => {
    expect(snapshot.bans.length).toBeGreaterThan(0);
    expect(snapshot.bans.length).toBeLessThanOrEqual(14);
    expect(snapshot.bans.every((slug) => getHero(slug) !== undefined)).toBe(true);
  });

  it('stores only the compact fields: no raw payload, no account ids', () => {
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain('account_id');
    expect(json).not.toContain('personaname');
    expect(json).not.toContain('player_slot');
    expect(json.length).toBeLessThan(4000);
  });
});

describe('mapOpenDotaMatch edge cases', () => {
  const base = (over: Record<string, unknown> = {}, player: Record<string, unknown> = {}) => ({
    ...fixture,
    players: (fixture.players as Record<string, unknown>[]).map((p, i) => (i === 0 ? { ...p, ...player } : p)),
    ...over,
  });

  it('anonymous players have a null nick, and nicks are cleaned and capped at 40 characters', () => {
    expect(mapOpenDotaMatch(base({}, { personaname: null, name: null, account_id: null })).players[0]!.nick).toBeNull();
    expect(mapOpenDotaMatch(base({}, { personaname: '   ' })).players[0]!.nick).toBeNull();
    const long = mapOpenDotaMatch(base({}, { personaname: `  ${'x'.repeat(60)}\u0007\n ` })).players[0]!.nick!;
    expect(long).toHaveLength(40);
    expect(long).not.toMatch(/[\u0000-\u001f]/);
  });

  it('missing numbers (an unparsed match) become zero, an unknown hero keeps a placeholder', () => {
    const snapshot = mapOpenDotaMatch(base({ first_blood_time: null, objectives: [] }, { hero_damage: null, last_hits: undefined, hero_id: 9999 }));
    expect(snapshot.firstBloodSec).toBeNull();
    // without an objectives entry, first_blood_time is what there is
    expect(mapOpenDotaMatch(base({ objectives: [], first_blood_time: 312 })).firstBloodSec).toBe(312);
    expect(mapOpenDotaMatch(base({ objectives: [{ type: 'CHAT_MESSAGE_FIRSTBLOOD', time: 'x' }], first_blood_time: 7 })).firstBloodSec).toBe(7);
    expect(snapshot.players[0]).toMatchObject({ heroDamage: 0, lastHits: 0, heroSlug: null, heroName: 'Héroe 9999' });
  });

  it('refuses a payload that is not a full 5v5 match', () => {
    expect(() => mapOpenDotaMatch({ ...fixture, players: (fixture.players as unknown[]).slice(0, 8) })).toThrow(DotaLookupError);
    expect(() => mapOpenDotaMatch({ error: 'nope' })).toThrow(DotaLookupError);
    expect(() => mapOpenDotaMatch(null)).toThrow(DotaLookupError);
  });
});

describe('mapOpenDotaMatch: who won', () => {
  it('a match without a boolean radiant_win is incomplete, never a Dire win by default', () => {
    for (const radiant_win of [undefined, null, 'true', 1, 0]) {
      const match = { ...fixture, radiant_win };
      expect(() => mapOpenDotaMatch(match)).toThrow(DotaLookupError);
      try {
        mapOpenDotaMatch(match);
      } catch (error) {
        expect((error as DotaLookupError).code).toBe('incomplete');
        expect((error as Error).message).toContain('no tiene sus 10 jugadores todavía');
      }
    }
  });

  it('both real outcomes are still read', () => {
    expect(mapOpenDotaMatch({ ...fixture, radiant_win: true }).radiantWin).toBe(true);
    expect(mapOpenDotaMatch({ ...fixture, radiant_win: false }).radiantWin).toBe(false);
  });
});

describe('OpenDotaSource: the default fetch and failed responses', () => {
  it('uses the global fetch without a receiver, so it never throws "Illegal invocation"', async () => {
    const seenThis: unknown[] = [];
    vi.stubGlobal('fetch', function (this: unknown) {
      seenThis.push(this);
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(new Response(JSON.stringify(fixture), { status: 200 }));
    });
    try {
      const snapshot = await new OpenDotaSource().fetch(9023462170);
      expect(snapshot.matchId).toBe(9023462170);
      expect(seenThis.every((t) => t === undefined || t === globalThis)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('cancels the body of a 5xx answer before retrying, so the connection is released', async () => {
    let cancelled = 0;
    const failing = () => new Response(new ReadableStream({ start() {}, cancel() { cancelled++; } }), { status: 502 });
    const answers = [failing(), new Response(JSON.stringify(fixture), { status: 200 })];
    const fetchImpl = (async () => answers.shift()!) as unknown as typeof fetch;
    const snapshot = await new OpenDotaSource({ fetchImpl, retryDelayMs: 0 }).fetch(1);
    expect(snapshot.matchId).toBe(9023462170);
    expect(cancelled).toBe(1);
  });

  it('also cancels the body of the answer it gives up on', async () => {
    let cancelled = 0;
    const failing = () => new Response(new ReadableStream({ start() {}, cancel() { cancelled++; } }), { status: 503 });
    const answers = [failing(), failing()];
    const fetchImpl = (async () => answers.shift()!) as unknown as typeof fetch;
    await expect(new OpenDotaSource({ fetchImpl, retryDelayMs: 0 }).fetch(1)).rejects.toMatchObject({ code: 'unavailable' });
    expect(cancelled).toBe(2);
  });
});

describe('OpenDotaSource', () => {
  const respond = (...responses: (Response | Error)[]) => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const next = responses.shift() ?? new Response('{}', { status: 500 });
      if (next instanceof Error) throw next;
      return next;
    };
    return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const code = async (promise: Promise<unknown>) => {
    try {
      await promise;
      return 'ok';
    } catch (error) {
      return error instanceof DotaLookupError ? error.code : `other:${String(error)}`;
    }
  };

  it('asks OpenDota for the match with a User-Agent and a timeout', async () => {
    const { calls, fetchImpl } = respond(json(fixture));
    const snapshot = await new OpenDotaSource({ fetchImpl }).fetch(9023462170);
    expect(snapshot.matchId).toBe(9023462170);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.opendota.com/api/matches/9023462170');
    expect((calls[0]!.init?.headers as Record<string, string>)['User-Agent']).toMatch(/torneo-dota/);
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('404 is "not found", 429 is "rate limited", nothing is retried', async () => {
    const notFound = respond(json({ error: 'Not Found' }, 404));
    expect(await code(new OpenDotaSource({ fetchImpl: notFound.fetchImpl }).fetch(1))).toBe('not_found');
    expect(notFound.calls).toHaveLength(1);
    const limited = respond(json({}, 429));
    expect(await code(new OpenDotaSource({ fetchImpl: limited.fetchImpl }).fetch(1))).toBe('rate_limited');
    expect(limited.calls).toHaveLength(1);
  });

  it('retries once on a 5xx, then succeeds or gives up as unavailable', async () => {
    const recovers = respond(json({}, 502), json(fixture));
    expect((await new OpenDotaSource({ fetchImpl: recovers.fetchImpl, retryDelayMs: 0 }).fetch(9023462170)).matchId).toBe(9023462170);
    expect(recovers.calls).toHaveLength(2);
    const fails = respond(json({}, 503), json({}, 503), json(fixture));
    expect(await code(new OpenDotaSource({ fetchImpl: fails.fetchImpl, retryDelayMs: 0 }).fetch(1))).toBe('unavailable');
    expect(fails.calls).toHaveLength(2);
  });

  it('a network error or a timeout is unavailable', async () => {
    expect(await code(new OpenDotaSource({ fetchImpl: respond(new Error('ECONNRESET')).fetchImpl }).fetch(1))).toBe('unavailable');
    const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    expect(await code(new OpenDotaSource({ fetchImpl: respond(timeout).fetchImpl }).fetch(1))).toBe('unavailable');
  });

  it('an unreadable answer or a match without its 10 players is reported, not stored', async () => {
    expect(await code(new OpenDotaSource({ fetchImpl: respond(new Response('<html>', { status: 200 })).fetchImpl }).fetch(1))).toBe('unavailable');
    expect(await code(new OpenDotaSource({ fetchImpl: respond(json({ players: [] })).fetchImpl }).fetch(1))).toBe('incomplete');
  });

  it('has Spanish messages for the admin', async () => {
    const message = async (status: number) => {
      try {
        await new OpenDotaSource({ fetchImpl: respond(json({}, status)).fetchImpl, retryDelayMs: 0 }).fetch(1);
      } catch (error) {
        return (error as Error).message;
      }
      return '';
    };
    expect(await message(404)).toBe('Partida no encontrada. Revisa el Match ID.');
    expect(await message(429)).toContain('demasiadas consultas');
    expect(await message(500)).toContain('no responde');
  });
});

describe('CachedDotaSource', () => {
  const snapshot = mapOpenDotaMatch(fixture);

  it('serves the same match from memory for 10 minutes, then asks again', async () => {
    let calls = 0;
    let now = 1_000_000;
    const cached = new CachedDotaSource({ fetch: async () => (calls++, snapshot) }, () => now);
    await cached.fetch(1);
    now += 9 * 60_000;
    await cached.fetch(1);
    expect(calls).toBe(1);
    now += 2 * 60_000;
    await cached.fetch(1);
    expect(calls).toBe(2);
  });

  it('different ids are cached apart, and errors are never cached', async () => {
    let calls = 0;
    let fail = true;
    const cached = new CachedDotaSource(
      {
        fetch: async () => {
          calls++;
          if (fail) throw new DotaLookupError('unavailable', 'x');
          return snapshot;
        },
      },
      () => 0,
    );
    await expect(cached.fetch(1)).rejects.toThrow();
    fail = false;
    await cached.fetch(1);
    await cached.fetch(2);
    await cached.fetch(1);
    expect(calls).toBe(3);
  });

  it('keeps a bounded number of matches', async () => {
    let calls = 0;
    const cached = new CachedDotaSource({ fetch: async () => (calls++, snapshot) }, () => 0, { maxEntries: 2 });
    await cached.fetch(1);
    await cached.fetch(2);
    await cached.fetch(3);
    await cached.fetch(1);
    expect(calls).toBe(4);
  });
});
