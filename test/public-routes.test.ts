import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Tournament } from '../src/db/repository.js';
import { regenerateFixture } from '../src/services/fixture.js';
import { makeApp, type TestApp } from './helpers/app.js';

import { readFileSync } from 'node:fs';

const siteCss = readFileSync(new URL('../public/site.css', import.meta.url), 'utf8');

let t: TestApp;
let tournament: Tournament;

beforeEach(async () => {
  t = await makeApp();
  tournament = t.repo.createTournament({ name: 'Torneo Oct', slug: 'torneo-oct' });
  t.repo.setActiveTournament(tournament.id);
  for (const [code, hero] of [['A', 'axe'], ['B', null], ['C', 'lina'], ['D', null]] as const) {
    t.repo.createTeam(tournament.id, { code, name: `Equipo ${code}`, captain: code === 'A' ? 'Kelvin' : null, hero });
  }
  t.repo.replaceScheduleDays(tournament.id, [
    { date: '2026-10-03', phase: 'group', startTimes: ['14:00', '15:00', '16:00'], slotMinutes: 60 },
    { date: '2026-10-11', phase: 'semifinal', startTimes: ['14:00', '15:00'], slotMinutes: 60 },
    { date: '2026-10-17', phase: 'final', startTimes: ['14:00'], slotMinutes: 60 },
  ]);
  regenerateFixture(t.repo, tournament);
});
afterEach(() => t.db.close());

const html = async (path: string) => (await t.get(path)).text();

const win = (index: number, kills = 20) => {
  const match = t.repo.listMatches(tournament.id, 'group')[index]!;
  t.repo.recordResult(match.id, { winnerId: match.team1Id!, team1Kills: kills, team1Deaths: 10, team2Kills: 10, team2Deaths: kills });
};

describe('site root', () => {
  it('shows a "Próximamente" page when no tournament is active', async () => {
    t.db.prepare('UPDATE tournaments SET is_active = 0').run();
    const res = await t.get('/');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Próximamente');
    expect(body).toContain('Dota 2 es una marca de Valve Corporation');
    expect(body).toContain('data-events="/events"');
  });

  it('renders the active tournament with the four tabs, in Spanish', async () => {
    const res = await t.get('/');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<title>Torneo Oct</title>');
    expect(body).toContain('<h1>Torneo Oct</h1>');
    for (const label of ['Partidos', 'Posiciones', 'Playoffs', 'Reglas']) expect(body).toContain(`>${label}</button>`);
    for (const key of ['partidos', 'posiciones', 'playoffs', 'reglas']) expect(body).toContain(`data-tab="${key}"`);
    expect(body).toContain('data-partial="/partial"');
    expect(body).toContain('Dota 2 es una marca de Valve Corporation');
    expect(body).toMatch(/href="\/assets\/site\.css\?v=[0-9a-f]{10}"/);
  });

  it('follows the active tournament', async () => {
    const other = t.repo.createTournament({ name: 'Copa Nov', slug: 'copa-nov' });
    t.repo.setActiveTournament(other.id);
    expect(await html('/')).toContain('<h1>Copa Nov</h1>');
  });
});

describe('archive route', () => {
  it('serves any tournament by slug, active or not', async () => {
    t.repo.createTournament({ name: 'Copa Nov', slug: 'copa-nov' });
    const res = await t.get('/t/copa-nov');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<h1>Copa Nov</h1>');
    expect(body).toContain('data-events="/t/copa-nov/events"');
    expect(body).toContain('data-partial="/t/copa-nov/partial"');
  });

  it('answers 404 in Spanish for an unknown slug, without live links', async () => {
    const res = await t.get('/t/nope');
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain('Torneo no encontrado');
    expect(body).not.toContain('data-events');
    expect((await t.get('/t/nope/partial')).status).toBe(404);
  });
});

