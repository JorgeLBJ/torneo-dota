import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Tournament } from '../src/db/repository.js';
import { regenerateFixture } from '../src/services/fixture.js';
import { makeApp, type TestApp } from './helpers/app.js';

const adminCss = readFileSync(new URL('../public/admin.css', import.meta.url), 'utf8');
const siteCss = readFileSync(new URL('../public/site.css', import.meta.url), 'utf8');
const rule = (css: string, selector: string): string => {
  for (const line of css.split('\n')) if (line.startsWith(`${selector}{`)) return line.slice(selector.length + 1, line.lastIndexOf('}'));
  return '';
};

let t: TestApp;
let cookie: string;
let tournament: Tournament;

beforeEach(async () => {
  t = await makeApp();
  cookie = await t.login();
  tournament = t.repo.createTournament({ name: 'Cup', slug: 'cup' });
  t.repo.setActiveTournament(tournament.id);
  for (const code of ['A', 'B', 'C', 'D']) t.repo.createTeam(tournament.id, { code, name: `Team ${code}` });
  t.repo.replaceScheduleDays(tournament.id, [
    { date: '2026-10-03', phase: 'group', startTimes: ['14:00', '15:00', '16:00'], slotMinutes: 60 },
  ]);
  regenerateFixture(t.repo, tournament);
});
afterEach(() => t.db.close());

const admin = async (path: string) => (await t.get(`/admin/t/${tournament.id}/${path}`, cookie)).text();

describe('phone tables', () => {
  it('public standings mark G, P, Kills, Deaths and Últimos as optional columns', async () => {
    const html = await (await t.get('/')).text();
    const table = html.slice(html.indexOf('<thead>'), html.indexOf('</table>'));
    expect(table.match(/<th class="opt">/g)).toHaveLength(5);
    expect(table).toContain('<th>Pts</th>');
    expect(table).toContain('<th>K−D</th>');
    expect(siteCss).toMatch(/@media \(max-width: 760px\)[\s\S]*\.opt \{ display: none; \}/);
    expect(siteCss).toMatch(/\.tbl-wrap table \{ min-width: 0; \}/);
  });

  it('the admin live table hides the same columns on phones', async () => {
    const html = await admin('resultados');
    expect(html.match(/<th class="opt">/g)).toHaveLength(4);
    expect(adminCss).toMatch(/\.std \.opt\{display:none\}/);
    expect(adminCss).toMatch(/\.scroll-x table\.std\{min-width:0\}/);
  });

  it('teams, tournaments and users tables turn into labelled cards', async () => {
    const teams = await admin('equipos');
    expect(teams).toContain('<table class="cards teams">');
    for (const label of ['Código', 'Emblema', 'Nombre', 'Capitán']) expect(teams).toContain(`data-label="${label}"`);
    const tournaments = await (await t.get('/admin/torneos', cookie)).text();
    expect(tournaments).toContain('<table class="cards">');
    for (const label of ['Nombre', 'Página pública', 'Equipos', 'Estado']) expect(tournaments).toContain(`data-label="${label}"`);
    const users = await (await t.get('/admin/usuarios', cookie)).text();
    expect(users).toContain('<table class="cards">');
    expect(users).toContain('data-label="Creado"');
    expect(adminCss).toContain('table.cards td[data-label]::before');
  });
});

describe('admin layout fixes', () => {
  it('makes the sidebar buttons the same full-width control', () => {
    expect(rule(adminCss, 'aside .btn')).toContain('width:100%');
  });

  it('aligns both playoff columns to the top', () => {
    expect(rule(adminCss, '.bracket')).toContain('align-items:start');
  });

  it('gives the General card the full width in three columns', async () => {
    const html = await admin('config');
    expect(html).toContain('class="card general-card"');
    expect(html).not.toMatch(/class="card stack narrow"[^>]*>\s*<h2>General/);
    expect(adminCss).toMatch(/@media \(min-width:1024px\)\{[\s\S]*\.general-card\{[^}]*repeat\(3/);
  });

  it('shows the team code once, as an input with a colour accent', async () => {
    const html = await admin('equipos');
    expect(html).not.toContain('class="badge"');
    expect(html).toContain('class="code-input"');
    expect(rule(adminCss, '.code-input')).toContain('border-left:3px solid var(--tc');
  });

  it('navigates when the date changes and keeps "Ver" only for no-JS', async () => {
    const html = await admin('resultados');
    expect(html).toContain('data-autosubmit');
    expect(html).toMatch(/<noscript>\s*<button[^>]*>\s*Ver\s*<\/button>\s*<\/noscript>/);
  });

  it('lays the new-user form out in one row', async () => {
    const html = await (await t.get('/admin/usuarios', cookie)).text();
    expect(html).toContain('class="card row-form"');
    expect(adminCss).toMatch(/@media \(min-width:1024px\)\{[\s\S]*\.row-form\{[^}]*grid-template-columns/);
  });
});

describe('favicon', () => {
  it('serves an SVG shield and answers /favicon.ico without a 404', async () => {
    const svg = await t.get('/favicon.svg');
    expect(svg.status).toBe(200);
    expect(svg.headers.get('content-type')).toContain('image/svg+xml');
    expect(await svg.text()).toContain('<svg');
    expect((await t.get('/favicon.ico')).status).toBe(204);
  });

  it('is linked from the backoffice and the public site', async () => {
    for (const path of ['/admin/login', '/', '/t/nope']) {
      expect(await (await t.get(path)).text()).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml"');
    }
  });
});
