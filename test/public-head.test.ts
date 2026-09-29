import { afterEach, describe, expect, it } from 'vitest';
import { configFromEnv } from '../src/config.js';
import { regenerateFixture } from '../src/services/fixture.js';
import { makeApp, type TestApp } from './helpers/app.js';

const apps: TestApp[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.db.close();
});

async function app(config: Parameters<typeof makeApp>[0] = {}, withTournament = true): Promise<TestApp> {
  const t = await makeApp(config);
  apps.push(t);
  if (withTournament) {
    const cup = t.repo.createTournament({ name: 'Copa Octubre', slug: 'copa' });
    t.repo.setActiveTournament(cup.id);
    for (const [i, name] of ['Tigres', 'Lobos'].entries()) t.repo.createTeam(cup.id, { code: `T${i}`, name });
    t.repo.replaceScheduleDays(cup.id, [{ date: '2026-10-03', phase: 'group', startTimes: ['14:00'], slotMinutes: 60 }]);
    regenerateFixture(t.repo, cup);
  }
  return t;
}

const head = (html: string) => html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
const meta = (h: string, attr: 'name' | 'property', key: string) =>
  new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`).exec(h)?.[1];
const link = (h: string, rel: string) => new RegExp(`<link rel="${rel}"[^>]*href="([^"]*)"`).exec(h)?.[1];

describe('share tags on public pages', () => {
  it('carries the title, description, Open Graph and Twitter tags', async () => {
    const t = await app();
    const h = head(await (await t.get('/')).text());
    const title = /<title>([^<]*)<\/title>/.exec(h)![1]!;
    expect(title).toBe('Copa Octubre · Torneo de Dota 2');
    expect(title).not.toMatch(/\n/);
    const description = 'Fase de grupos · 0/1 partidos · Empieza el 03 Oct';
    expect(meta(h, 'name', 'description')).toBe(description);

    expect(meta(h, 'property', 'og:type')).toBe('website');
    expect(meta(h, 'property', 'og:site_name')).toBe('torneo-dota · jpsolutions');
    expect(meta(h, 'property', 'og:locale')).toBe('es_ES');
    expect(meta(h, 'property', 'og:title')).toBe(title);
    expect(meta(h, 'property', 'og:description')).toBe(description);
    expect(meta(h, 'property', 'og:url')).toBe('http://localhost/');
    expect(meta(h, 'property', 'og:image')).toMatch(/^http:\/\/localhost\/assets\/img\/og\.jpg\?v=[0-9a-f]{10}$/);
    expect(meta(h, 'property', 'og:image:width')).toBe('1200');
    expect(meta(h, 'property', 'og:image:height')).toBe('630');
    expect(meta(h, 'property', 'og:image:type')).toBe('image/jpeg');
    expect(meta(h, 'property', 'og:image:alt')).toContain('Dota 2');

    expect(meta(h, 'name', 'twitter:card')).toBe('summary_large_image');
    expect(meta(h, 'name', 'twitter:title')).toBe(title);
    expect(meta(h, 'name', 'twitter:description')).toBe(description);
    expect(meta(h, 'name', 'twitter:image')).toBe(meta(h, 'property', 'og:image'));

    expect(link(h, 'canonical')).toBe('http://localhost/');
    expect(link(h, 'apple-touch-icon')).toMatch(/^\/assets\/img\/apple-touch-icon\.png\?v=[0-9a-f]{10}$/);
    expect(h).not.toContain('noindex');
  });

  it('uses the archive URL for a tournament page, and ignores the query string', async () => {
    const t = await app();
    const h = head(await (await t.get('/t/copa?utm_source=x')).text());
    expect(meta(h, 'property', 'og:url')).toBe('http://localhost/t/copa');
    expect(link(h, 'canonical')).toBe('http://localhost/t/copa');
  });

  it('describes the "Próximamente" page', async () => {
    const t = await app({}, false);
    const h = head(await (await t.get('/')).text());
    expect(/<title>([^<]*)<\/title>/.exec(h)![1]).toBe('Torneos de Dota 2 · jpsolutions');
    expect(meta(h, 'name', 'description')).toBe('Próximamente: fixture, tabla en vivo y playoffs');
    expect(meta(h, 'property', 'og:image')).toContain('/assets/img/og.jpg?v=');
  });

  it('gives the 404 page tags too, but asks not to be indexed', async () => {
    const t = await app();
    const res = await t.get('/t/nope');
    expect(res.status).toBe(404);
    const h = head(await res.text());
    expect(/<title>([^<]*)<\/title>/.exec(h)![1]).toContain('Torneo no encontrado');
    expect(meta(h, 'property', 'og:title')).toContain('Torneo no encontrado');
    expect(meta(h, 'property', 'og:url')).toBe('http://localhost/t/nope');
    expect(meta(h, 'name', 'robots')).toBe('noindex');
  });

  it('shows the live state to crawlers (no JavaScript needed)', async () => {
    const t = await app({ now: () => new Date('2026-10-03T19:30:00Z') });
    t.repo.updateTournament(t.repo.getActiveTournament()!.id, { streamUrl: 'https://kick.com/mychannel' });
    const h = head(await (await t.get('/', undefined)).text());
    expect(meta(h, 'property', 'og:title')).toBe('🔴 EN VIVO · Copa Octubre · Torneo de Dota 2');
    expect(meta(h, 'property', 'og:description')).toBe('Ronda 1 en juego · Míralo en vivo en Kick');
    const bot = await t.send('GET', '/', { headers: { 'user-agent': 'WhatsApp/2.23 A' } });
    expect(head(await bot.text())).toContain('EN VIVO');
  });

  it('escapes everything it prints', async () => {
    const t = await app();
    t.repo.updateTournament(t.repo.getActiveTournament()!.id, { name: 'Copa "><script>alert(1)</script>' });
    const html = await (await t.get('/')).text();
    const h = head(html);
    expect(h).not.toContain('<script>alert(1)');
    expect(h).toContain('&quot;&gt;&lt;script&gt;');
    expect(html.slice(0, html.indexOf('</head>'))).not.toContain('"><script>');
  });
});

