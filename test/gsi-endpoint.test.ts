import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateObserverToken } from '../src/auth/observer-token.js';
import { GSI_MAX_BODY_BYTES, GSI_RATE_LIMIT } from '../src/gsi/routes.js';
import { makeApp, type TestApp } from './helpers/app.js';

const POST_GAME = 'DOTA_GAMERULES_STATE_POST_GAME';
const IN_PROGRESS = 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS';

let t: TestApp;
let token: string;
let observerId: number;
beforeEach(async () => {
  t = await makeApp({ publicBaseUrl: 'https://torneo.example.com' });
  const gen = generateObserverToken();
  token = gen.token;
  observerId = t.repo.createObserverToken('Juan', gen.hash, gen.prefix).id;
});
afterEach(() => t.db.close());

const payload = (matchid: unknown, gameState: string, extra: Record<string, unknown> = {}, authToken: unknown = token) => ({
  auth: { token: authToken },
  map: { matchid, game_state: gameState, clock_time: 100 },
  ...extra,
});

const gsi = (body: unknown, raw = false) =>
  t.app.request('/gsi', {
    method: 'POST',
    body: raw ? (body as string) : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

const stored = () => t.db.prepare('SELECT * FROM gsi_captures').all() as Record<string, unknown>[];

describe('POST /gsi authentication', () => {
  it('answers 401 without a token, with an unknown token and with a revoked one', async () => {
    expect((await gsi({ map: { matchid: '1' } })).status).toBe(401);
    expect((await gsi(payload('1', IN_PROGRESS, {}, 'nope'))).status).toBe(401);
    expect((await gsi(payload('1', IN_PROGRESS, {}, 42))).status).toBe(401);
    t.repo.revokeObserverToken(observerId);
    expect((await gsi(payload('1', IN_PROGRESS))).status).toBe(401);
    expect(stored()).toHaveLength(0);
  });

  it('answers 400 to malformed JSON and to a non-object body', async () => {
    expect((await gsi('{not json', true)).status).toBe(400);
    expect((await gsi('[1,2]', true)).status).toBe(400);
    expect((await gsi('null', true)).status).toBe(400);
  });

  it('does not echo the token', async () => {
    const res = await gsi(payload('1', IN_PROGRESS, {}, 'nope'));
    expect(await res.text()).not.toContain('nope');
  });

  it('is not subject to the admin same-origin guard', async () => {
    const res = await t.app.request('/gsi', {
      method: 'POST',
      body: JSON.stringify(payload('1', IN_PROGRESS)),
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    });
    expect(res.status).toBe(200);
  });
});

describe('POST /gsi limits', () => {
  it('answers 413 above 1 MB', async () => {
    const big = payload('1', IN_PROGRESS, { filler: 'x'.repeat(GSI_MAX_BODY_BYTES) });
    expect((await gsi(big)).status).toBe(413);
    expect(stored()).toHaveLength(0);
  });

  it('accepts bodies far above the global 64 KB cap', async () => {
    const res = await gsi(payload('1', IN_PROGRESS, { filler: 'x'.repeat(200 * 1024) }));
    expect(res.status).toBe(200);
    expect(stored()).toHaveLength(1);
  });

  it('answers 429 once a token exceeds its budget, without affecting other tokens', async () => {
    const other = generateObserverToken();
    t.repo.createObserverToken('Ana', other.hash, other.prefix);
    for (let i = 0; i < GSI_RATE_LIMIT; i++) expect((await gsi(payload('0', IN_PROGRESS))).status).toBe(200);
    expect((await gsi(payload('0', IN_PROGRESS))).status).toBe(429);
    expect((await gsi(payload('0', IN_PROGRESS, {}, other.token))).status).toBe(200);
  });
});

describe('POST /gsi capture', () => {
  it('stores the latest state per match id and strips the auth block', async () => {
    const res = await gsi(payload('8123456789', IN_PROGRESS, { player: { team2: {} } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const rows = stored();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dota_match_id: 8123456789, observer_token_id: observerId, game_state: IN_PROGRESS, is_final: 0 });
    const state = JSON.parse(rows[0]!.state_json as string);
    expect(state.auth).toBeUndefined();
    expect(state.player).toEqual({ team2: {} });
    expect(rows[0]!.state_json as string).not.toContain(token);
  });

  it('accepts a numeric match id', async () => {
    expect((await gsi(payload(8123456789, IN_PROGRESS))).status).toBe(200);
    expect(stored()[0]).toMatchObject({ dota_match_id: 8123456789 });
  });

  it('updates the same row on later posts and keeps the first-received time', async () => {
    await gsi(payload('77', IN_PROGRESS, { n: 1 }));
    t.db.prepare("UPDATE gsi_captures SET first_received_at = '2020-01-01 00:00:00'").run();
    await gsi(payload('77', IN_PROGRESS, { n: 2 }));
    const rows = stored();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.state_json as string).n).toBe(2);
    expect(rows[0]!.first_received_at).toBe('2020-01-01 00:00:00');
  });

  it('marks POST_GAME as final and never overwrites it afterwards', async () => {
    await gsi(payload('77', IN_PROGRESS, { n: 1 }));
    await gsi(payload('77', POST_GAME, { n: 2 }));
    expect(stored()[0]).toMatchObject({ is_final: 1, game_state: POST_GAME });
    expect((await gsi(payload('77', IN_PROGRESS, { n: 3 }))).status).toBe(200);
    await gsi(payload('77', POST_GAME, { n: 4 }));
    const row = stored()[0]!;
    expect(JSON.parse(row.state_json as string).n).toBe(2);
    expect(row.is_final).toBe(1);
  });

  it.each([[undefined], ['0'], [0], ['abc'], ['-5'], ['1.5'], [''], [null], ['12345678901234567890123']])(
    'answers 200 without storing when matchid is %j',
    async (matchid) => {
      const res = await gsi(payload(matchid, IN_PROGRESS));
      expect(res.status).toBe(200);
      expect(stored()).toHaveLength(0);
    },
  );

  it('answers 200 without storing when there is no map block, but still records the heartbeat', async () => {
    expect((await gsi({ auth: { token }, provider: { name: 'Dota 2' } })).status).toBe(200);
    expect(stored()).toHaveLength(0);
    expect(t.repo.listObserverTokens()[0]!.lastSeenAt).toBeTruthy();
  });

  it('touches the observer last seen time', async () => {
    expect(t.repo.listObserverTokens()[0]!.lastSeenAt).toBeNull();
    await gsi(payload('5', IN_PROGRESS));
    expect(t.repo.listObserverTokens()[0]!.lastSeenAt).toBeTruthy();
  });

  it('keeps the capture when the observer token is deleted', async () => {
    await gsi(payload('5', IN_PROGRESS));
    t.db.prepare('DELETE FROM observer_tokens').run();
    expect(stored()[0]).toMatchObject({ dota_match_id: 5, observer_token_id: null });
  });
});
