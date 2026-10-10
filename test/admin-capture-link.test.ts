import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateObserverToken } from '../src/auth/observer-token.js';
import { CapturedDotaSource } from '../src/dota/captured.js';
import { mapGsiState } from '../src/dota/gsi.js';
import { flashText, makeApp, type TestApp } from './helpers/app.js';

const POST_GAME = 'DOTA_GAMERULES_STATE_POST_GAME';
const IN_PROGRESS = 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS';
const sample = () => JSON.parse(readFileSync(new URL('./fixtures/gsi-spectator-sample.json', import.meta.url), 'utf8'));
const MATCH_ID = 8123456789;

let t: TestApp;
let cookie: string;
let observerId: number;
beforeEach(async () => {
  t = await makeApp();
  cookie = await t.login();
  const gen = generateObserverToken();
  observerId = t.repo.createObserverToken('Mati', gen.hash, gen.prefix).id;
});
afterEach(() => t.db.close());

function capture(matchId = MATCH_ID, final = true, state: unknown = sample()) {
  t.repo.upsertGsiCapture(matchId, observerId, final ? POST_GAME : IN_PROGRESS, final, JSON.stringify(state));
}

function setup(phase: 'group' | 'semifinal' = 'group') {
  const tournament = t.repo.createTournament({ name: 'Copa Octubre', slug: 'copa' });
  const a = t.repo.createTeam(tournament.id, { code: 'A', name: 'Equipo A' });
  const b = t.repo.createTeam(tournament.id, { code: 'B', name: 'Equipo B' });
  const match = t.repo.createMatch({ tournamentId: tournament.id, phase, round: 2, matchNumber: 1, team1Id: a.id, team2Id: b.id });
  return { tournament, a, b, match };
}

const link = (matchId: number, form: Record<string, string>) => t.post(`/admin/capturas/${matchId}/vincular`, form, cookie);
const snapshot = () => mapGsiState(sample(), { startTime: 0 });
const deathsOf = (side: 'radiant' | 'dire') => snapshot().players.filter((p) => p.side === side).reduce((n, p) => n + p.deaths, 0);

describe('link form on the capture detail', () => {
  it('is offered for a final unlinked capture, with the tournaments to choose from', async () => {
    const { tournament } = setup();
    capture();
    const html = await (await t.get(`/admin/capturas/${MATCH_ID}`, cookie)).text();
    expect(html).toContain('Vincular a un juego del torneo');
    expect(html).toContain('Copa Octubre');
    expect(html).toContain(`value="${tournament.id}"`);
    expect(html).toContain('Fecha 2 · Equipo A vs Equipo B');
  });

  it('is not offered for a capture that has not ended', async () => {
    setup();
    capture(MATCH_ID, false);
    const html = await (await t.get(`/admin/capturas/${MATCH_ID}`, cookie)).text();
    expect(html).not.toContain('Vincular a un juego del torneo');
  });

  it('explains a final capture that cannot be saved as a game instead of offering the form', async () => {
    setup();
    const state = sample();
    state.map.win_team = 'none';
    capture(MATCH_ID, true, state);
    const html = await (await t.get(`/admin/capturas/${MATCH_ID}`, cookie)).text();
    expect(html).not.toContain('Vincular a un juego del torneo');
    expect(html).toContain('incompleta');
  });

  it('offers the radiant team and the game slots once a match is chosen', async () => {
    const { tournament, match } = setup('semifinal');
    capture();
    const html = await (await t.get(`/admin/capturas/${MATCH_ID}?torneo=${tournament.id}&partido=${match.id}`, cookie)).text();
    expect(html).toContain('¿Quién jugó de Radiant?');
    expect(html).toContain('Equipo A');
    expect(html).toContain('Equipo B');
    expect(html).toContain('Juego 1');
    expect(html).toContain('name="juego"');
  });

  it('only offers the next free slot of the series plus the ones that already have a result', async () => {
    const { tournament, match, a } = setup('semifinal');
    t.repo.saveGame(match.id, { gameNumber: 1, winnerId: a.id, team1Kills: 1, team1Deaths: 1, team2Kills: 1, team2Deaths: 1 });
    capture();
    const html = await (await t.get(`/admin/capturas/${MATCH_ID}?torneo=${tournament.id}&partido=${match.id}`, cookie)).text();
    expect(html).toContain('Juego 1 · ya tiene resultado');
    expect(html).toContain('value="2"');
    expect(html).not.toContain('value="3"');
  });
});