describe('absolute URLs', () => {
  it('prefers PUBLIC_BASE_URL (trailing slash tolerated)', async () => {
    const t = await app({ publicBaseUrl: 'https://torneo-dota.jpsolutions.app' });
    const h = head(await (await t.get('/t/copa')).text());
    expect(meta(h, 'property', 'og:url')).toBe('https://torneo-dota.jpsolutions.app/t/copa');
    expect(meta(h, 'property', 'og:image')).toMatch(/^https:\/\/torneo-dota\.jpsolutions\.app\/assets\/img\/og\.jpg\?v=/);
    expect(link(h, 'canonical')).toBe('https://torneo-dota.jpsolutions.app/t/copa');
  });

  it('falls back to the request origin, honouring the proxy headers only when trusted', async () => {
    const proxied = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'torneo.example.com' };
    const trusted = await app({ trustProxy: true });
    const a = head(await (await trusted.send('GET', '/', { headers: proxied })).text());
    expect(meta(a, 'property', 'og:url')).toBe('https://torneo.example.com/');
    const untrusted = await app({ trustProxy: false });
    const b = head(await (await untrusted.send('GET', '/', { headers: proxied })).text());
    expect(meta(b, 'property', 'og:url')).toBe('http://localhost/');
  });

  it('reads PUBLIC_BASE_URL from the environment and ignores anything that is not an http(s) URL', () => {
    expect(configFromEnv({ PUBLIC_BASE_URL: 'https://x.example/' }).publicBaseUrl).toBe('https://x.example');
    for (const bad of ['', 'not a url', 'javascript:alert(1)', 'ftp://x.example']) {
      expect(configFromEnv({ PUBLIC_BASE_URL: bad }).publicBaseUrl).toBeUndefined();
    }
    expect(configFromEnv({}).publicBaseUrl).toBeUndefined();
  });
});

describe('the backoffice stays out of search and previews', () => {
  it('marks admin pages noindex and adds no Open Graph tags', async () => {
    const t = await app();
    const cookie = await t.login();
    for (const path of ['/admin/login', '/admin/torneos']) {
      const res = await t.get(path, cookie);
      const h = head(await res.text());
      expect(meta(h, 'name', 'robots')).toBe('noindex, nofollow');
      expect(h).not.toContain('og:title');
      expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    }
  });
});

describe('what crawlers fetch', () => {
  it('serves robots.txt: public pages allowed, /admin disallowed', async () => {
    const t = await app();
    const res = await t.get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('User-agent: *');
    expect(body).toContain('Disallow: /admin');
    expect(body).not.toMatch(/Disallow: \/\s*$/m);
  });

  it('serves the share image as a 1200x630 JPEG without cookies, cached for a year when versioned', async () => {
    const t = await app();
    const h = head(await (await t.get('/')).text());
    const path = new URL(meta(h, 'property', 'og:image')!).pathname + new URL(meta(h, 'property', 'og:image')!).search;
    const res = await t.get(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('set-cookie')).toBeNull();
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeLessThanOrEqual(300 * 1024);
    // JPEG start-of-frame marker carries the size.
    let width = 0;
    let height = 0;
    for (let i = 2; i < bytes.length - 9; i++) {
      if (bytes[i] === 0xff && bytes[i + 1] !== undefined && [0xc0, 0xc1, 0xc2].includes(bytes[i + 1]!)) {
        height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
        width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
        break;
      }
    }
    expect([width, height]).toEqual([1200, 630]);
  });

  it('serves the iOS icon as a PNG', async () => {
    const t = await app();
    const res = await t.get('/assets/img/apple-touch-icon.png');
    expect(res.headers.get('content-type')).toBe('image/png');
  });
});
