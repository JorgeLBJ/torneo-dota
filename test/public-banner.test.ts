import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Banner, NewBanner, Tournament } from '../src/db/repository.js';
import { makeApp, type TestApp } from './helpers/app.js';
import { MemoryImageStore } from './helpers/memory-store.js';

const NOW = new Date('2026-10-17T12:00:00Z');

let t: TestApp;
let tournament: Tournament;
let now = NOW;

beforeEach(async () => {
  now = NOW;
  t = await makeApp({ imageStore: new MemoryImageStore(), now: () => now });
  tournament = t.repo.createTournament({ name: 'Torneo Oct', slug: 'torneo-oct' });
  t.repo.setActiveTournament(tournament.id);
});
afterEach(() => t.db.close());

const banner = (over: Partial<NewBanner> = {}, tid = tournament.id): Banner =>
  t.repo.createBanner(tid, {
    name: 'Grand Final',
    altText: 'Grand Final BO5: EgoBoys vs "Butterfly" Effect',
    imageKey: 'banners/1/abc.webp',
    imageWidth: 1920,
    imageHeight: 1080,
    imageKeySmall: 'banners/1/abc-1280.webp',
    imageWidthSmall: 1280,
    ctaText: 'Ver playoffs',
    ctaTab: 'playoffs',
    active: true,
    startsAt: '2026-10-16T23:00:00Z',
    endsAt: '2026-10-18T05:00:00Z',
    ...over,
  });

const page = async (path = '/') => (await t.get(path)).text();

describe('welcome dialog assets', () => {
  const css = readFileSync(new URL('../public/site.css', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../public/site.js', import.meta.url), 'utf8');

  it('dims and blurs the backdrop and turns the entrance animation off under reduced motion', () => {
    expect(css).toContain('dialog.promo::backdrop { background: rgba(5,6,10,.82);');
    expect(css).toContain('backdrop-filter: blur(4px)');
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*dialog\.promo\[open\][^}]*animation: none/);
  });

  it('the page script opens it with showModal after load and reuses the page tab handler for the button', () => {
    expect(js).toContain("window.addEventListener('load', openWhenReady)");
    expect(js).toContain('dialog.showModal()');
    expect(js).toContain('tab.click()');
  });

  it('adds no inline script or style to the page (no CSP exists, but the code lives in the asset files)', async () => {
    banner();
    const html = await (await t.get('/')).text();
    const dialog = html.slice(html.indexOf('<dialog id="promoBanner"'), html.indexOf('</dialog>', html.indexOf('id="promoBanner"')));
    expect(dialog).not.toContain('<script');
    expect(dialog).not.toContain('style=');
  });
});

describe('welcome dialog on the public page', () => {
  it('is absent when the tournament has no banner', async () => {
    const html = await page();
    expect(html).not.toContain('promoBanner');
    expect(html).toContain('id="matchDetail"'); // the rest of the page is as before
  });

  it('renders the showing banner as a dialog with a responsive, size-stable picture', async () => {
    const b = banner();
    const html = await page();
    expect(html).toContain('<dialog id="promoBanner"');
    expect(html).toContain(`data-banner-id="${b.id}"`);
    expect(html).toContain(`data-banner-version="${b.version}"`);
    expect(html).toContain('src="https://images.example/banners/1/abc.webp"');
    expect(html).toContain('srcset="https://images.example/banners/1/abc-1280.webp 1280w, https://images.example/banners/1/abc.webp 1920w"');
    expect(html).toContain('sizes="min(1100px, calc(100vw - 32px))"');
    expect(html).toContain('width="1920"');
    expect(html).toContain('height="1080"');
    expect(html).toContain('alt="Grand Final BO5: EgoBoys vs &quot;Butterfly&quot; Effect"');
    expect(html).toMatch(/<button[^>]*aria-label="Cerrar"[^>]*>/);
    expect(html).toContain('data-promo-close');
  });

  it('puts the dialog outside #app, so a live refresh can never touch it', async () => {
    banner();
    const html = await page();
    const footer = html.indexOf('<footer');
    expect(html.indexOf('id="promoBanner"')).toBeGreaterThan(footer);
    expect(await page('/partial')).not.toContain('promoBanner');
  });

  it('renders the button with its text and destination tab', async () => {
    banner();
    const html = await page();
    expect(html).toMatch(/<button[^>]*data-promo-cta[^>]*>Ver playoffs<\/button>/);
    expect(html).toContain('data-cta-tab="playoffs"');
  });

  it('a button without a destination only closes (no data-cta-tab)', async () => {
    banner({ ctaText: 'Entendido', ctaTab: null });
    const html = await page();
    expect(html).toMatch(/data-promo-cta[^>]*>Entendido<\/button>/);
    expect(html).not.toContain('data-cta-tab');
  });

  it('has no button at all when no text is set', async () => {
    banner({ ctaText: null, ctaTab: null });
    expect(await page()).not.toContain('data-promo-cta');
  });

  it('uses a single source when the 1280 variant is as wide as the other (small upload)', async () => {
    banner({ imageWidth: 1000, imageHeight: 500, imageWidthSmall: 1000 });
    const html = await page();
    expect(html).not.toContain('srcset=');
    expect(html).toContain('width="1000"');
  });

  it('does not show a banner before its window, after it, or when inactive', async () => {
    const b = banner();
    now = new Date('2026-10-16T22:59:59Z');
    expect(await page()).not.toContain('promoBanner');
    now = new Date('2026-10-18T05:00:00Z'); // the end instant is already over
    expect(await page()).not.toContain('promoBanner');
    now = NOW;
    expect(await page()).toContain('promoBanner');
    t.repo.setBannerActive(b.id, false);
    expect(await page()).not.toContain('promoBanner');
  });

  it('shows a banner with no dates while it is active', async () => {
    banner({ startsAt: null, endsAt: null });
    expect(await page()).toContain('promoBanner');
  });

  it('each tournament page shows only its own banner', async () => {
    const other = t.repo.createTournament({ name: 'Otro', slug: 'otro' });
    banner({ altText: 'Solo del otro', imageKey: 'banners/9/x.webp', imageKeySmall: 'banners/9/x-1280.webp' }, other.id);
    expect(await page()).not.toContain('promoBanner');
    expect(await page('/t/otro')).toContain('Solo del otro');
    expect(await page('/t/torneo-oct')).not.toContain('promoBanner');
  });

  it('is skipped when the server has no image store', async () => {
    const bare = await makeApp({ now: () => NOW });
    const tn = bare.repo.createTournament({ name: 'X', slug: 'x' });
    bare.repo.setActiveTournament(tn.id);
    bare.repo.createBanner(tn.id, {
      name: 'B',
      altText: 'a',
      imageKey: 'k.webp',
      imageWidth: 10,
      imageHeight: 10,
      imageKeySmall: 'k2.webp',
      imageWidthSmall: 10,
      ctaText: null,
      ctaTab: null,
      active: true,
      startsAt: null,
      endsAt: null,
    });
    expect(await (await bare.get('/')).text()).not.toContain('promoBanner');
    bare.db.close();
  });

  it('keeps the "Próximamente" and 404 pages untouched', async () => {
    banner();
    t.db.prepare('UPDATE tournaments SET is_active = 0').run();
    expect(await page()).not.toContain('promoBanner');
    expect(await page('/t/nope')).not.toContain('promoBanner');
  });
});
