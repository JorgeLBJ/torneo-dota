import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Match, Team, Tournament } from '../src/db/repository.js';
import { buildDoubleElimination, DE_SLOTS, type DeSlotKey } from '../src/domain/double-elimination.js';
import { buildPublicModel } from '../src/public/model.js';
import { buildShare } from '../src/public/share.js';
import { regenerateFixture } from '../src/services/fixture.js';
import { loadState } from '../src/services/state.js';
import { makeApp, type TestApp } from './helpers/app.js';

// Public page of a double elimination tournament (S7): the upper and lower brackets, the grand final and the
// champion; Partidos and Posiciones are hidden and Llaves opens first. League pages keep rendering as before.

let t: TestApp;
let tournament: Tournament;
let teams: Record<string, Team>;

const NOW = new Date('2026-11-07T16:00:00Z');
const current = () => t.repo.getTournamentById(tournament.id)!;
const model = () => buildPublicModel(loadState(t.repo, current()), t.repo.listScheduleDays(tournament.id), { now: NOW });
const stored = (key: DeSlotKey): Match => {
  const slot = DE_SLOTS.find((s) => s.key === key)!;
  return t.repo.listMatches(tournament.id).find((m) => m.phase === slot.phase && m.matchNumber === slot.matchNumber)!;
};

/** What the admin service does after every result: store the teams the results put in each seat. */
const syncSeats = () => {
  const bracket = buildDoubleElimination(t.repo.listMatches(tournament.id).filter((m) => m.phase !== 'group'));
  for (const s of bracket.series) {
    const m = stored(s.key);
    if (m.team1Id !== s.team1Id || m.team2Id !== s.team2Id) t.repo.updateMatchTeams(m.id, s.team1Id, s.team2Id);
  }
};

/** A single game won by `code` (best of 1 series). */
const play = (key: DeSlotKey, code: string) => {
  syncSeats();
  t.repo.recordResult(stored(key).id, { winnerId: teams[code]!.id, team1Kills: 20, team1Deaths: 10, team2Kills: 10, team2Deaths: 20 });
  syncSeats();
};

const game = (key: DeSlotKey, gameNumber: number, code: string, imported = false) => {
  syncSeats();
  t.repo.saveGame(stored(key).id, {
    gameNumber,
    winnerId: teams[code]!.id,
    team1Kills: 20,
    team1Deaths: 10,
    team2Kills: 10,
    team2Deaths: 20,
    ...(imported ? { radiantTeamId: stored(key).team1Id, dotaMatchId: 8000000000 + gameNumber, dotaSnapshot: null } : {}),
  });
  syncSeats();
};

/** U1 A>B, U2 C>D, U3 A>E, U4 F>C, U5 A>F; L1 B>C, L2 D>E, L3 B>D, L4 F>B. */
const playBrackets = () => {
  play('U1', 'A');
  play('U2', 'C');
  play('U3', 'A');
  play('U4', 'F');
  play('U5', 'A');
  play('L1', 'B');
  play('L2', 'D');
  play('L3', 'B');
  play('L4', 'F');
};

const page = async (path = '/') => {
  const res = await t.get(path);
  expect(res.status).toBe(200);
  return res.text();
};

/** The rendered card of one series: from its marker to the next series marker (or the end of the panel). */
const seriesHtml = (html: string, key: DeSlotKey): string => {
  const start = html.indexOf(`data-series="${key}"`);
  expect(start).toBeGreaterThan(-1);
  const next = html.indexOf('data-series=', start + 1);
  const end = next === -1 ? html.indexOf('</section>', start) : next;
  return html.slice(start, end);
};

