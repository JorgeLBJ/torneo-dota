import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateObserverToken } from '../src/auth/observer-token.js';
import { CapturedDotaSource } from '../src/dota/captured.js';
import { mapGsiState } from '../src/dota/gsi.js';
import { INCOMPLETE_AFTER_MS, captureStateOf } from '../src/gsi/state.js';
import { flashText, makeApp, type TestApp } from './helpers/app.js';

const POST_GAME = 'DOTA_GAMERULES_STATE_POST_GAME';
const IN_PROGRESS = 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS';
const sample = () => JSON.parse(readFileSync(new URL('./fixtures/gsi-spectator-sample.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-10-09T22:00:00Z');

let t: TestApp;
let cookie: string;
let observerId: number;
beforeEach(async () => {
  t = await makeApp({ now: () => NOW });
  cookie = await t.login();
  const gen = generateObserverToken();
  observerId = t.repo.createObserverToken('Mati', gen.hash, gen.prefix).id;
});
afterEach(() => t.db.close());

/** Stores a capture and pins its timestamps (SQLite UTC) so the state depends only on the injected clock. */
function capture(matchId: number, opts: { final?: boolean; updated?: string; state?: unknown } = {}) {
  const final = opts.final ?? false;
  t.repo.upsertGsiCapture(matchId, observerId, final ? POST_GAME : IN_PROGRESS, final, JSON.stringify(opts.state ?? sample()));
  const updated = opts.updated ?? '2026-10-09 21:59:50';
  t.db.prepare('UPDATE gsi_captures SET first_received_at = ?, updated_at = ? WHERE dota_match_id = ?').run('2026-10-09 21:00:00', updated, matchId);
}

/** A saved game that used the capture's Dota match id. */
function linkGame(matchId: number) {
  const tournament = t.repo.createTournament({ name: 'Copa Octubre', slug: 'copa' });
  const a = t.repo.createTeam(tournament.id, { code: 'A', name: 'Equipo A' });
  const b = t.repo.createTeam(tournament.id, { code: 'B', name: 'Equipo B' });
  const m = t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: 3, matchNumber: 7, team1Id: a.id, team2Id: b.id });
  t.repo.saveGame(m.id, { gameNumber: 1, winnerId: a.id, team1Kills: 42, team1Deaths: 37, team2Kills: 37, team2Deaths: 42, radiantTeamId: a.id, dotaMatchId: matchId, dotaSnapshot: null });
  return { tournament, match: m, a, b };
}

describe('captureStateOf', () => {
  const at = (ms: number) => new Date(NOW.getTime() - ms);
  const stamp = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
  it('is final once the final state arrived, whatever the age', () => {
    expect(captureStateOf({ isFinal: true, updatedAt: stamp(at(10 * INCOMPLETE_AFTER_MS)) }, NOW)).toBe('final');
  });
  it('is live while updates keep coming and incomplete after the threshold', () => {
    expect(INCOMPLETE_AFTER_MS).toBe(5 * 60 * 1000);
    expect(captureStateOf({ isFinal: false, updatedAt: stamp(at(INCOMPLETE_AFTER_MS)) }, NOW)).toBe('live');
    expect(captureStateOf({ isFinal: false, updatedAt: stamp(at(INCOMPLETE_AFTER_MS + 1000)) }, NOW)).toBe('incomplete');
    expect(captureStateOf({ isFinal: false, updatedAt: 'garbage' }, NOW)).toBe('incomplete');
  });
});