describe('linking a capture to a game', () => {
  it('saves winner, kills/deaths, the Dota match id, the radiant team and the snapshot', async () => {
    const { tournament, match, a, b } = setup();
    capture();
    const res = await link(MATCH_ID, { torneo: String(tournament.id), partido: String(match.id), juego: '1', radiant: String(a.id) });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/admin/capturas/${MATCH_ID}`);
    expect(await flashText(t, res, cookie)).toContain('vinculada');

    const [game] = t.repo.listGames(match.id);
    expect(game).toMatchObject({
      gameNumber: 1,
      winnerId: a.id, // Radiant won and team A played Radiant
      team1Kills: 42,
      team1Deaths: deathsOf('radiant'),
      team2Kills: 37,
      team2Deaths: deathsOf('dire'),
      radiantTeamId: a.id,
      dotaMatchId: MATCH_ID,
    });
    const saved = JSON.parse(game!.dotaSnapshot!);
    expect(saved).toMatchObject({ matchId: MATCH_ID, radiantWin: true, source: 'gsi' });
    expect(saved.players).toHaveLength(10);
    expect(t.repo.getMatch(match.id)!.winnerId).toBe(a.id);

    const page = await (await t.get(`/admin/capturas/${MATCH_ID}`, cookie)).text();
    expect(page).toContain('Vinculada a');
    expect(page).toContain(`Copa Octubre · Fecha 2 · Equipo A vs Equipo B`);
    expect(page).not.toContain('Vincular a un juego del torneo');
    void b;
  });

  it('gives the win to the other team when it played Radiant', async () => {
    const { tournament, match, a, b } = setup();
    capture();
    await link(MATCH_ID, { torneo: String(tournament.id), partido: String(match.id), juego: '1', radiant: String(b.id) });
    expect(t.repo.listGames(match.id)[0]).toMatchObject({ winnerId: b.id, team1Kills: 37, team2Kills: 42, radiantTeamId: b.id });
    void a;
  });

  it('asks for confirmation before overwriting a game that already has a result', async () => {
    const { tournament, match, a, b } = setup();
    t.repo.saveGame(match.id, { gameNumber: 1, winnerId: b.id, team1Kills: 5, team1Deaths: 6, team2Kills: 7, team2Deaths: 8 });
    capture();
    const form = { torneo: String(tournament.id), partido: String(match.id), juego: '1', radiant: String(a.id) };
    const first = await link(MATCH_ID, form);
    expect(first.status).toBe(303);
    expect(t.repo.listGames(match.id)[0]).toMatchObject({ winnerId: b.id, team1Kills: 5, dotaMatchId: null });
    const ask = await t.get(first.headers.get('location')!, cookie);
    const html = await ask.text();
    expect(html).toContain('ya tiene un resultado');
    expect(html).toContain('name="confirmar" value="1"');

    const second = await link(MATCH_ID, { ...form, confirmar: '1' });
    expect(second.headers.get('location')).toBe(`/admin/capturas/${MATCH_ID}`);
    expect(t.repo.listGames(match.id)[0]).toMatchObject({ winnerId: a.id, team1Kills: 42, dotaMatchId: MATCH_ID });
  });

  it('refuses what the series rules refuse', async () => {
    const { tournament, match, a } = setup('semifinal');
    capture();
    const res = await link(MATCH_ID, { torneo: String(tournament.id), partido: String(match.id), juego: '2', radiant: String(a.id) });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain(`/admin/capturas/${MATCH_ID}`);
    expect(t.repo.listGames(match.id)).toHaveLength(0);
    expect((await flashText(t, res, cookie)).length).toBeGreaterThan(0);
  });

  it('refuses a capture that has not ended, an unknown capture and an unknown match', async () => {
    const { tournament, match, a } = setup();
    capture(MATCH_ID, false);
    const form = { torneo: String(tournament.id), partido: String(match.id), juego: '1', radiant: String(a.id) };
    expect(await flashText(t, await link(MATCH_ID, form), cookie)).toContain('no terminó');
    expect(t.repo.listGames(match.id)).toHaveLength(0);

    expect(await flashText(t, await link(999, form), cookie)).toContain('no existe');

    capture();
    expect(await flashText(t, await link(MATCH_ID, { ...form, partido: '99999' }), cookie)).toContain('partido');
    expect(t.repo.listGames(match.id)).toHaveLength(0);
  });

  it('refuses a radiant team that is not in the match, and a match of another tournament', async () => {
    const { tournament, match } = setup();
    const other = t.repo.createTournament({ name: 'Otra', slug: 'otra' });
    const stranger = t.repo.createTeam(other.id, { code: 'Z', name: 'Zeta' });
    capture();
    const res = await link(MATCH_ID, { torneo: String(tournament.id), partido: String(match.id), juego: '1', radiant: String(stranger.id) });
    expect(t.repo.listGames(match.id)).toHaveLength(0);
    expect((await flashText(t, res, cookie)).length).toBeGreaterThan(0);

    const { match: otherMatch } = (() => {
      const x = t.repo.createTeam(other.id, { code: 'Y', name: 'Ye' });
      return { match: t.repo.createMatch({ tournamentId: other.id, phase: 'group', round: 1, matchNumber: 1, team1Id: stranger.id, team2Id: x.id }) };
    })();
    await link(MATCH_ID, { torneo: String(tournament.id), partido: String(otherMatch.id), juego: '1', radiant: String(stranger.id) });
    expect(t.repo.listGames(otherMatch.id)).toHaveLength(0);
  });

  it('does not offer to link a capture already used by a game, and refuses a second link', async () => {
    const { tournament, match, a } = setup();
    capture();
    const form = { torneo: String(tournament.id), partido: String(match.id), juego: '1', radiant: String(a.id) };
    await link(MATCH_ID, form);
    const again = await link(MATCH_ID, { ...form, confirmar: '1' });
    expect(await flashText(t, again, cookie)).toContain('ya está vinculada');
  });
});

describe('source marker', () => {
  it('reads the source of a stored game: old snapshots are OpenDota, none for a manual game', () => {
    const { match, a } = setup();
    const game = (n: number, snapshot: string | null) => ({ gameNumber: n, winnerId: a.id, team1Kills: 1, team1Deaths: 1, team2Kills: 1, team2Deaths: 1, dotaMatchId: snapshot ? 100 + n : null, radiantTeamId: snapshot ? a.id : null, dotaSnapshot: snapshot });
    const m2 = t.repo.createMatch({ tournamentId: match.tournamentId, phase: 'semifinal', round: 1, matchNumber: 2, team1Id: match.team1Id, team2Id: match.team2Id });
    t.repo.saveGame(m2.id, game(1, null));
    t.repo.saveGame(m2.id, game(2, '{"matchId":1}'));
    t.repo.saveGame(m2.id, game(3, '{"matchId":1,"source":"gsi"}'));
    const bySource = (games: { gameNumber: number; dotaSource: string | null }[]) => games.map((g) => g.dotaSource);
    expect(bySource(t.repo.listGames(m2.id))).toEqual([null, 'opendota', 'gsi']);
    expect(bySource(t.repo.listTournamentGames(match.tournamentId).filter((g) => g.matchId === m2.id))).toEqual([null, 'opendota', 'gsi']);
  });

  it('is set by the captured source', async () => {
    capture();
    const snap = await new CapturedDotaSource(t.repo, { fetch: async () => { throw new Error('unused'); } }).fetch(MATCH_ID);
    expect(snap.source).toBe('gsi');
  });

  const savedGame = (source?: 'gsi' | 'opendota') => {
    const { tournament, match, a } = setup();
    const { source: _mapped, ...base } = snapshot();
    const snap = { ...base, matchId: 9023462170, ...(source ? { source } : {}) };
    t.repo.saveGame(match.id, {
      gameNumber: 1,
      winnerId: a.id,
      team1Kills: 42,
      team1Deaths: 37,
      team2Kills: 37,
      team2Deaths: 42,
      radiantTeamId: a.id,
      dotaMatchId: 9023462170,
      dotaSnapshot: JSON.stringify(snap),
    });
    return { tournament, match };
  };

  it('the admin results card links old games to OpenDota and captured games to nothing', async () => {
    const old = savedGame();
    const oldHtml = await (await t.get(`/admin/t/${old.tournament.id}/resultados?fecha=todos`, cookie)).text();
    expect(oldHtml).toContain('Ver en OpenDota');

    t.db.prepare('DELETE FROM match_games').run();
    t.db.prepare("UPDATE tournaments SET slug = 'copa-vieja'").run();
    const gsi = savedGame('gsi');
    const html = await (await t.get(`/admin/t/${gsi.tournament.id}/resultados?fecha=todos`, cookie)).text();
    expect(html).not.toContain('opendota.com');
    expect(html).toContain('Capturado por nuestros observadores');
  });

  it('the public detail JSON carries the source and the page script labels captured games', async () => {
    const { match } = savedGame('gsi');
    const res = await t.get(`/t/copa/partido/${match.id}/detalle`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.games[0].dota.source).toBe('gsi');

    const script = readFileSync(new URL('../public/match-detail.js', import.meta.url), 'utf8');
    expect(script).toContain("dota.source === 'gsi'");
    expect(script).toContain('Datos capturados por nuestros observadores');
  });
});
