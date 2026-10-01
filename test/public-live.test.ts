import { readFileSync } from 'node:fs';
import { jsx } from 'hono/jsx';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Match, Team, Tournament } from '../src/db/repository.js';
import { buildPublicModel } from '../src/public/model.js';
import { PublicContent } from '../src/public/views.js';
import { buildShare } from '../src/public/share.js';
import { assignSemifinalTeams } from '../src/services/playoffs.js';
import { loadState } from '../src/services/state.js';
import { makeApp, type TestApp } from './helpers/app.js';

const NOW = new Date('2026-10-03T19:23:00.000Z');
const STARTED = '2026-10-03T19:00:00.000Z';

let t: TestApp;
let tournament: Tournament;
let a: Team;
let b: Team;
let c: Team;
let d: Team;

const build = async (config: Record<string, unknown> = {}) => {
  t = await makeApp({ now: () => NOW, ...config });
  tournament = t.repo.createTournament({ name: 'Copa Octubre', slug: 'copa' });
  t.repo.setActiveTournament(tournament.id);
  [a, b, c, d] = ['A', 'B', 'C', 'D'].map((code, i) =>
    t.repo.createTeam(tournament.id, { code, name: `Equipo ${code}`, hero: i === 0 ? 'axe' : null }),
  ) as [Team, Team, Team, Team];
};
beforeEach(() => build());
afterEach(() => t.db.close());

const setLengths = (over: Record<string, number>) => {
  tournament = t.repo.updateTournament(tournament.id, over);
};
const groupMatch = (n = 1, round = 1, t1 = a, t2 = b): Match =>
  t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round, matchNumber: n, team1Id: t1.id, team2Id: t2.id });
const game = (matchId: number, number: number, winner: Team) =>
  t.repo.saveGame(matchId, { gameNumber: number, winnerId: winner.id, team1Kills: 20, team1Deaths: 10, team2Kills: 10, team2Deaths: 20 });
const goLive = (m: Match, gameNumber = 1, startedAt = STARTED) => t.repo.setLive(m.id, { gameNumber, startedAt });
const model = () => buildPublicModel(loadState(t.repo, t.repo.getTournamentById(tournament.id)!), t.repo.listScheduleDays(tournament.id), { now: NOW });
const home = async () => (await t.get('/')).text();
const panel = (html: string, key: string) => {
  const start = html.indexOf(`data-panel="${key}"`);
  const next = html.indexOf('<section class="panel"', start + 1);
  return html.slice(start, next < 0 ? undefined : next);
};

describe('public model: the live game', () => {
  it('is null when nothing is marked', () => {
    groupMatch();
    expect(model().live).toEqual([]);
  });

  it('a group match: label with round and match, both teams, no series for a best of 1', () => {
    const m = groupMatch(11, 4);
    goLive(m);
    expect(model().live[0]).toMatchObject({
      matchId: m.id,
      phase: 'group',
      label: 'Ronda 4 · Partido 11',
      gameNumber: 1,
      startedAt: STARTED,
      series: null,
      teamA: { id: a.id },
      teamB: { id: b.id },
      subtitleA: '',
      subtitleB: '',
    });
  });

  it('a semifinal in a best of 3: "Semifinal 2 · Juego 3 de 3", the series score and the games played', () => {
    assignSemifinalTeams(t.repo, tournament, [a.id, d.id, b.id, c.id]);
    const sf2 = t.repo.listMatches(tournament.id, 'semifinal').find((m) => m.matchNumber === 2)!;
    game(sf2.id, 1, b);
    game(sf2.id, 2, c);
    goLive(sf2, 3);
    expect(model().live[0]).toMatchObject({
      phase: 'semifinal',
      label: 'Semifinal 2 · Juego 3 de 3',
      gameNumber: 3,
      series: { length: 3, wins: [1, 1], decided: false, games: [{ number: 1, winnerId: b.id }, { number: 2, winnerId: c.id }] },
    });
  });

  it('a best-of-1 playoff match is just its name; the final says "Gran final · Juego N de 5"', () => {
    setLengths({ semifinalGames: 1 });
    assignSemifinalTeams(t.repo, tournament, [a.id, d.id, b.id, c.id]);
    goLive(t.repo.listMatches(tournament.id, 'semifinal')[0]!);
    expect(model().live[0]!.label).toBe('Semifinal 1');
    const final = t.repo.createMatch({ tournamentId: tournament.id, phase: 'final', round: 1, matchNumber: 1, team1Id: a.id, team2Id: b.id });
    goLive(final, 1);
    expect(model().live.map((l) => l.label)).toEqual(['Semifinal 1', 'Gran final · Juego 1 de 5']);
  });

  it('teams carry their group position once the table has results', () => {
    const played = groupMatch(1, 1, a, b);
    t.repo.recordResult(played.id, { winnerId: b.id, team1Kills: 20, team1Deaths: 10, team2Kills: 10, team2Deaths: 20 });
    const live = groupMatch(2, 2, a, c);
    goLive(live);
    const view = model().live[0];
    const position = (id: number) => model().standings.findIndex((row) => row.team.id === id) + 1;
    expect(view!.subtitleA).toBe(`${position(a.id)}.º de grupos`);
    expect(view!.subtitleB).toBe(`${position(c.id)}.º de grupos`);
  });

  it('flags the live card among the matches and the bracket', () => {
    const m1 = groupMatch(1, 1, a, b);
    const m2 = groupMatch(2, 1, c, d);
    goLive(m2);
    const cards = model().days.flatMap((day) => day.rounds).flatMap((r) => r.matches);
    expect(cards.find((m) => m.id === m1.id)!.liveGame).toBeNull();
    expect(cards.find((m) => m.id === m2.id)!.liveGame).toBe(1);
    assignSemifinalTeams(t.repo, tournament, [a.id, b.id, c.id, d.id]);
    const sf1 = t.repo.listMatches(tournament.id, 'semifinal')[0]!;
    goLive(sf1);
    expect(model().bracket.semifinals[0].liveGame).toBe(1);
    expect(model().bracket.semifinals[1].liveGame).toBeNull();
  });
});

