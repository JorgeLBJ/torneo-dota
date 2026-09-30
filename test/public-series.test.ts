import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Match, Team, Tournament } from '../src/db/repository.js';
import { mapOpenDotaMatch } from '../src/dota/opendota.js';
import { buildMatchDetail } from '../src/public/detail.js';
import { buildPublicModel } from '../src/public/model.js';
import { emblemSourcesFor } from '../src/emblem-sources.js';
import { assignSemifinalTeams } from '../src/services/playoffs.js';
import { loadState } from '../src/services/state.js';
import { makeApp, type TestApp } from './helpers/app.js';

const snapshot = mapOpenDotaMatch(JSON.parse(readFileSync(new URL('./fixtures/opendota-9023462170.json', import.meta.url), 'utf8')));

let t: TestApp;
let tournament: Tournament;
let a: Team;
let b: Team;

beforeEach(async () => {
  t = await makeApp();
  tournament = t.repo.createTournament({ name: 'Copa Octubre', slug: 'copa' });
  t.repo.setActiveTournament(tournament.id);
  a = t.repo.createTeam(tournament.id, { code: 'AA', name: 'Alpha', hero: 'axe' });
  b = t.repo.createTeam(tournament.id, { code: 'BB', name: 'Bravo' });
});
afterEach(() => t.db.close());

const setLengths = (over: Record<string, number>) => {
  tournament = t.repo.updateTournament(tournament.id, over);
};
const groupMatch = (n = 1): Match =>
  t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: n, matchNumber: n, team1Id: a.id, team2Id: b.id });
const game = (matchId: number, number: number, winner: Team, extra: Record<string, unknown> = {}) =>
  t.repo.saveGame(matchId, { gameNumber: number, winnerId: winner.id, team1Kills: 20, team1Deaths: 10, team2Kills: 10, team2Deaths: 20, ...extra });
const imported = { radiantTeamId: 0, dotaMatchId: 9023462170, dotaSnapshot: JSON.stringify(snapshot), importedAt: '2026-10-03 15:00:00' };
const model = () => buildPublicModel(loadState(t.repo, tournament), t.repo.listScheduleDays(tournament.id));
const cardOf = (id: number) => model().days.flatMap((d) => d.rounds).flatMap((r) => r.matches).find((m) => m.id === id)!;

describe('public model: series', () => {
  it('a best-of-1 match has no series and no detail', () => {
    const m = groupMatch();
    game(m.id, 1, a);
    expect(cardOf(m.id)).toMatchObject({ series: null, hasDetail: false, played: true, winnerId: a.id });
  });

  it('a best-of-3 match in progress shows the running series and its games', () => {
    setLengths({ groupGames: 3 });
    const m = groupMatch();
    game(m.id, 1, a);
    game(m.id, 2, b);
    expect(cardOf(m.id)).toMatchObject({
      played: false,
      series: { length: 3, wins: [1, 1], decided: false, games: [{ number: 1, winnerId: a.id }, { number: 2, winnerId: b.id }] },
    });
  });

  it('a decided series is played, with the series score and the summed kills and deaths', () => {
    setLengths({ groupGames: 3 });
    const m = groupMatch();
    game(m.id, 1, a);
    game(m.id, 2, a);
    expect(cardOf(m.id)).toMatchObject({ played: true, winnerId: a.id, series: { wins: [2, 0], decided: true }, kills: [40, 20], deaths: [20, 40] });
  });

  it('the detail button needs at least one game with an imported Dota match', () => {
    setLengths({ groupGames: 3 });
    const m = groupMatch();
    game(m.id, 1, a);
    expect(cardOf(m.id).hasDetail).toBe(false);
    game(m.id, 2, a, { ...imported, radiantTeamId: a.id });
    expect(cardOf(m.id).hasDetail).toBe(true);
  });

  it('every tournament page knows where its match details are', () => {
    expect(model().detailBase).toBe('/t/copa/partido');
  });

  it('playoff slots carry the series wins, and the match its detail data', () => {
    const c = t.repo.createTeam(tournament.id, { code: 'CC', name: 'Charlie' });
    const d = t.repo.createTeam(tournament.id, { code: 'DD', name: 'Delta' });
    assignSemifinalTeams(t.repo, tournament, [a.id, d.id, b.id, c.id]);
    const sf1 = t.repo.listMatches(tournament.id, 'semifinal').find((m) => m.matchNumber === 1)!;
    game(sf1.id, 1, a, { ...imported, radiantTeamId: a.id });
    game(sf1.id, 2, d);
    const view = model().bracket.semifinals[0];
    expect(view.slots.map((s) => s.wins)).toEqual([1, 1]);
    expect(view).toMatchObject({ matchId: sf1.id, hasDetail: true, series: { length: 3, wins: [1, 1] } });
    expect(model().bracket.semifinals[1].slots.map((s) => s.wins)).toEqual([null, null]);
  });
});

