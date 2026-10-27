// End-to-end checks of the tournament formats feature (odd/tasks/tournament-formats.md S1-S8 and invariants).
import { copyFileSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, openDatabase } from '../src/db/open.js';
import { mapOpenDotaMatch } from '../src/dota/opendota.js';
import type { DotaMatchSource } from '../src/dota/source.js';
import { DE_SLOTS, type DeSlotKey } from '../src/domain/double-elimination.js';
import { regenerateFixture } from '../src/services/fixture.js';
import { flashText, makeApp, type TestApp } from './helpers/app.js';
import { MemoryImageStore } from './helpers/memory-store.js';

const NOW = new Date('2026-11-07T16:00:00Z');

function dbHash(db: Database.Database, opts: { dropCols?: Record<string, string[]>; skip?: string[] } = {}): string {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").pluck().all() as string[])
    .filter((n) => !(opts.skip ?? ['sessions']).includes(n));
  const h = createHash('sha256');
  for (const tb of tables) {
    const rows = db.prepare(`SELECT * FROM ${tb} ORDER BY rowid`).all() as Record<string, unknown>[];
    for (const r of rows) for (const c of opts.dropCols?.[tb] ?? []) delete r[c];
    h.update(tb + JSON.stringify(rows));
  }
  return h.digest('hex');
}

// ---------------------------------------------------------------- S1
describe('S1 migration 015 -> 017', () => {
  it('keeps every pre-existing row and reads as league_playoffs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig015-'));
    for (const f of readdirSync(MIGRATIONS_DIR)) if (/^0(0\d|1[0-5])_/.test(f)) copyFileSync(join(MIGRATIONS_DIR, f), join(dir, f));
    const file = join(mkdtempSync(join(tmpdir(), 'db015-')), 'x.db');
    let db = openDatabase(file, dir);
    expect(db.pragma('user_version', { simple: true })).toBe(15);
    db.exec(`
      INSERT INTO tournaments (name, slug, qualifiers, semifinal_games, final_games, points_win, rules_html, stream_url, is_active, timezone)
        VALUES ('Liga Oct', 'liga-oct', 4, 3, 5, 3, '<p>r</p>', 'https://twitch.tv/x', 1, 'America/Lima');
      INSERT INTO teams (tournament_id, code, name, image_key) VALUES (1,'A','Alpha','teams/1/a.webp'),(1,'B','Bravo',NULL),(1,'C','Charlie',NULL),(1,'D','Delta',NULL);
      INSERT INTO matches (tournament_id, phase, round, match_number, team1_id, team2_id) VALUES (1,'group',1,1,1,2),(1,'group',1,2,3,4),(1,'semifinal',1,1,1,4);
      INSERT INTO match_games (match_id, game_number, winner_id, team1_kills, team1_deaths, team2_kills, team2_deaths) VALUES (1,1,1,10,5,5,10),(3,1,4,3,9,9,3);
      INSERT INTO promo_banners (tournament_id, name, alt_text, image_key, image_width, image_height, image_key_sm, image_width_sm, active)
        VALUES (1,'Final','Final','banners/1/x.webp',1920,1080,'banners/1/x-1280.webp',1280,1);
    `);
    const before = dbHash(db, { skip: [] });
    db.close();
    db = openDatabase(file);
    expect(db.pragma('user_version', { simple: true })).toBe(17);
    expect(dbHash(db, { skip: [], dropCols: { tournaments: ['format', 'archived_at'] } })).toBe(before);
    expect(db.prepare('SELECT format, archived_at FROM tournaments').get()).toEqual({ format: 'league_playoffs', archived_at: null });
    db.close();
  });
});

// ---------------------------------------------------------------- helpers for DE
const snapshot = mapOpenDotaMatch(JSON.parse(readFileSync(new URL('./fixtures/opendota-9023462170.json', import.meta.url), 'utf8')));
const deaths = (side: 'radiant' | 'dire') => snapshot.players.filter((p) => p.side === side).reduce((n, p) => n + p.deaths, 0);
const source: DotaMatchSource = { fetch: async (id) => ({ ...snapshot, matchId: id, radiantWin: true }) };

