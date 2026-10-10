import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateObserverToken } from '../src/auth/observer-token.js';
import { CapturedDotaSource } from '../src/dota/captured.js';
import { mapGsiState, summarizeGsiState } from '../src/dota/gsi.js';
import type { DotaSnapshot } from '../src/dota/snapshot.js';
import { DotaLookupError, type DotaMatchSource } from '../src/dota/source.js';
import { makeApp, type TestApp } from './helpers/app.js';

// SYNTHETIC FIXTURE: hand-built from Valve's documented spectator payload shape, not a real capture.
// Replace test/fixtures/gsi-spectator-sample.json with a real POST_GAME payload (auth removed) as soon as one
// exists, and adjust src/dota/gsi.ts if the real keys differ.
const sample = () => JSON.parse(readFileSync(new URL('./fixtures/gsi-spectator-sample.json', import.meta.url), 'utf8'));
const START = 1_760_000_000;

describe('mapGsiState', () => {
  it('maps a final spectator payload to a snapshot', () => {
    const snap = mapGsiState(sample(), { startTime: START });
    expect(snap).toMatchObject({
      matchId: 8123456789,
      durationSec: 2112,
      radiantWin: true,
      radiantScore: 42,
      direScore: 37,
      firstBloodSec: null,
      startTime: START,
    });
    expect(snap.players).toHaveLength(10);
    expect(snap.players.filter((p) => p.side === 'radiant')).toHaveLength(5);
    expect(snap.players[0]).toEqual({
      side: 'radiant',
      nick: 'Juan',
      heroSlug: 'axe',
      heroName: 'Axe',
      kills: 3,
      deaths: 5,
      assists: 7,
      level: 20,
      gpm: 400,
      xpm: 450,
      lastHits: 150,
      denies: 5,
      heroDamage: 12000,
      netWorth: 15000,
    });
    expect(snap.players[5]).toMatchObject({ side: 'dire', nick: 'Beto', heroSlug: 'antimage' });
  });

  it('reads the winner from win_team', () => {
    const state = sample();
    state.map.win_team = 'dire';
    expect(mapGsiState(state, { startTime: START }).radiantWin).toBe(false);
  });

  it('refuses a final payload without a winner instead of guessing Dire', () => {
    const state = sample();
    state.map.win_team = 'none';
    expect(() => mapGsiState(state, { startTime: START })).toThrow(DotaLookupError);
    delete state.map.win_team;
    expect(() => mapGsiState(state, { startTime: START })).toThrow(/incompleta/);
  });

  it('refuses a payload that does not have five players per side', () => {
    const state = sample();
    delete state.player.team3.player9;
    expect(() => mapGsiState(state, { startTime: START })).toThrow(DotaLookupError);
    expect(() => mapGsiState({}, { startTime: START })).toThrow(DotaLookupError);
    expect(() => mapGsiState(null, { startTime: START })).toThrow(DotaLookupError);
  });

  it('is tolerant: missing numbers are 0, a missing name is null, an unknown hero keeps a readable name', () => {
    const state = sample();
    state.player.team2.player0 = { name: '   ' };
    delete state.hero.team2.player0.level;
    state.hero.team3.player5 = { id: 99999, name: 'npc_dota_hero_new_guy', level: 'x' };
    state.hero.team3.player6 = { id: 88888 };
    const snap = mapGsiState(state, { startTime: START });
    expect(snap.players[0]).toMatchObject({ nick: null, kills: 0, deaths: 0, assists: 0, gpm: 0, xpm: 0, lastHits: 0, denies: 0, heroDamage: 0, level: 0, heroSlug: 'axe' });
    expect(snap.players[5]).toMatchObject({ heroSlug: null, heroName: 'New Guy', level: 0 });
    expect(snap.players[6]).toMatchObject({ heroSlug: null, heroName: 'Héroe 88888' });
  });

  it('falls back to the hero class name when the id is unknown but the slug is known', () => {
    const state = sample();
    state.hero.team2.player1 = { id: 0, name: 'npc_dota_hero_lina', level: 25 };
    expect(mapGsiState(state, { startTime: START }).players[1]).toMatchObject({ heroSlug: 'lina', heroName: 'Lina', level: 25 });
  });

  it('never reports a negative duration', () => {
    const state = sample();
    state.map.clock_time = -30;
    expect(mapGsiState(state, { startTime: START }).durationSec).toBe(0);
    delete state.map.clock_time;
    expect(mapGsiState(state, { startTime: START }).durationSec).toBe(0);
  });

  it('reads the bans from the draft when it has them, and gives none otherwise', () => {
    expect(mapGsiState(sample(), { startTime: START }).bans).toEqual(['bane', 'drow_ranger', 'bloodseeker', 'earthshaker']);
    const state = sample();
    delete state.draft;
    expect(mapGsiState(state, { startTime: START }).bans).toEqual([]);
  });

  it('reads the match id from map.matchid', () => {
    const state = sample();
    state.map.matchid = '77';
    expect(mapGsiState(state, { startTime: START }).matchId).toBe(77);
  });
});