describe('buildMatchDetail', () => {
  const build = (m: Match) => {
    const state = loadState(t.repo, tournament);
    return buildMatchDetail(state, m, t.repo.listGames(m.id), emblemSourcesFor(null))!;
  };

  it('describes the match, its teams and emblems, and only what a game has', () => {
    setLengths({ groupGames: 3 });
    const m = groupMatch(3);
    game(m.id, 1, a, { ...imported, radiantTeamId: a.id });
    game(m.id, 2, b);
    const detail = build(m);
    expect(detail.title).toBe('Partido 3');
    expect(detail.teams.map((x) => x.name)).toEqual(['Alpha', 'Bravo']);
    expect(detail.teams[0]!.emblem).toEqual({ kind: 'hero', src: '/assets/heroes/axe.png' });
    expect(detail.teams[1]!.emblem).toEqual({ kind: 'tile' });
    expect(detail.series).toEqual({ length: 3, wins: [1, 1], winnerId: null });
    expect(detail.games).toHaveLength(2);
    expect(detail.games[0]).toMatchObject({ number: 1, winnerId: a.id, radiantTeamId: a.id, kills: [20, 10], deaths: [10, 20] });
    expect(detail.games[0]!.dota).toMatchObject({ matchId: 9023462170, radiantScore: 42 });
    expect(detail.games[1]!.dota).toBeNull();
    expect(detail.games[1]!.radiantTeamId).toBeNull();
  });

  it('a broken stored snapshot is treated as no data, never as an error', () => {
    const m = groupMatch();
    game(m.id, 1, a, { ...imported, radiantTeamId: a.id, dotaSnapshot: '{not json' });
    expect(build(m).games[0]!.dota).toBeNull();
  });

  it('titles the playoff matches', () => {
    const c = t.repo.createTeam(tournament.id, { code: 'CC', name: 'Charlie' });
    const d = t.repo.createTeam(tournament.id, { code: 'DD', name: 'Delta' });
    assignSemifinalTeams(t.repo, tournament, [a.id, d.id, b.id, c.id]);
    const [sf1, sf2] = t.repo.listMatches(tournament.id, 'semifinal');
    expect(build(sf1!).title).toBe('Semifinal 1');
    expect(build(sf2!).title).toBe('Semifinal 2');
  });
});

describe('GET /t/:slug/partido/:id/detalle', () => {
  const url = (id: number, slug = 'copa') => `/t/${slug}/partido/${id}/detalle`;

  it('answers the JSON of a match that has an imported game', async () => {
    const m = groupMatch();
    game(m.id, 1, a, { ...imported, radiantTeamId: a.id });
    const res = await t.get(url(m.id));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const body = (await res.json()) as { title: string; games: { dota: { matchId: number; players: unknown[] } }[] };
    expect(body.title).toBe('Partido 1');
    expect(body.games[0]!.dota.matchId).toBe(9023462170);
    expect(body.games[0]!.dota.players).toHaveLength(10);
  });

  it('is public (no login) and frameable like the rest of the site', async () => {
    const m = groupMatch();
    game(m.id, 1, a, { ...imported, radiantTeamId: a.id });
    const res = await t.get(url(m.id));
    expect(res.headers.get('x-frame-options')).toBeNull();
  });

  it('404 for a match without imported data, another tournament, an unknown id or a wrong slug', async () => {
    const m = groupMatch();
    game(m.id, 1, a);
    expect((await t.get(url(m.id))).status).toBe(404);
    const other = t.repo.createTournament({ name: 'Otra', slug: 'otra' });
    const x = t.repo.createTeam(other.id, { code: 'XX', name: 'X' });
    const y = t.repo.createTeam(other.id, { code: 'YY', name: 'Y' });
    const foreign = t.repo.createMatch({ tournamentId: other.id, phase: 'group', round: 1, matchNumber: 1, team1Id: x.id, team2Id: y.id });
    t.repo.saveGame(foreign.id, { gameNumber: 1, winnerId: x.id, team1Kills: 1, team1Deaths: 1, team2Kills: 1, team2Deaths: 1, ...imported, radiantTeamId: x.id });
    expect((await t.get(url(foreign.id))).status).toBe(404);
    expect((await t.get(url(foreign.id, 'otra'))).status).toBe(200);
    expect((await t.get(url(999999))).status).toBe(404);
    expect((await t.get(url(m.id, 'no-existe'))).status).toBe(404);
    expect((await t.get('/t/copa/partido/abc/detalle')).status).toBe(404);
  });
});

