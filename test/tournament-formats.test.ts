import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { MIGRATIONS_DIR, openDatabase } from '../src/db/open.js';
import { createRepository } from '../src/db/repository.js';
import { FORMAT_INFO, TOURNAMENT_FORMATS, isTournamentFormat } from '../src/domain/formats.js';
import { describeStatus, loadState } from '../src/services/state.js';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('tournament formats', () => {
  it('lists the two formats with their names and descriptions', () => {
    expect(TOURNAMENT_FORMATS).toEqual(['league_playoffs', 'double_elimination']);
    expect(FORMAT_INFO.league_playoffs.name).toBe('Liga + Playoffs');
    expect(FORMAT_INFO.league_playoffs.description).toBe('Todos contra todos con tabla, luego semifinales y final con los 4 mejores.');
    expect(FORMAT_INFO.double_elimination.name).toBe('Doble eliminación');
    expect(FORMAT_INFO.double_elimination.description).toBe(
      'Llaves superior e inferior desde el inicio, posiciones asignadas a mano, gran final BO3.',
    );
    expect(isTournamentFormat('double_elimination')).toBe(true);
    expect(isTournamentFormat('swiss')).toBe(false);
  });
});

describe('016_tournament_format', () => {
  it('makes every existing tournament league_playoffs and keeps its settings', () => {
    dir = mkdtempSync(join(tmpdir(), 'mig-'));
    for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f < '016')) copyFileSync(join(MIGRATIONS_DIR, f), join(dir, f));
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db, dir);
    db.exec("INSERT INTO tournaments (name, slug, semifinal_games, final_games) VALUES ('Old', 'old', 3, 5)");
    migrate(db, MIGRATIONS_DIR);
    expect(db.pragma('user_version', { simple: true })).toBe(17);
    const repo = createRepository(db);
    expect(repo.getTournamentBySlug('old')).toMatchObject({ format: 'league_playoffs', semifinalGames: 3, finalGames: 5 });
  });
});

describe('creating a tournament with a format', () => {
  it('defaults to league_playoffs with the usual series lengths', () => {
    const repo = createRepository(openDatabase(':memory:'));
    expect(repo.createTournament({ name: 'Cup', slug: 'cup' })).toMatchObject({
      format: 'league_playoffs',
      groupGames: 1,
      semifinalGames: 3,
      finalGames: 5,
    });
  });

  it('creates a double elimination tournament with BO1 series and a BO3 grand final', () => {
    const repo = createRepository(openDatabase(':memory:'));
    const t = repo.createTournament({ name: 'Flash', slug: 'flash', format: 'double_elimination' });
    expect(t).toMatchObject({ format: 'double_elimination', semifinalGames: 1, finalGames: 3 });
    expect(repo.getTournamentById(t.id)?.format).toBe('double_elimination');
  });

  it('keeps the format when other settings are updated', () => {
    const repo = createRepository(openDatabase(':memory:'));
    const t = repo.createTournament({ name: 'Flash', slug: 'flash', format: 'double_elimination' });
    expect(repo.updateTournament(t.id, { name: 'Flash 2' }).format).toBe('double_elimination');
  });
});

describe('loadState for a double elimination tournament', () => {
  function setup() {
    const repo = createRepository(openDatabase(':memory:'));
    const t = repo.createTournament({ name: 'Flash', slug: 'flash', format: 'double_elimination' });
    const ids = ['A', 'B', 'C', 'D', 'E', 'F'].map((code) => repo.createTeam(t.id, { code, name: `Team ${code}` }).id);
    return { repo, t, ids };
  }

  it('builds the double elimination bracket and no league bracket', () => {
    const { repo, t, ids } = setup();
    repo.createMatch({ tournamentId: t.id, phase: 'semifinal', round: 1, matchNumber: 1, team1Id: ids[0], team2Id: ids[1] });
    const state = loadState(repo, t);
    expect(state.doubleElimination?.positions).toMatchObject({ A: ids[0], B: ids[1], C: null });
    expect(state.bracket.semifinals.every((s) => s.team1Id === null && s.team2Id === null)).toBe(true);
    expect(state.bracket.championId).toBeNull();
    expect(describeStatus(state)).toEqual({ label: 'Llaves', cls: 'next' });
  });

  it('reports "Sin posiciones" before any team is placed', () => {
    const { repo, t } = setup();
    expect(describeStatus(loadState(repo, t))).toEqual({ label: 'Sin posiciones', cls: '' });
  });

  it('has no double elimination bracket for a league tournament', () => {
    const repo = createRepository(openDatabase(':memory:'));
    const t = repo.createTournament({ name: 'Cup', slug: 'cup' });
    expect(loadState(repo, t).doubleElimination).toBeNull();
    expect(describeStatus(loadState(repo, t))).toEqual({ label: 'Sin fixture', cls: '' });
  });
});