describe('Capturas GSI list', () => {
  it('requires a login', async () => {
    const res = await t.get('/admin/capturas');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/login');
  });

  it('starts empty and is linked from the navigation', async () => {
    const html = await (await t.get('/admin/capturas', cookie)).text();
    expect(html).toContain('href="/admin/capturas"');
    expect(html).toContain('Aún no hay capturas');
    expect(html).not.toContain('sin vincular</span>');
  });

  it('shows state, score with the winner side, duration, observer and last update', async () => {
    capture(9028047526, { final: true, updated: '2026-10-09 21:30:00' });
    capture(9031277410, { updated: '2026-10-09 21:59:50' });
    capture(9027990012, { updated: '2026-10-09 21:50:00' });
    const html = await (await t.get('/admin/capturas', cookie)).text();
    expect(html).toContain('9028047526');
    expect(html).toContain('Finalizada');
    expect(html).toContain('42');
    expect(html).toContain('37');
    expect(html).toContain('Radiant');
    expect(html).toContain('35:12'); // 2112 s
    expect(html).toContain('Mati');
    expect(html).toContain('En curso');
    expect(html).toContain('Incompleta');
    expect(html).toContain('09/10/2026 16:30:00');
    expect(html).toContain('href="/admin/capturas/9028047526"');
  });

  it('shows what it can for a state the mapper cannot read', async () => {
    capture(555, { state: { map: { matchid: '555', radiant_score: 3 } } });
    capture(556, { state: 'not-an-object' });
    const res = await t.get('/admin/capturas', cookie);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('555');
  });

  it('badges the final captures that no saved game uses', async () => {
    capture(1, { final: true });
    capture(2, { final: true });
    capture(3, { final: false });
    linkGame(2);
    const html = await (await t.get('/admin/capturas', cookie)).text();
    expect(html).toMatch(/1 sin vincular/);
  });

  it('shows what a capture is linked to', async () => {
    const { tournament } = linkGame(77);
    capture(77, { final: true });
    const html = await (await t.get('/admin/capturas', cookie)).text();
    expect(html).toContain('Copa Octubre');
    expect(html).toContain('Fecha 3');
    expect(html).toContain('Equipo A vs Equipo B');
    expect(html).toContain(`/admin/t/${tournament.id}/resultados`);
  });

  it('filters by state with counts and searches by Match ID', async () => {
    capture(101, { final: true }); // sin vincular
    capture(102, { final: true }); // vinculada
    capture(103, { updated: '2026-10-09 21:59:55' }); // en curso
    linkGame(102);
    const all = await (await t.get('/admin/capturas', cookie)).text();
    expect(all).toContain('Todas · 3');
    expect(all).toContain('En curso · 1');
    expect(all).toContain('Sin vincular · 1');
    expect(all).toContain('Vinculadas · 1');

    const live = await (await t.get('/admin/capturas?estado=en-curso', cookie)).text();
    expect(live).toContain('/admin/capturas/103"');
    expect(live).not.toContain('/admin/capturas/101"');
    const unlinked = await (await t.get('/admin/capturas?estado=sin-vincular', cookie)).text();
    expect(unlinked).toContain('/admin/capturas/101"');
    expect(unlinked).not.toContain('/admin/capturas/102"');
    const linked = await (await t.get('/admin/capturas?estado=vinculadas', cookie)).text();
    expect(linked).toContain('/admin/capturas/102"');
    expect(linked).not.toContain('/admin/capturas/101"');
    const found = await (await t.get('/admin/capturas?q=102', cookie)).text();
    expect(found).toContain('/admin/capturas/102"');
    expect(found).not.toContain('/admin/capturas/103"');
  });

  it('paginates', async () => {
    for (let i = 1; i <= 60; i++) capture(5000 + i, { final: true });
    const first = await (await t.get('/admin/capturas', cookie)).text();
    expect((first.match(/href="\/admin\/capturas\/5\d{3}"/g) ?? []).length).toBe(50);
    expect(first).toContain('pagina=2');
    const second = await (await t.get('/admin/capturas?pagina=2', cookie)).text();
    expect((second.match(/href="\/admin\/capturas\/5\d{3}"/g) ?? []).length).toBe(10);
  });
});