describe('elapsed time', () => {
  const strip = (mutate: (m: ReturnType<typeof model>) => void) => {
    const m = model();
    mutate(m);
    return jsx(PublicContent, { model: m }).toString();
  };
  it('is left out, not shown as NaN, when the start or the server clock is unusable', () => {
    goLive(groupMatch());
    expect(strip(() => {})).toContain('Empezó hace');
    const badStart = strip((m) => { m.live[0]!.startedAt = 'garbage'; });
    expect(badStart).not.toContain('Empezó hace');
    expect(badStart).not.toContain('NaN');
    const badClock = strip((m) => { m.serverNow = ''; });
    expect(badClock).not.toContain('Empezó hace');
    expect(badClock).not.toContain('NaN');
  });
});

describe('share text', () => {
  it('says who is playing, with the stream when there is one', () => {
    groupMatch();
    goLive(groupMatch(2, 1, c, d));
    const fresh = t.repo.getTournamentById(tournament.id)!;
    t.repo.updateTournament(fresh.id, { streamUrl: 'https://www.twitch.tv/nbh_ind' });
    const share = buildShare(model());
    expect(share.title).toContain('🔴 EN VIVO');
    expect(share.description).toContain('En juego: Equipo C vs Equipo D');
    expect(share.description).toContain('Twitch');
  });

  it('says how many games are on when several are live, and which one is on the stream', () => {
    const m1 = groupMatch(1, 1, a, b);
    const m2 = groupMatch(2, 1, c, d);
    goLive(m1);
    goLive(m2);
    expect(buildShare(model()).description).toBe('2 partidas en juego');
    t.repo.setStream(tournament.id, m2.id);
    expect(buildShare(model()).description).toBe('2 partidas en juego · En transmisión: Equipo C vs Equipo D');
  });

  it('without a stream it still says who is playing', () => {
    goLive(groupMatch());
    expect(buildShare(model()).description).toContain('En juego: Equipo A vs Equipo B');
  });

  it('is what it was when nothing is live', () => {
    groupMatch();
    expect(buildShare(model()).title).not.toContain('EN VIVO');
  });
});