const panel = (html: string, key: string): string => {
  const start = html.indexOf(`data-panel="${key}"`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</section>', start));
};

beforeEach(async () => {
  t = await makeApp();
  tournament = t.repo.createTournament({ name: 'Relámpago Nov', slug: 'relampago', format: 'double_elimination' });
  t.repo.setActiveTournament(tournament.id);
  teams = Object.fromEntries(
    ['A', 'B', 'C', 'D', 'E', 'F'].map((code) => [code, t.repo.createTeam(tournament.id, { code, name: `Equipo ${code}` })]),
  );
  // Positions A–F as the admin places them: A,B in U1; C,D in U2; E in U3 seat 2; F in U4 seat 1.
  const seats: Partial<Record<DeSlotKey, [string | null, string | null]>> = {
    U1: ['A', 'B'],
    U2: ['C', 'D'],
    U3: [null, 'E'],
    U4: ['F', null],
  };
  for (const s of DE_SLOTS) {
    const [a, b] = seats[s.key] ?? [null, null];
    t.repo.createMatch({
      tournamentId: tournament.id,
      phase: s.phase,
      round: s.round,
      matchNumber: s.matchNumber,
      team1Id: a ? teams[a]!.id : null,
      team2Id: b ? teams[b]!.id : null,
    });
  }
});

afterEach(() => t.db.close());

describe('tabs of a double elimination tournament', () => {
  it('hides Partidos and Posiciones and opens on "Llaves" (tab key kept as playoffs)', async () => {
    const html = await page();
    expect(html).not.toContain('data-tab="partidos"');
    expect(html).not.toContain('data-tab="posiciones"');
    expect(html).toMatch(/aria-selected="true" data-tab="playoffs">Llaves</);
    expect(html).toContain('data-tab="envivo"');
    expect(html).toContain('data-tab="reglas"');
    expect(html).toMatch(/class="panel on" id="p-playoffs"/);
    // Hidden panels stay as empty placeholders so the live refresh keeps patching region by region.
    expect(html).toMatch(/<section class="panel" id="p-partidos" role="tabpanel" data-panel="partidos" hidden=""><\/section>/);
    expect(html).toMatch(/<section class="panel" id="p-posiciones" role="tabpanel" data-panel="posiciones" hidden=""><\/section>/);
  });

  it('never mentions the group stage or semifinals in the hero', async () => {
    const html = await page();
    const hero = html.slice(html.indexOf('class="hero"'), html.indexOf('class="tabs-bar"'));
    expect(hero).not.toMatch(/Fase de grupos|Semifinal/);
    expect(hero).toContain('Llave superior');
    expect(hero).toContain('Llave inferior');
    expect(hero).toContain('Gran final');
    expect(html).toContain('aria-label="Progreso del torneo"');
  });

  it('keeps the league tabs exactly as before', async () => {
    const league = t.repo.createTournament({ name: 'Liga Oct', slug: 'liga-oct' });
    const html = await page(`/t/${league.slug}`);
    expect(html).toMatch(/aria-selected="true" data-tab="partidos">Partidos</);
    expect(html).toContain('data-tab="posiciones">Posiciones<');
    expect(html).toContain('data-tab="playoffs">Playoffs<');
    expect(html).toMatch(/class="panel on" id="p-partidos"/);
    expect(html).not.toContain('hidden=""></section>');
    expect(html).toContain('Fase de grupos');
  });
});

describe('the bracket of a double elimination tournament', () => {
  it('shows the upper and lower brackets and the grand final with placeholders before any result', async () => {
    const html = panel(await page(), 'playoffs');
    expect(html).toContain('Llave superior');
    expect(html).toContain('Llave inferior');
    expect(html).toContain('Final superior');
    expect(html).toContain('Final inferior');
    expect(html.indexOf('data-series="U1"')).toBeLessThan(html.indexOf('data-series="L1"'));
    expect(html.indexOf('data-series="L4"')).toBeLessThan(html.indexOf('data-series="GF"'));
    // Positions are on the cards, every other seat shows where its team comes from.
    expect(seriesHtml(html, 'U1')).toContain('Equipo A');
    expect(seriesHtml(html, 'U1')).toContain('Equipo B');
    expect(seriesHtml(html, 'U3')).toContain('Ganador S1');
    expect(seriesHtml(html, 'U3')).toContain('Equipo E');
    expect(seriesHtml(html, 'U4')).toContain('Ganador S2');
    expect(seriesHtml(html, 'L1')).toContain('Perdedor S1');
    expect(seriesHtml(html, 'L1')).toContain('Perdedor S4');
    expect(seriesHtml(html, 'L4')).toContain('Perdedor S5');
    expect(seriesHtml(html, 'GF')).toContain('Ganador S5');
    expect(seriesHtml(html, 'GF')).toContain('Ganador I4');
    expect(seriesHtml(html, 'GF')).toContain('al mejor de 3');
    expect(seriesHtml(html, 'U1')).not.toContain('al mejor de');
    expect(html).toMatch(/class="aegis "/);
    expect(html).not.toMatch(/Semifinal|Fase de grupos/);
  });

  it('places winners and losers after results and crowns the champion', async () => {
    play('U1', 'A');
    let html = panel(await page(), 'playoffs');
    expect(seriesHtml(html, 'U1')).toMatch(/class="slot win"[\s\S]*Equipo A/);
    expect(seriesHtml(html, 'U3')).toContain('Equipo A');
    expect(seriesHtml(html, 'L1')).toContain('Equipo B');
    expect(seriesHtml(html, 'L1')).toContain('Perdedor S4');

    playBrackets();
    game('GF', 1, 'A');
    game('GF', 2, 'F');
    html = panel(await page(), 'playoffs');
    expect(seriesHtml(html, 'GF')).toContain('Equipo A');
    expect(seriesHtml(html, 'GF')).toContain('Equipo F');
    expect(seriesHtml(html, 'GF')).toContain('aria-label="1 juegos ganados"');
    expect(html).toMatch(/class="aegis "/);

    game('GF', 3, 'A');
    html = panel(await page(), 'playoffs');
    expect(html).toMatch(/class="aegis won"[\s\S]*<b>Equipo A<\/b>/);
    expect(seriesHtml(html, 'GF')).toContain('aria-label="2 juegos ganados"');
  });

  it('keeps the league bracket panel as before', async () => {
    const league = t.repo.createTournament({ name: 'Liga Oct', slug: 'liga-oct' });
    for (const code of ['A', 'B', 'C', 'D', 'E']) t.repo.createTeam(league.id, { code, name: `Liga ${code}` });
    regenerateFixture(t.repo, league);
    const html = panel(await page(`/t/${league.slug}`), 'playoffs');
    expect(html).toContain('<h2>Playoffs</h2>');
    expect(html).toContain('Semifinal 1');
    expect(html).toContain('Gran final');
    expect(html).not.toContain('data-series=');
  });
});

describe('labels of a double elimination series', () => {
  it('names the series in the live list and sends the live notice to Llaves', async () => {
    t.repo.setLive(stored('U1').id, { gameNumber: 1, startedAt: '2026-11-07T15:50:00Z' });
    const m = model();
    expect(m.live[0]!.label).toBe('Superior · Ronda 1 · S1');
    const html = await page();
    expect(html).toMatch(/class="live-notice" href="#playoffs"/);
    expect(panel(html, 'envivo')).toContain('Superior · Ronda 1 · S1');
  });

  it('names the grand final with its game in the live list', () => {
    playBrackets();
    syncSeats();
    t.repo.setLive(stored('GF').id, { gameNumber: 1, startedAt: '2026-11-07T15:50:00Z' });
    expect(model().live[0]!.label).toBe('Gran final · Juego 1 de 3');
  });

  it('names the series in the match detail title', async () => {
    play('U1', 'A');
    play('U2', 'C');
    play('U3', 'A');
    play('U4', 'F');
    game('U5', 1, 'A', true);
    const res = await t.get(`/partido/${stored('U5').id}/detalle`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { title: string }).title).toBe('Final superior · S5');
  });

  it('describes the tournament in the share text without the group stage', () => {
    let share = buildShare(model());
    expect(share.title).toBe('Relámpago Nov · Torneo de Dota 2');
    expect(share.description).not.toMatch(/Fase de grupos|Semis/);
    expect(share.description).toContain('Doble eliminación');
    expect(share.description).toContain('Siguiente: Superior · Ronda 1 · S1: Equipo A vs Equipo B');

    play('U1', 'A');
    share = buildShare(model());
    expect(share.description).toContain('1/10 series');

    playBrackets();
    share = buildShare(model());
    expect(share.title).toBe('Relámpago Nov · Gran final');
    expect(share.description).toBe('Equipo A vs Equipo F');

    game('GF', 1, 'A');
    game('GF', 2, 'A');
    share = buildShare(model());
    expect(share.title).toBe('Relámpago Nov · 🏆 Campeón: Equipo A');
    expect(share.description).toBe('Equipo A venció a Equipo F en la gran final');
  });

  it('says which series is live in the share text', () => {
    t.repo.setLive(stored('U1').id, { gameNumber: 1, startedAt: '2026-11-07T15:50:00Z' });
    const share = buildShare(model());
    expect(share.title).toBe('🔴 EN VIVO · Relámpago Nov · Torneo de Dota 2');
    expect(share.description).toBe('En juego: Equipo A vs Equipo B');
  });
});