describe('Capture detail', () => {
  it('answers 404 for an unknown or malformed id', async () => {
    expect((await t.get('/admin/capturas/12345', cookie)).status).toBe(404);
    expect((await t.get('/admin/capturas/abc', cookie)).status).toBe(404);
  });

  it('shows the header, score and ten players', async () => {
    capture(9028047526, { final: true });
    const res = await t.get('/admin/capturas/9028047526', cookie);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('9028047526');
    expect(html).toContain('Mati');
    expect(html).toContain('Finalizada');
    expect(html).toContain('35:12');
    expect(html).toContain('Radiant');
    expect(html).toContain('Dire');
    for (const nick of ['Juan', 'Ana', 'Luis', 'Beto']) expect(html).toContain(nick);
    expect(html).toContain('3 / 5 / 7');
    expect(html).toContain('150 / 5');
    expect(html).toContain('15.0k');
  });

  it('shows each hero with its portrait next to the name', async () => {
    capture(9028047526, { final: true });
    const html = await (await t.get('/admin/capturas/9028047526', cookie)).text();
    expect(html).toMatch(/<img[^>]+src="\/assets\/heroes\/axe\.png"/);
    expect(html).toMatch(/<img[^>]+src="\/assets\/heroes\/crystal_maiden\.png"/);
    expect(html).toContain('Crystal Maiden');
  });

  it('keeps the raw JSON collapsed and escaped', async () => {
    const state = sample();
    state.player.team2.player0.name = '<script>alert(1)</script>';
    capture(31, { final: true, state });
    const html = await (await t.get('/admin/capturas/31', cookie)).text();
    expect(html).toMatch(/<details[^>]*>\s*<summary>[^<]*JSON/);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('renders an unfinished capture with whatever players it has', async () => {
    capture(32, { state: { map: { matchid: '32', radiant_score: 4, dire_score: 2, clock_time: 300 } } });
    const res = await t.get('/admin/capturas/32', cookie);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('5:00');
  });
});

describe('Deleting a capture', () => {
  it('removes it so a correct observer can send the match again', async () => {
    capture(40, { final: true });
    const res = await t.post('/admin/capturas/40/borrar', {}, cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/capturas');
    expect(await flashText(t, res, cookie)).toContain('40');
    expect(t.repo.getGsiCapture(40)).toBeUndefined();
    expect(t.repo.upsertGsiCapture(40, observerId, IN_PROGRESS, false, '{}')).toBe(true);
  });

  it('leaves a saved game that used the capture untouched, and says so in the confirmation', async () => {
    const { match } = linkGame(41);
    capture(41, { final: true });
    const html = await (await t.get('/admin/capturas/41', cookie)).text();
    expect(html).toContain('Borrar captura');
    expect(html).toContain('no modifica');
    await t.post('/admin/capturas/41/borrar', {}, cookie);
    expect(t.repo.getGsiCapture(41)).toBeUndefined();
    expect(t.repo.listGames(match.id)).toHaveLength(1);
    expect(t.repo.listGames(match.id)[0]!.dotaMatchId).toBe(41);
  });

  it('answers an unknown id with an error flash', async () => {
    const res = await t.post('/admin/capturas/999/borrar', {}, cookie);
    expect(res.status).toBe(303);
    expect(await flashText(t, res, cookie)).toContain('no existe');
  });
});

describe('Observadores screen after the move', () => {
  it('no longer lists recent captures and shows a capture count per observer', async () => {
    capture(1);
    capture(2, { final: true });
    const html = await (await t.get('/admin/observadores', cookie)).text();
    expect(html).not.toContain('Capturas recientes');
    expect(html).toContain('<th>Capturas</th>');
    expect(html).toMatch(/data-label="Capturas">2</);
  });
});

describe('Linking lives in Resultados, not in the capture screens', () => {
  const MATCH = 8123456789; // map.matchid of the fixture

  it('the list only offers "Ver", also for a final unlinked capture', async () => {
    capture(MATCH, { final: true });
    const html = await (await t.get('/admin/capturas', cookie)).text();
    expect(html).toContain('>Ver<');
    expect(html).not.toContain('Ver y vincular');
    expect(html).not.toContain('se pueden vincular');
  });

  it('the detail has no link form and no link route, and points to Resultados for an unlinked final capture', async () => {
    t.repo.createTournament({ name: 'Copa Octubre', slug: 'copa' });
    capture(MATCH, { final: true });
    const html = await (await t.get(`/admin/capturas/${MATCH}?torneo=1&partido=1`, cookie)).text();
    expect(html).not.toContain('Vincular a un juego del torneo');
    expect(html).not.toContain('/vincular');
    expect(html).toContain('Para cargarla en un juego, escribe este Match ID en Resultados y pulsa «Buscar».');
    const post = await t.post(`/admin/capturas/${MATCH}/vincular`, { torneo: '1' }, cookie);
    expect(post.status).toBe(404);
  });

  it('no hint for a live or an already linked capture', async () => {
    capture(MATCH + 1, { final: false });
    expect(await (await t.get(`/admin/capturas/${MATCH + 1}`, cookie)).text()).not.toContain('escribe este Match ID');
    linkGame(MATCH);
    capture(MATCH, { final: true });
    const html = await (await t.get(`/admin/capturas/${MATCH}`, cookie)).text();
    expect(html).not.toContain('escribe este Match ID');
    expect(html).toContain('Vinculada a');
  });

  it('entering the Match ID in the Resultados game form stores the captured game (source gsi) and the capture shows as linked', async () => {
    capture(MATCH, { final: true });
    const tournament = t.repo.createTournament({ name: 'Copa Octubre', slug: 'copa' });
    t.repo.setActiveTournament(tournament.id);
    const a = t.repo.createTeam(tournament.id, { code: 'A', name: 'Equipo A' });
    const b = t.repo.createTeam(tournament.id, { code: 'B', name: 'Equipo B' });
    const m = t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: 2, matchNumber: 1, team1Id: a.id, team2Id: b.id });
    const base = `/admin/t/${tournament.id}`;

    const found = await t.send('POST', `${base}/dota/buscar`, { form: { dota_match_id: String(MATCH) }, cookie, headers: { accept: 'application/json' } });
    expect(((await found.json()) as { ok: boolean }).ok).toBe(true);
    const auto = await t.send('POST', `${base}/dota/autocompletar`, {
      form: { dota_match_id: String(MATCH), winner: String(a.id), team1_id: String(a.id), team2_id: String(b.id) },
      cookie,
      headers: { accept: 'application/json' },
    });
    const filled = (await auto.json()) as { ok: boolean; team1Kills: number; team1Deaths: number; team2Kills: number; team2Deaths: number };
    expect(filled.ok).toBe(true);

    const res = await t.post(
      `${base}/resultados/${m.id}/juego/1`,
      {
        winner: String(a.id),
        t1_kills: String(filled.team1Kills),
        t1_deaths: String(filled.team1Deaths),
        t2_kills: String(filled.team2Kills),
        t2_deaths: String(filled.team2Deaths),
        dota_match_id: String(MATCH),
        dota_winner: String(a.id),
      },
      cookie,
    );
    expect(res.status).toBe(303);
    const game = t.repo.listGames(m.id)[0]!;
    expect(game).toMatchObject({ dotaMatchId: MATCH, radiantTeamId: a.id, winnerId: a.id, dotaSource: 'gsi' });

    const list = await (await t.get('/admin/capturas?estado=vinculadas', cookie)).text();
    expect(list).toContain('Copa Octubre');
    expect(list).toContain('Equipo A vs Equipo B');
    const detail = await (await t.get(`/admin/capturas/${MATCH}`, cookie)).text();
    expect(detail).toContain('Vinculada a');
    expect(detail).not.toContain('escribe este Match ID');
  });
});

// Helpers for the source-marker tests (moved here with the capture-link tests removal).
const MATCH_ID = 8123456789;
const snapshot = () => mapGsiState(sample(), { startTime: 0 });
function setup() {
  const tournament = t.repo.createTournament({ name: 'Copa Octubre', slug: 'copa' });
  const a = t.repo.createTeam(tournament.id, { code: 'A', name: 'Equipo A' });
  const b = t.repo.createTeam(tournament.id, { code: 'B', name: 'Equipo B' });
  const match = t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: 2, matchNumber: 1, team1Id: a.id, team2Id: b.id });
  return { tournament, a, b, match };
}

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
    capture(MATCH_ID, { final: true });
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