describe('summarizeGsiState', () => {
  it('reads a final payload', () => {
    const s = summarizeGsiState(sample());
    expect(s).toMatchObject({ radiantScore: 42, direScore: 37, durationSec: 2112, winner: 'radiant' });
    expect(s.radiant).toHaveLength(5);
    expect(s.dire).toHaveLength(5);
  });

  it('is tolerant: an unfinished or odd payload gives what it has and nulls otherwise', () => {
    expect(summarizeGsiState({ map: { radiant_score: 4, win_team: 'none' } })).toEqual({
      radiant: [],
      dire: [],
      radiantScore: 4,
      direScore: null,
      durationSec: null,
      winner: null,
    });
    expect(summarizeGsiState(null).winner).toBeNull();
    expect(summarizeGsiState('x').radiant).toEqual([]);
  });

  it('leaves net worth out when the payload does not carry it', () => {
    const state = sample();
    delete state.player.team2.player0.net_worth;
    expect('netWorth' in summarizeGsiState(state).radiant[0]!).toBe(false);
  });
});

describe('CapturedDotaSource', () => {
  let t: TestApp;
  let observerId: number;
  let innerCalls: number[];
  let innerResult: DotaSnapshot | DotaLookupError;
  const innerSnapshot = { matchId: 5, durationSec: 1, radiantWin: true, radiantScore: 1, direScore: 0, firstBloodSec: null, startTime: 1, players: [], bans: [] } as DotaSnapshot;
  const inner: DotaMatchSource = {
    fetch: async (id) => {
      innerCalls.push(id);
      if (innerResult instanceof DotaLookupError) throw innerResult;
      return innerResult;
    },
  };

  beforeEach(async () => {
    innerCalls = [];
    innerResult = innerSnapshot;
    t = await makeApp({ dotaSource: inner });
    const gen = generateObserverToken();
    observerId = t.repo.createObserverToken('Juan', gen.hash, gen.prefix).id;
  });
  afterEach(() => t.db.close());

  const store = (isFinal: boolean, state: unknown = sample()) =>
    t.repo.upsertGsiCapture(8123456789, observerId, isFinal ? 'DOTA_GAMERULES_STATE_POST_GAME' : 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', isFinal, JSON.stringify(state));

  it('returns the mapped snapshot of a final capture without calling the inner source', async () => {
    store(true);
    const snap = await new CapturedDotaSource(t.repo, inner).fetch(8123456789);
    expect(snap.radiantScore).toBe(42);
    expect(snap.matchId).toBe(8123456789);
    expect(snap.startTime).toBeGreaterThan(1_700_000_000); // first_received_at, as unix seconds
    expect(innerCalls).toEqual([]);
  });

  it('answers "incomplete" for a capture that has not reached the end, without asking the inner source', async () => {
    store(false);
    const source = new CapturedDotaSource(t.repo, inner);
    await expect(source.fetch(8123456789)).rejects.toMatchObject({ code: 'incomplete', message: expect.stringContaining('aún no terminó') });
    expect(innerCalls).toEqual([]);
  });

  it('delegates to the inner source when there is no capture', async () => {
    const snap = await new CapturedDotaSource(t.repo, inner).fetch(5);
    expect(snap).toBe(innerSnapshot);
    expect(innerCalls).toEqual([5]);
  });

  it('lets inner errors through', async () => {
    innerResult = new DotaLookupError('not_found', 'nada');
    await expect(new CapturedDotaSource(t.repo, inner).fetch(5)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('is what the app uses for the admin lookup: a captured final match is found without calling the inner source', async () => {
    store(true);
    const cookie = await t.login();
    const tournament = t.repo.createTournament({ name: 'Copa', slug: 'copa' });
    t.repo.setActiveTournament(tournament.id);
    const res = await t.send('POST', `/admin/t/${tournament.id}/dota/buscar`, {
      form: { dota_match_id: '8123456789' },
      cookie,
      headers: { accept: 'application/json' },
    });
    const body = (await res.json()) as { ok: boolean; summary?: string };
    expect(body.ok).toBe(true);
    expect(body.summary).toContain('42 – 37');
    expect(innerCalls).toEqual([]);
  });

  it('falls through to the configured source from the admin lookup when nothing was captured', async () => {
    const cookie = await t.login();
    const tournament = t.repo.createTournament({ name: 'Copa', slug: 'copa' });
    t.repo.setActiveTournament(tournament.id);
    const res = await t.send('POST', `/admin/t/${tournament.id}/dota/buscar`, {
      form: { dota_match_id: '5' },
      cookie,
      headers: { accept: 'application/json' },
    });
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(innerCalls).toEqual([5]);
  });

  it('shows the Spanish "not finished" message for an in-progress capture', async () => {
    store(false);
    const cookie = await t.login();
    const tournament = t.repo.createTournament({ name: 'Copa', slug: 'copa' });
    const res = await t.send('POST', `/admin/t/${tournament.id}/dota/buscar`, {
      form: { dota_match_id: '8123456789' },
      cookie,
      headers: { accept: 'application/json' },
    });
    expect(JSON.stringify(await res.json())).toContain('aún no terminó');
  });
});