describe('league labels stay as before', () => {
  it('keeps the league share text, live label, notice and detail title', async () => {
    const league = t.repo.createTournament({ name: 'Liga Oct', slug: 'liga-oct' });
    const ids = ['A', 'B', 'C', 'D'].map((code) => t.repo.createTeam(league.id, { code, name: `Liga ${code}` }).id);
    regenerateFixture(t.repo, league);
    const first = t.repo.listMatches(league.id, 'group')[0]!;
    t.repo.setLive(first.id, { gameNumber: 1, startedAt: '2026-11-07T15:50:00Z' });
    const leagueModel = buildPublicModel(loadState(t.repo, t.repo.getTournamentById(league.id)!), [], { now: NOW });
    expect(leagueModel.live[0]!.label).toBe(`Ronda ${first.round} · Partido ${first.matchNumber}`);
    expect(buildShare(leagueModel).title).toBe('🔴 EN VIVO · Liga Oct · Torneo de Dota 2');
    const html = await page(`/t/${league.slug}`);
    expect(html).toMatch(/class="live-notice" href="#partidos"/);

    t.repo.setLive(first.id, null);
    t.repo.saveGame(first.id, {
      gameNumber: 1,
      winnerId: first.team1Id!,
      team1Kills: 1,
      team1Deaths: 1,
      team2Kills: 1,
      team2Deaths: 1,
      radiantTeamId: first.team1Id,
      dotaMatchId: 8000000001,
      dotaSnapshot: null,
    });
    const res = await t.get(`/t/${league.slug}/partido/${first.id}/detalle`);
    expect(((await res.json()) as { title: string }).title).toBe(`Partido ${first.matchNumber}`);
    expect(ids).toHaveLength(4);
  });
});
