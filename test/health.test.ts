import { afterEach, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './helpers/app.js';

let t: TestApp;
afterEach(() => t.db.close());

describe('GET /healthz', () => {
  it('answers 200 with a tiny JSON body, no auth and no caching', async () => {
    t = await makeApp();
    const res = await t.get('/healthz');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('works before the first admin exists (setup pending) and is not framed-restricted', async () => {
    t = await makeApp({}, { withAdmin: false });
    expect((await t.get('/healthz')).status).toBe(200);
  });

  it('answers 503 when the database cannot be queried', async () => {
    t = await makeApp();
    t.db.close();
    const res = await t.get('/healthz');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'error' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