describe('public page markup', () => {
  const home = async () => (await t.get('/')).text();

  it('a best-of-1 card is what it always was: no chips, no detail button', async () => {
    const m = groupMatch();
    game(m.id, 1, a);
    const html = await home();
    expect(html).not.toContain('class="games"');
    expect(html).not.toContain('data-detail-url');
    expect(html).toContain('Partido 1');
  });

  it('a series shows its score, a chip per game and the running tag', async () => {
    setLengths({ groupGames: 3 });
    const m = groupMatch();
    game(m.id, 1, a);
    game(m.id, 2, b);
    const html = await home();
    expect(html).toContain('Serie en juego');
    expect(html).toMatch(/<span class="g a"[^>]*>J1 <b>AA<\/b><\/span>/);
    expect(html).toMatch(/<span class="g b"[^>]*>J2 <b>BB<\/b><\/span>/);
    expect(html).not.toContain('data-detail-url');
  });

  it('a decided series shows 2 - 0 with the winner in gold', async () => {
    setLengths({ groupGames: 3 });
    const m = groupMatch();
    game(m.id, 1, a);
    game(m.id, 2, a);
    const html = await home();
    expect(html).toMatch(/<span class="w">2<\/span><i>–<\/i><span class="l">0<\/span>/);
  });

  it('the detail button appears when a game was imported, and points at the match detail', async () => {
    const m = groupMatch();
    game(m.id, 1, a, { ...imported, radiantTeamId: a.id });
    const html = await home();
    expect(html).toContain(`data-detail-url="/t/copa/partido/${m.id}/detalle"`);
    expect(html).toContain('▸ Ver detalle de la partida');
  });

  it('the modal and its script are part of the page, outside the live region so patches never close it', async () => {
    const html = await home();
    const dialogAt = html.indexOf('id="matchDetail"');
    expect(dialogAt).toBeGreaterThan(html.indexOf('id="app"'));
    expect(html.indexOf('</div>', html.indexOf('id="app"'))).toBeLessThan(dialogAt + 1);
    expect(html).toMatch(/src="\/assets\/match-detail\.js\?v=[0-9a-f]{10}"/);
    expect((await t.get('/assets/match-detail.js')).status).toBe(200);
  });

  it('playoff slots show the games won in the series', async () => {
    const c = t.repo.createTeam(tournament.id, { code: 'CC', name: 'Charlie' });
    const d = t.repo.createTeam(tournament.id, { code: 'DD', name: 'Delta' });
    assignSemifinalTeams(t.repo, tournament, [a.id, d.id, b.id, c.id]);
    const sf1 = t.repo.listMatches(tournament.id, 'semifinal').find((m) => m.matchNumber === 1)!;
    game(sf1.id, 1, a, { ...imported, radiantTeamId: a.id });
    game(sf1.id, 2, a);
    const html = await home();
    expect(html).toMatch(/<b class="wins" aria-label="2 juegos ganados">2<\/b>/);
    expect(html).toContain('al mejor de 3');
    expect(html).toContain(`data-detail-url="/t/copa/partido/${sf1.id}/detalle"`);
  });
});