async function deSetup() {
  const store = new MemoryImageStore();
  const t = await makeApp({ now: () => NOW, imageStore: store, dotaSource: source });
  const cookie = await t.login();
  // Create through the HTTP route (S2).
  const created = await t.post('/admin/torneos', { name: 'Relámpago', slug: 'relampago', format: 'double_elimination' }, cookie);
  expect(created.status).toBe(303);
  const tour = t.repo.getTournamentBySlug('relampago')!;
  const teams = ['Alpha', 'Bravo', 'Corsarios', 'Delta', 'Eclipse', 'Fenix'].map((name, i) =>
    t.repo.createTeam(tour.id, { code: String.fromCharCode(65 + i), name }),
  );
  const base = `/admin/t/${tour.id}/playoffs`;
  const stored = (key: DeSlotKey) => {
    const slot = DE_SLOTS.find((s) => s.key === key)!;
    return t.repo.listMatches(tour.id, slot.phase).find((m) => m.matchNumber === slot.matchNumber)!;
  };
  const L = Object.fromEntries(teams.map((x) => [x.code, x.id])) as Record<string, number>;
  const win = (key: DeSlotKey, code: string, game = 1) =>
    t.post(`${base}/llave/${key}/juego/${game}`, { action: 'save', winner: String(L[code]), t1_kills: '15', t1_deaths: '8', t2_kills: '8', t2_deaths: '15' }, cookie);
  return { t, cookie, store, tour, teams, base, stored, L, win };
}

// ---------------------------------------------------------------- S2
describe('S2 creation form and fixed format', () => {
  it('shows both formats with names and descriptions; DE gets BO1/BO3; format cannot be changed', async () => {
    const { t, cookie, tour } = await deSetup();
    const html = await (await t.get('/admin/torneos', cookie)).text();
    for (const s of ['Liga + Playoffs', 'Todos contra todos con tabla, luego semifinales y final con los 4 mejores', 'Doble eliminación',
      'Llaves superior e inferior desde el inicio, posiciones asignadas a mano, gran final BO3']) expect(html).toContain(s);
    expect(html).toMatch(/name="format"/);
    expect(tour).toMatchObject({ format: 'double_elimination', semifinalGames: 1, finalGames: 3 });
    // Config POST with a format field must not change it.
    const cfg = await (await t.get(`/admin/t/${tour.id}/config`, cookie)).text();
    expect(cfg).toContain('Doble eliminación');
    await t.post(`/admin/t/${tour.id}/config`, { name: 'Relámpago', slug: 'relampago', game: 'Dota 2', timezone: 'America/Lima', format: 'league_playoffs' }, cookie);
    expect(t.repo.getTournamentById(tour.id)!.format).toBe('double_elimination');
    // Invalid format is refused and creates nothing.
    const h = dbHash(t.db);
    const bad = await t.post('/admin/torneos', { name: 'X', slug: 'x-x', format: 'swiss' }, cookie);
    expect(await flashText(t, bad, cookie)).toContain('Elige un formato de torneo válido');
    expect(dbHash(t.db)).toBe(h);
  });
});