describe('public page: the live strip', () => {
  it('no strip, no notice and no highlighted card when nothing is live', async () => {
    groupMatch();
    const html = await home();
    expect(html).not.toContain('live-list');
    expect(html).not.toContain('live-notice');
    expect(html).not.toContain('on-air');
  });

  it('the En vivo tab lists the live match above the player, with phase, teams and elapsed time', async () => {
    t.repo.updateTournament(tournament.id, { streamUrl: 'https://www.twitch.tv/nbh_ind' });
    goLive(groupMatch(11, 4));
    const tab = panel(await home(), 'envivo');
    const list = tab.indexOf('class="live-list"');
    expect(list).toBeGreaterThan(-1);
    expect(list).toBeLessThan(tab.indexOf('data-stream-frame'));
    expect(tab).toContain('En juego');
    expect(tab).toContain('Ronda 4 · Partido 11');
    expect(tab).toContain('Equipo A');
    expect(tab).toContain('Equipo B');
    expect(tab).toMatch(/Empezó hace <b data-live-start="2026-10-03T19:00:00.000Z">23 min<\/b>/);
    expect(tab).not.toContain('En transmisión');
  });

  it('without a configured stream the list still shows, above the empty state', async () => {
    goLive(groupMatch());
    const tab = panel(await home(), 'envivo');
    expect(tab.indexOf('class="live-list"')).toBeLessThan(tab.indexOf('stream-empty'));
  });

  it('a series row shows the score of the series and its game', async () => {
    assignSemifinalTeams(t.repo, tournament, [a.id, d.id, b.id, c.id]);
    const sf2 = t.repo.listMatches(tournament.id, 'semifinal').find((m) => m.matchNumber === 2)!;
    game(sf2.id, 1, b);
    game(sf2.id, 2, c);
    goLive(sf2, 3);
    const tab = panel(await home(), 'envivo');
    expect(tab).toContain('Semifinal 2 · Juego 3 de 3');
    expect(tab).toMatch(/<div class="lr-score"><span>1<\/span><i>–<\/i><span>1<\/span><\/div>/);
  });

  it('several live matches: one row each, the one on the stream first and in violet with the player caption', async () => {
    t.repo.updateTournament(tournament.id, { streamUrl: 'https://www.twitch.tv/nbh_ind' });
    const m1 = groupMatch(1, 1, a, b);
    const m2 = groupMatch(2, 1, c, d);
    goLive(m1, 1, '2026-10-03T19:00:00.000Z');
    goLive(m2, 1, '2026-10-03T19:10:00.000Z');
    let tab = panel(await home(), 'envivo');
    expect(tab.match(/class="lrow/g)).toHaveLength(2);
    expect(tab).not.toContain('En transmisión');
    expect(tab.indexOf('Equipo A')).toBeLessThan(tab.indexOf('Equipo C'));
    t.repo.setStream(tournament.id, m2.id);
    tab = panel(await home(), 'envivo');
    expect(tab.match(/class="lrow/g)).toHaveLength(2);
    expect(tab.indexOf('Equipo C')).toBeLessThan(tab.indexOf('Equipo A'));
    expect(tab).toMatch(/class="lrow tv"/);
    expect(tab.match(/📺 En transmisión/g)).toHaveLength(2); // the row pill and the player caption
    expect(tab).toContain('📺 En transmisión: Equipo C vs Equipo D');
  });
});

describe('public page: cards and the notice', () => {
  it('the live card is highlighted with "● EN JUEGO" (and the game for a series)', async () => {
    goLive(groupMatch(1, 1, a, b));
    groupMatch(2, 1, c, d);
    const html = await home();
    expect(html.match(/<article class="match[^"]*on-air/g)).toHaveLength(1);
    expect(html).toMatch(/<span class="now-pill"><span class="now-dot"><\/span>En juego<\/span>/);
  });

  it('a series card says which game: "En juego · J3"', async () => {
    assignSemifinalTeams(t.repo, tournament, [a.id, d.id, b.id, c.id]);
    const sf1 = t.repo.listMatches(tournament.id, 'semifinal')[0]!;
    game(sf1.id, 1, a);
    game(sf1.id, 2, d);
    goLive(sf1, 3);
    const html = await home();
    expect(html).toMatch(/class="bm on-air"/);
    expect(html).toContain('En juego · J3');
  });

  it('the match on the stream is violet on its card and says so', async () => {
    const m1 = groupMatch(1, 1, a, b);
    const m2 = groupMatch(2, 1, c, d);
    goLive(m1);
    goLive(m2);
    t.repo.setStream(tournament.id, m2.id);
    const html = await home();
    expect(html.match(/<article class="match[^"]*on-air/g)).toHaveLength(2);
    expect(html.match(/<article class="match[^"]*on-air tv/g)).toHaveLength(1);
    expect(html).toMatch(/<span class="now-pill tv">📺 En transmisión<\/span>/);
  });

  it('the notice counts the games when several are live and links to the stream or to the matches', async () => {
    goLive(groupMatch(1, 1, a, b));
    goLive(groupMatch(2, 1, c, d));
    let html = await home();
    expect(html).toMatch(/<a class="live-notice" href="#partidos">[^]*2 partidas en juego/);
    t.repo.updateTournament(tournament.id, { streamUrl: 'https://www.twitch.tv/nbh_ind' });
    html = await home();
    expect(html).toMatch(/<a class="live-notice" href="#envivo">[^]*2 partidas en juego[^]*Ver en vivo/);
    expect(html).not.toContain('En juego: Equipo A vs Equipo B');
  });

  it('a notice at the top links to the En vivo tab when there is a stream', async () => {
    t.repo.updateTournament(tournament.id, { streamUrl: 'https://www.twitch.tv/nbh_ind' });
    goLive(groupMatch());
    const html = await home();
    expect(html).toMatch(/<a class="live-notice" href="#envivo">[^]*En juego: Equipo A vs Equipo B[^]*Ver en vivo/);
    expect(html.indexOf('live-notice')).toBeLessThan(html.indexOf('data-panel="partidos"'));
  });

  it('without a stream the notice leads to the card: Partidos for groups, Playoffs for the bracket', async () => {
    goLive(groupMatch());
    expect(await home()).toMatch(/<a class="live-notice" href="#partidos">[^]*Ver partido/);
    t.repo.setLive(tournament.id, null);
    assignSemifinalTeams(t.repo, tournament, [a.id, d.id, b.id, c.id]);
    goLive(t.repo.listMatches(tournament.id, 'semifinal')[0]!);
    expect(await home()).toMatch(/<a class="live-notice" href="#playoffs">/);
  });

  it('the stylesheet pulses only when motion is allowed', () => {
    // read as text: the animations live in site.css
    const css = readFileSync(new URL('../public/site.css', import.meta.url), 'utf8');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.now-dot \{ animation: none; \}/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.match\.on-air, \.bm\.on-air \{ animation: none/);
  });
});
