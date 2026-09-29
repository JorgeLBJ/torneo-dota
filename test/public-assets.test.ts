import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './helpers/app.js';

let t: TestApp;
beforeEach(async () => {
  t = await makeApp();
});
afterEach(() => t.db.close());

describe('public site assets', () => {
  it('serves the stylesheet, the script and the self-hosted hero background', async () => {
    const css = await (await t.get('/assets/site.css')).text();
    expect(css).toContain('url("img/hero-bg.jpg")');
    expect(css).not.toContain('steamstatic');
    expect(css).toContain('html[data-live="on"] .live');
    expect(css).toContain('@media (max-width: 480px)');
    const js = await t.get('/assets/site.js');
    expect(js.status).toBe(200);
    const bg = await t.get('/assets/img/hero-bg.jpg');
    expect(bg.status).toBe(200);
    expect(Number(bg.headers.get('content-length') ?? (await bg.arrayBuffer()).byteLength)).toBeLessThan(400 * 1024);
  });

  it('wires the tested live controller to EventSource, fetch and the live pill', async () => {
    const js = await (await t.get('/assets/site.js')).text();
    expect(js).toContain('SiteCore.createLive');
    expect(js).toContain('new EventSource(url)');
    expect(js).toContain("fetch(partialUrl, { cache: 'no-store'");
    expect(js).toContain("setAttribute('data-live'");
    expect(js).toContain('history.replaceState');
    expect(js).toContain('hashchange');
    const core = await (await t.get('/assets/site-core.js')).text();
    expect(core).toContain('function createLive');
  });
});