// ---------------------------------------------------------------- S3/S4/S5/S7
describe('S3-S5 full bracket through HTTP, lower bracket wins GF 2-1', () => {
  it('seats, lengths, champion, public page', async () => {
    const { t, cookie, tour, base, stored, L, win } = await deSetup();
    const pos = await t.post(`${base}/posiciones`, Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((p, i) => [`pos_${p}`, String(L['ABCDEF'[i]!])])), cookie);
    expect(await flashText(t, pos, cookie)).toContain('Posiciones guardadas');
    expect(t.repo.listMatches(tour.id, 'group')).toHaveLength(0);
    const seats = (k: DeSlotKey) => { const m = stored(k); return [m.team1Id, m.team2Id]; };
    expect(seats('U1')).toEqual([L.A, L.B]);
    expect(seats('U2')).toEqual([L.C, L.D]);
    await win('U1', 'A'); await win('U2', 'D');
    // BO1: a second game is refused
    const g2 = await win('U1', 'A', 2);
    const g2text = await flashText(t, g2, cookie);
    expect(t.repo.listGames(stored('U1').id)).toHaveLength(1);
    await win('U3', 'E'); // U3 = winner U1 (A) vs E
    expect(seats('U3')).toEqual([L.A, L.E]);
    await win('U4', 'F'); // U4 = F vs winner U2 (D)
    expect(seats('U4')).toEqual([L.F, L.D]);
    await win('U5', 'E');
    expect(seats('U5')).toEqual([L.E, L.F]);
    await win('L1', 'B'); expect(seats('L1')).toEqual([L.B, L.D]); // loser U1 vs loser U4
    await win('L2', 'A'); expect(seats('L2')).toEqual([L.C, L.A]); // loser U2 vs loser U3
    await win('L3', 'A'); expect(seats('L3')).toEqual([L.B, L.A]);
    await win('L4', 'A'); expect(seats('L4')).toEqual([L.A, L.F]); // winner L3 vs loser U5
    // GF: E (upper) vs A (lower), A wins 2-1
    await win('GF', 'A', 1);
    expect(stored('GF').winnerId).toBeNull();
    await win('GF', 'E', 2);
    expect(stored('GF').winnerId).toBeNull();
    await win('GF', 'A', 3);
    expect(seats('GF')).toEqual([L.E, L.A]);
    expect(stored('GF').winnerId).toBe(L.A);
    for (const k of ['U1', 'U2', 'U3', 'U4', 'U5', 'L1', 'L2', 'L3', 'L4'] as DeSlotKey[]) expect(t.repo.listGames(stored(k).id)).toHaveLength(1);
    expect(t.repo.listGames(stored('GF').id)).toHaveLength(3);
    // A 4th GF game is refused
    await win('GF', 'A', 4);
    expect(t.repo.listGames(stored('GF').id)).toHaveLength(3);

    const torneos = await (await t.get('/admin/torneos', cookie)).text();
    expect(torneos).toContain('Campeón A');
    t.repo.setActiveTournament(tour.id);
    for (const path of ['/', '/t/relampago']) {
      const pub = await (await t.get(path)).text();
      expect(pub).toContain('Campeón');
      expect(pub).toContain('Alpha');
      expect(pub).toContain('Gran final');
      expect(pub).toContain('Final superior');
      expect(pub).toContain('Final inferior');
      // tabs Partidos/Posiciones hidden
      expect(pub).not.toMatch(/<button[^>]*data-tab="partidos"[^>]*>/);
      expect(pub).not.toMatch(/<button[^>]*data-tab="posiciones"[^>]*>/);
      expect(pub).toMatch(/data-tab="playoffs"[^>]*>Llaves/);
      expect(pub).toContain('Doble eliminación');
    }
    return g2text;
  });
});

// ---------------------------------------------------------------- S6
describe('S6 changing U1 clears dependents only; import + live on a series', () => {
  it('clears U3, U5, L1, L2, L3, L4, GF and keeps U2, U4', async () => {
    const { t, cookie, tour, base, stored, L, win } = await deSetup();
    await t.post(`${base}/posiciones`, Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((p, i) => [`pos_${p}`, String(L['ABCDEF'[i]!])])), cookie);
    await win('U1', 'A'); await win('U2', 'D'); await win('U3', 'E'); await win('U4', 'F'); await win('U5', 'E');
    await win('L1', 'B'); await win('L2', 'A'); await win('L3', 'A'); await win('L4', 'A');
    await win('GF', 'A', 1); await win('GF', 'E', 2); await win('GF', 'A', 3);
    expect(stored('GF').winnerId).toBe(L.A);
    // change U1: B wins
    const r = await win('U1', 'B');
    expect(r.status).toBe(303);
    expect(stored('U1').winnerId).toBe(L.B);
    expect(stored('U2').winnerId).toBe(L.D);
    expect(stored('U4').winnerId).toBe(L.F);
    for (const k of ['U3', 'U5', 'L1', 'L2', 'L3', 'L4', 'GF'] as DeSlotKey[]) {
      expect(stored(k).winnerId, k).toBeNull();
      expect(t.repo.listGames(stored(k).id), k).toHaveLength(0);
    }
    expect([stored('U3').team1Id, stored('U3').team2Id]).toEqual([L.B, L.E]);
    // removing U2 result clears U4 (and its dependents)
    await t.post(`${base}/llave/U2/juego/1`, { action: 'clear' }, cookie);
    expect(stored('U4').winnerId).toBeNull();
    expect(stored('U1').winnerId).toBe(L.B);

    // Dota import on U3 (B vs E): B wins as radiant with the snapshot's numbers
    const imp = await t.post(`${base}/llave/U3/juego/1`, {
      action: 'save', winner: String(L.B), t1_kills: '42', t1_deaths: String(deaths('radiant')), t2_kills: '41', t2_deaths: String(deaths('dire')),
      dota_match_id: '9023462170', dota_winner: String(L.B),
    }, cookie);
    const impText = await flashText(t, imp, cookie);
    expect(impText).toContain('Resultado guardado');
    expect(t.repo.listGames(stored('U3').id)[0]).toMatchObject({ dotaMatchId: 9023462170, radiantTeamId: L.B });
    // match detail labels the series
    t.repo.setActiveTournament(tour.id);
    const det = await t.get(`/t/relampago/partido/${stored('U3').id}/detalle`);
    expect(det.status).toBe(200);
    expect(JSON.stringify(await det.json())).toContain('Superior');
    // live on L1 (A vs ? -> L1 = loser U1 (A) vs loser U4 (none) -> refused); live on U4 (F vs ?) refused; live on L2? use GF? use U2 (C vs D)
    const live = await t.post(`${base}/llave/U2/juego/1/en-vivo`, { action: 'mark' }, cookie);
    expect(await flashText(t, live, cookie)).toContain('Partida marcada en vivo');
    expect(t.repo.listLive(tour.id)).toHaveLength(1);
    const pub = await (await t.get('/t/relampago')).text();
    expect(pub).toMatch(/Superior · Ronda 1/);
  });
});

