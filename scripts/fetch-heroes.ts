// Downloads every hero portrait into public/heroes so production never hotlinks Valve's CDN.
// Usage: npm run fetch:heroes [-- --force]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HEROES } from '../src/data/heroes.js';

const CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/';
const OUT = fileURLToPath(new URL('../public/heroes/', import.meta.url));
const force = process.argv.includes('--force');

mkdirSync(OUT, { recursive: true });

let downloaded = 0;
const failed: string[] = [];
for (const hero of HEROES) {
  const file = `${OUT}${hero.slug}.png`;
  if (!force && existsSync(file)) continue;
  try {
    const res = await fetch(`${CDN}${hero.slug}.png`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    downloaded += 1;
  } catch (error) {
    failed.push(`${hero.slug} (${(error as Error).message})`);
  }
}
console.log(`Downloaded ${downloaded} portraits, ${failed.length} failed.`);
if (failed.length > 0) {
  console.error(failed.join('\n'));
  process.exit(1);
}
