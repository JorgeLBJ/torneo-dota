// Renders the share-preview image (1200x630 JPEG) and the iOS icon (180x180 PNG) with Chromium.
// Usage: npm run render:og   (needs Chrome installed, or CHROME_PATH=/path/to/chrome; fonts come from Google Fonts)
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const IMG_DIR = fileURLToPath(new URL('../public/img/', import.meta.url));
// Inlined as a data URL: a page set from a string cannot load file:// images.
const HERO_BG = `data:image/jpeg;base64,${readFileSync(`${IMG_DIR}hero-bg.jpg`).toString('base64')}`;
const MAX_JPEG_BYTES = 300 * 1024;

const FONTS =
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Barlow+Condensed:wght@500;600;700&display=swap';

const SHIELD = `<svg viewBox="0 0 64 76" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0dcaa"/><stop offset="1" stop-color="#8a6d3b"/></linearGradient></defs>
  <path d="M32 2 60 12v22c0 18-12 32-28 40C16 66 4 52 4 34V12Z" fill="none" stroke="url(#g)" stroke-width="3"/>
  <path d="M32 14 48 20v14c0 11-7 20-16 25-9-5-16-14-16-25V20Z" fill="url(#g)" opacity=".85"/></svg>`;

// Same design as section 1 of odd/mockups/og-mockup.html, in fixed pixels for a 1200x630 canvas.
const OG_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><link rel="stylesheet" href="${FONTS}">
<style>
  :root { --gold: #c8aa6e; --gold-hi: #f0dcaa; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #07080a; }
  .og { position: relative; width: 1200px; height: 630px; isolation: isolate; overflow: hidden; display: grid; place-items: center; text-align: center; }
  .og::before { content: ""; position: absolute; inset: 0; z-index: -2; background: url("${HERO_BG}") center 40% / cover; }
  .og::after { content: ""; position: absolute; inset: 0; z-index: -1;
    background: linear-gradient(90deg, rgba(109,191,75,.22), transparent 35%, transparent 65%, rgba(210,69,47,.26)),
                radial-gradient(60% 70% at 50% 50%, rgba(7,8,10,.55), rgba(7,8,10,.9)); }
  .inner { display: grid; justify-items: center; gap: 19px; }
  svg { width: 108px; height: auto; filter: drop-shadow(0 0 30px rgba(240,220,170,.45)); }
  .kick { font: 600 20px "Barlow Condensed"; letter-spacing: .45em; text-transform: uppercase; color: var(--gold); }
  .title { font: 900 89px/0.95 "Cinzel", serif; letter-spacing: .04em; text-transform: uppercase;
    background: linear-gradient(180deg, #fff 20%, var(--gold-hi) 60%, var(--gold)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .sides { font: 700 23px "Barlow Condensed"; letter-spacing: .35em; }
  .sides .r { color: #6dbf4b; } .sides .d { color: #d2452f; } .sides i { font-style: normal; color: #8c8a86; margin: 0 14px; }
  .brand { position: absolute; bottom: 38px; left: 0; right: 0; font: 600 18px "Barlow Condensed"; letter-spacing: .3em; text-transform: uppercase; color: #bdb7ab; }
  .brand b { color: var(--gold-hi); font-weight: 700; }
  .corner { position: absolute; top: 36px; left: 41px; font: 600 17px "Barlow Condensed"; letter-spacing: .25em; color: #bdb7ab; text-transform: uppercase; }
</style></head><body>
<div class="og"><span class="corner">Dota 2</span>
  <div class="inner">${SHIELD}
    <div class="kick">Torneos · En vivo</div>
    <div class="title">Torneo Dota</div>
    <div class="sides"><span class="r">Radiant</span><i>vs</i><span class="d">Dire</span></div>
  </div>
  <div class="brand">torneo-dota · powered by <b>jpsolutions</b></div>
</div></body></html>`;

const ICON_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; } body { width: 180px; height: 180px; background: #07080a; display: grid; place-items: center; }
  svg { width: 104px; height: auto; filter: drop-shadow(0 0 10px rgba(240,220,170,.35)); }
</style></head><body>${SHIELD}</body></html>`;

mkdirSync(IMG_DIR, { recursive: true });
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' },
);
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(OG_HTML, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => document.fonts.check('900 20px Cinzel') && document.fonts.check('600 20px "Barlow Condensed"'));
  if (!loaded) throw new Error('Cinzel / Barlow Condensed did not load (offline?): refusing to render with fallback fonts');

  let quality = 90;
  let jpeg = await page.screenshot({ type: 'jpeg', quality, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  while (jpeg.length > MAX_JPEG_BYTES && quality > 40) {
    quality -= 5;
    jpeg = await page.screenshot({ type: 'jpeg', quality, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  }
  writeFileSync(`${IMG_DIR}og.jpg`, jpeg);

  await page.setViewportSize({ width: 180, height: 180 });
  await page.setContent(ICON_HTML);
  writeFileSync(`${IMG_DIR}apple-touch-icon.png`, await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 180, height: 180 } }));

  console.log(`og.jpg: 1200x630, quality ${quality}, ${(statSync(`${IMG_DIR}og.jpg`).size / 1024).toFixed(0)} KB`);
  console.log(`apple-touch-icon.png: 180x180, ${(statSync(`${IMG_DIR}apple-touch-icon.png`).size / 1024).toFixed(0)} KB`);
} finally {
  await browser.close();
}