// ---------------------------------------------------------------- invariants on rejected commands
describe('rejected commands leave the DB untouched', () => {
  it('bad positions, league route on DE, DE route on league, archive active, delete rules', async () => {
    const { t, cookie, tour, base, L } = await deSetup();
    const league = t.repo.createTournament({ name: 'Liga', slug: 'liga' });
    t.repo.setActiveTournament(league.id);
    const lteams = ['A', 'B', 'C', 'D', 'E'].map((c) => t.repo.createTeam(league.id, { code: c, name: c }));
    t.repo.replaceScheduleDays(league.id, [{ date: '2026-10-03', phase: 'group', startTimes: ['14:00', '15:00', '16:00', '17:00', '18:00'], slotMinutes: 60 }]);
    regenerateFixture(t.repo, league);
    await t.post(`${base}/posiciones`, Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((p, i) => [`pos_${p}`, String(L['ABCDEF'[i]!])])), cookie);
    const results: Record<string, number> = {};
    const check = async (name: string, fn: () => Promise<Response>) => {
      const h = dbHash(t.db);
      const res = await fn();
      results[name] = res.status;
      expect(dbHash(t.db), name).toBe(h);
    };
    const pos = (ids: number[]) => Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((p, i) => [`pos_${p}`, String(ids[i])]));
    await check('dup positions', () => t.post(`${base}/posiciones`, pos([L.A!, L.A!, L.C!, L.D!, L.E!, L.F!]), cookie));
    await check('foreign team position', () => t.post(`${base}/posiciones`, pos([lteams[0]!.id, L.B!, L.C!, L.D!, L.E!, L.F!]), cookie));
    await check('missing position', () => t.post(`${base}/posiciones`, { pos_a: String(L.A) }, cookie));
    await check('league cruces on DE', () => t.post(`${base}/cruces`, { sf1_a: '1' }, cookie));
    await check('league semifinal on DE', () => t.post(`${base}/semifinal/1`, { action: 'save', winner: String(L.A) }, cookie));
    await check('league final live on DE', () => t.post(`${base}/final/1/juego/1/en-vivo`, { action: 'mark' }, cookie));
    await check('DE posiciones on league', () => t.post(`/admin/t/${league.id}/playoffs/posiciones`, pos(lteams.map((x) => x.id).concat(lteams[0]!.id)), cookie));
    await check('DE llave on league', () => t.post(`/admin/t/${league.id}/playoffs/llave/U1`, { action: 'save', winner: String(lteams[0]!.id) }, cookie));
    await check('unknown series key', () => t.post(`${base}/llave/U9`, { action: 'save', winner: String(L.A) }, cookie));
    await check('result with team not in series', () => t.post(`${base}/llave/U1`, { action: 'save', winner: String(L.C), t1_kills: '1', t1_deaths: '1', t2_kills: '1', t2_deaths: '1' }, cookie));
    await check('result on series without teams', () => t.post(`${base}/llave/U5`, { action: 'save', winner: String(L.A), t1_kills: '1', t1_deaths: '1', t2_kills: '1', t2_deaths: '1' }, cookie));
    await check('archive active', () => t.post(`/admin/t/${league.id}/archivar`, {}, cookie));
    await check('delete non archived', () => t.post(`/admin/t/${tour.id}/eliminar`, { confirm_name: 'Relámpago' }, cookie));
    t.repo.archiveTournament(tour.id);
    await check('activate archived', () => t.post(`/admin/t/${tour.id}/activar`, {}, cookie));
    await check('delete wrong name', () => t.post(`/admin/t/${tour.id}/eliminar`, { confirm_name: 'relampago' }, cookie));
    await check('delete empty name', () => t.post(`/admin/t/${tour.id}/eliminar`, {}, cookie));
    expect(results).toBeDefined();
  });

  it('refuses the league-only fixture commands and redirects their pages to Llaves', async () => {
    const { t, cookie, tour } = await deSetup();
    const h = dbHash(t.db);
    const r1 = await t.post(`/admin/t/${tour.id}/fixture/regenerar`, {}, cookie);
    const g1 = await t.get(`/admin/t/${tour.id}/fixture`, cookie);
    const g2 = await t.get(`/admin/t/${tour.id}/resultados`, cookie);
    const out = { regenerar: r1.status, groupMatches: t.repo.listMatches(tour.id, 'group').length, fixtureGet: g1.status, resultadosGet: g2.status, unchanged: dbHash(t.db) === h };
    expect(out).toEqual({ regenerar: 404, groupMatches: 0, fixtureGet: 303, resultadosGet: 303, unchanged: true });
  });
});