describe('framing and caching', () => {
  const PUBLIC_PATHS = ['/', '/t/torneo-oct', '/partial', '/t/torneo-oct/partial', '/t/nope'];

  it('lets Google Sites embed the public pages', async () => {
    for (const path of PUBLIC_PATHS) {
      const res = await t.get(path);
      expect(res.headers.get('x-frame-options')).toBeNull();
      expect(res.headers.get('content-security-policy')).toBeNull();
    }
  });

  it('marks HTML as no-cache', async () => {
    for (const path of PUBLIC_PATHS) expect((await t.get(path)).headers.get('cache-control')).toBe('no-cache');
  });

  it('keeps the backoffice unframeable next to the public site', async () => {
    expect((await t.get('/admin/login')).headers.get('x-frame-options')).toBe('DENY');
  });
});

describe('matches tab', () => {
  it('lists days, rounds, the bye team, the next round and a filter chip per team', async () => {
    t.repo.createTeam(tournament.id, { code: 'E', name: 'Equipo E' });
    t.repo.replaceScheduleDays(tournament.id, [
      { date: '2026-10-03', phase: 'group', startTimes: ['14:00', '15:00', '16:00', '17:00', '18:00'], slotMinutes: 60 },
    ]);
    regenerateFixture(t.repo, tournament);
    const body = await html('/');
    expect(body).toMatch(/sábado,? 0?3 de octubre/);
    expect(body).toContain('Ronda 1');
    expect(body).toContain('Siguiente');
    expect(body).toContain('Descansa');
    expect(body).toContain('14:00 – 15:00');
    expect(body).toContain('Partido 1');
    expect(body).toContain('data-filter=""');
    for (const team of t.repo.listTeams(tournament.id)) expect(body).toContain(`data-filter="${team.id}"`);
    expect(body).toContain('/assets/heroes/axe.png');
    expect(body).toContain('Cap. Kelvin');
  });

  it('shows the 1–0 result with the Victoria tag and K/D', async () => {
    win(0, 32);
    const body = await html('/');
    expect(body).toContain('Victoria</span>');
    expect(body).toContain('K 32 · D 10');
    expect(body).toContain('K 10 · D 32');
    expect(body).toMatch(/<span class="w">1<\/span><i>–<\/i><span class="l">0<\/span>/);
  });

  it('escapes team names', async () => {
    t.repo.updateTeam(t.repo.listTeams(tournament.id)[0]!.id, { name: '<script>alert(1)</script>' });
    const body = await html('/');
    expect(body).not.toContain('<script>alert(1)</script>');
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('standings tab', () => {
  it('renders the table headers, points and the gold cut line', async () => {
    win(0);
    const body = await html('/');
    for (const head of ['PJ', 'Pts', 'K−D']) expect(body).toContain(`<th>${head}</th>`);
    for (const head of ['G', 'P', 'Kills', 'Deaths', 'Últimos']) expect(body).toContain(`<th class="opt">${head}</th>`);
    expect(body).toContain('1 de 6 partidos jugados');
    expect(body).toContain('class="q cut"');
    expect(body).toContain('+10');
    expect(body).toContain('<i class="W">G</i>');
    expect(body).toContain('<b>Victoria</b> 1 pt · <b>Derrota</b> 0 pts');
    expect(body).toContain('<b>Desempate:</b> K−D, luego kills');
    expect(body).not.toContain('Clasificado');
  });

  it('marks qualified and eliminated teams once every group match is played', async () => {
    t.repo.updateTournament(tournament.id, { qualifiers: 2 });
    for (let i = 0; i < 6; i++) win(i, 20 + i);
    const body = await html('/');
    expect(body).toContain('Clasificado');
    expect(body).toContain('Eliminado');
  });
});

describe('playoffs and rules tabs', () => {
  it('shows the projection note while groups are open', async () => {
    win(0);
    const body = await html('/');
    expect(body).toContain('Proyección con la tabla actual · faltan 5 partidos de fase de grupos');
    expect(body).toContain('Semifinal 1');
    expect(body).toContain('Gran final');
    expect(body).toContain('Ganador SF1');
    expect(body).toContain('Por definir');
  });

  it('renders the summary strip, tiebreakers and the rulebook safely', async () => {
    t.repo.updateTournament(tournament.id, { rulesText: '## Generales\n- Cinco jugadores\n- <b>x</b>\n\nTexto libre' });
    const body = await html('/');
    expect(body).toContain('<small>Victoria</small><b>1 pt</b>');
    expect(body).toContain('Top 4');
    expect(body).toContain('1.º vs 4.º · 2.º vs 3.º');
    expect(body).toContain('Diferencia de kills y deaths (K − D)');
    expect(body).toContain('<h3>Generales</h3>');
    expect(body).toContain('<li>Cinco jugadores</li>');
    expect(body).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(body).not.toContain('<li><b>x</b></li>');
  });
});

describe('times for visitors in any zone', () => {
  it('ships UTC instants in data attributes and a server-side fallback in the tournament zone', async () => {
    const body = await html('/');
    expect(body).toContain('data-start="2026-10-03T19:00:00Z"');
    expect(body).toContain('data-end="2026-10-03T20:00:00Z"');
    expect(body).toContain('14:00 – 15:00');
    expect(body).toContain('data-tz-note');
    expect(body).toContain('Horarios en hora de America/Lima');
    expect(body).toMatch(/src="\/assets\/site-core\.js\?v=[0-9a-f]{10}"/);
  });

  it('lists the bracket instants for the browser to localize', async () => {
    const body = await html('/');
    expect(body).toContain('data-start="2026-10-11T19:00:00Z" data-format="short"');
  });

  it('tags the round in progress "En juego" using the configured clock', async () => {
    const live = await makeApp({ now: () => new Date('2026-10-03T19:30:00Z') });
    const cup = live.repo.createTournament({ name: 'Cup', slug: 'cup' });
    live.repo.setActiveTournament(cup.id);
    for (const c of ['A', 'B']) live.repo.createTeam(cup.id, { code: c, name: c });
    live.repo.replaceScheduleDays(cup.id, [{ date: '2026-10-03', phase: 'group', startTimes: ['14:00'], slotMinutes: 60 }]);
    regenerateFixture(live.repo, cup);
    const body = await (await live.get('/')).text();
    expect(body).toContain('En juego');
    expect(body).toContain('is-live');
    live.db.close();
  });
});

describe('live stream tab', () => {
  const tabKeys = (body: string) => [...body.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]);

  it('puts "En vivo" second, right after Partidos, with the hash #envivo', async () => {
    const body = await html('/');
    expect(tabKeys(body)).toEqual(['partidos', 'envivo', 'posiciones', 'playoffs', 'reglas']);
    expect(body).toContain('data-panel="envivo"');
  });

  it('shows a themed placeholder and no red dot while no stream is set', async () => {
    const body = await html('/');
    expect(body).toContain('Transmisión no disponible');
    expect(body).toContain('Cuando haya transmisión en vivo aparecerá aquí.');
    expect(body).not.toContain('<iframe');
    expect(body).not.toContain('tab-dot');
  });

  it('embeds a Kick channel in a responsive player with an open link and a red dot on the tab', async () => {
    t.repo.updateTournament(tournament.id, { streamUrl: 'https://kick.com/mychannel' });
    const body = await html('/');
    expect(body).toContain('<iframe src="https://player.kick.com/mychannel"');
    expect(body).toContain('allow="autoplay; fullscreen; picture-in-picture"');
    expect(body).toMatch(/<iframe[^>]* allowfullscreen/);
    expect(body).toContain('data-stream-frame');
    expect(body).toContain('data-embed="https://player.kick.com/mychannel"');
    expect(body).toMatch(/ábrela en <a href="https:\/\/kick\.com\/mychannel" target="_blank" rel="noopener">Kick<\/a>\./);
    expect(body).toMatch(/data-tab="envivo">\s*En vivo\s*<span class="tab-dot"/);
    expect(body).not.toContain('Transmisión no disponible');
  });

  it('tells visitors what to do when the player is blocked, only when there is a stream', async () => {
    const placeholder = await html('/');
    expect(placeholder).not.toContain('¿No ves la transmisión?');
    t.repo.updateTournament(tournament.id, { streamUrl: 'https://www.twitch.tv/some_channel' });
    const body = await html('/');
    expect(body).toMatch(
      /<span class="stream-hint">¿No ves la transmisión\? Desactiva tu bloqueador de anuncios o ábrela en <a href="https:\/\/www\.twitch\.tv\/some_channel" target="_blank" rel="noopener">Twitch<\/a>\.<\/span>/,
    );
    // One link to the channel, not two: the hint replaces the separate "Abrir en" link.
    expect(body.match(/href="https:\/\/www\.twitch\.tv\/some_channel"/g)).toHaveLength(1);
    expect(body).not.toContain('Abrir en Twitch');
    expect(siteCss).toMatch(/\.stream-hint \{[^}]*color: var\(--muted\)/);
  });

  it('gives Twitch the serving host and Google Sites as parents', async () => {
    t.repo.updateTournament(tournament.id, { streamUrl: 'https://www.twitch.tv/some_channel' });
    const body = await html('/');
    expect(body).toContain('src="https://player.twitch.tv/?channel=some_channel&amp;parent=localhost&amp;parent=sites.google.com&amp;muted=true"');
    expect(body).toContain('>Twitch</a>.');
  });

  it('honours STREAM_PARENT_HOSTS', async () => {
    const custom = await makeApp({ streamParentHosts: ['torneo.example.com', 'abc.googleusercontent.com'] });
    const cup = custom.repo.createTournament({ name: 'Cup', slug: 'cup' });
    custom.repo.setActiveTournament(cup.id);
    custom.repo.updateTournament(cup.id, { streamUrl: 'twitch.tv/some_channel' });
    const body = await (await custom.get('/')).text();
    expect(body).toContain('parent=torneo.example.com&amp;parent=abc.googleusercontent.com&amp;muted=true');
    custom.db.close();
  });

  it('never renders the raw stored URL or anything unvalidated', async () => {
    t.db.prepare("UPDATE tournaments SET stream_url = 'javascript:alert(1)' WHERE id = ?").run(tournament.id);
    let body = await html('/');
    expect(body).not.toContain('javascript:');
    expect(body).not.toContain('<iframe');
    expect(body).toContain('Transmisión no disponible');
    t.repo.updateTournament(tournament.id, { streamUrl: 'https://kick.com/mychannel?x="><script>alert(1)</script>' });
    body = await html('/');
    expect(body).not.toContain('<script>alert(1)');
    expect(body).toContain('src="https://player.kick.com/mychannel"');
  });

  it('is part of the live fragment, and public pages stay frameable with a player on them', async () => {
    t.repo.updateTournament(tournament.id, { streamUrl: 'https://youtu.be/dQw4w9WgXcQ' });
    const res = await t.get('/partial');
    expect(await res.text()).toContain('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    const page = await t.get('/');
    expect(page.headers.get('content-security-policy')).toBeNull();
    expect(page.headers.get('x-frame-options')).toBeNull();
  });
});

describe('server clock for the browser', () => {
  it('sends the server time in the page and in the live fragment, from the injected clock', async () => {
    const fixed = await makeApp({ now: () => new Date('2026-10-03T19:30:00.000Z') });
    const cup = fixed.repo.createTournament({ name: 'Cup', slug: 'cup' });
    fixed.repo.setActiveTournament(cup.id);
    for (const path of ['/', '/partial', '/t/cup', '/t/cup/partial']) {
      expect(await (await fixed.get(path)).text()).toMatch(/<span hidden(="")? data-server-now="2026-10-03T19:30:00\.000Z"><\/span>/);
    }
    fixed.db.close();
  });
});

describe('partial', () => {
  it('returns the content fragment without a document shell', async () => {
    const body = await html('/t/torneo-oct/partial');
    expect(body).toContain('<h1>Torneo Oct</h1>');
    expect(body).toContain('class="tabs-bar"');
    expect(body).not.toContain('<html');
    expect(body).not.toContain('<footer');
  });

  it('follows the active tournament at the root, and falls back to "Próximamente"', async () => {
    expect(await html('/partial')).toContain('<h1>Torneo Oct</h1>');
    t.db.prepare('UPDATE tournaments SET is_active = 0').run();
    expect(await html('/partial')).toContain('Próximamente');
  });
});

describe('static assets', () => {
  it('serves the self-hosted portraits with a day of caching (their URLs are not fingerprinted)', async () => {
    const res = await t.get('/assets/heroes/axe.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
  });
});