// ---------------------------------------------------------------- S8
describe('S8 archive / restore / delete', () => {
  it('full flow with images and a played DE bracket', async () => {
    const { t, cookie, store, tour, base, stored, L, win } = await deSetup();
    const league = t.repo.createTournament({ name: 'Liga', slug: 'liga' });
    t.repo.setActiveTournament(league.id);
    await t.post(`${base}/posiciones`, Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((p, i) => [`pos_${p}`, String(L['ABCDEF'[i]!])])), cookie);
    await win('U1', 'A'); await win('U2', 'D');
    await t.post(`${base}/llave/U3/juego/1/en-vivo`, { action: 'mark' }, cookie);
    await t.post(`${base}/llave/U3/juego/1/en-vivo`, { action: 'stream' }, cookie);
    t.repo.updateTeam(L.A!, { imageKey: `teams/${tour.id}/1-abc.webp` });
    for (const k of [`teams/${tour.id}/1-abc.webp`, `teams/${tour.id}/1-abc@2x.webp`]) await store.put(k, new Uint8Array([1]), 'image/webp', 'x');
    expect(t.repo.getTournamentById(tour.id)!.streamMatchId).toBe(stored('U3').id);

    // selector shows it before archive
    let sel = await (await t.get(`/admin/t/${league.id}/config`, cookie)).text();
    expect(sel).toContain('Relámpago');
    const ar = await t.post(`/admin/t/${tour.id}/archivar`, {}, cookie);
    expect(await flashText(t, ar, cookie)).toContain('archivado');
    sel = await (await t.get(`/admin/t/${league.id}/config`, cookie)).text();
    const selector = sel.slice(sel.indexOf('<select'), sel.indexOf('</select>'));
    expect(selector).not.toContain('Relámpago');
    const torneos = await (await t.get('/admin/torneos', cookie)).text();
    expect(torneos).toContain('Archivados');
    expect(torneos).toContain('Restaurar');
    expect((await t.get('/t/relampago')).status).toBe(200);
    // restore then archive again
    await t.post(`/admin/t/${tour.id}/restaurar`, {}, cookie);
    expect(t.repo.getTournamentById(tour.id)!.archivedAt).toBeNull();
    await t.post(`/admin/t/${tour.id}/archivar`, {}, cookie);
    // trimmed name? spec: exact name
    const del = await t.post(`/admin/t/${tour.id}/eliminar`, { confirm_name: 'Relámpago' }, cookie);
    expect(await flashText(t, del, cookie)).toContain('eliminado');
    expect(t.repo.getTournamentById(tour.id)).toBeUndefined();
    for (const tb of ['teams', 'matches', 'schedule_days', 'promo_banners']) {
      expect(t.db.prepare(`SELECT COUNT(*) FROM ${tb} WHERE tournament_id = ?`).pluck().get(tour.id), tb).toBe(0);
    }
    expect(t.db.prepare('SELECT COUNT(*) FROM match_games').pluck().get()).toBe(0);
    expect(store.keys()).toEqual([]);
    expect((await t.get('/t/relampago')).status).toBe(404);
    expect(t.repo.getTournamentById(league.id)).toBeDefined();
  });

  it('the currently viewed archived tournament pages still render', async () => {
    const { t, cookie, tour } = await deSetup();
    const league = t.repo.createTournament({ name: 'Liga', slug: 'liga' });
    t.repo.setActiveTournament(league.id);
    t.repo.archiveTournament(tour.id);
    const r = await t.get(`/admin/t/${tour.id}/playoffs`, cookie);
    expect(r.status).toBe(200);
  });
});
