import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/open.js';
import { createRepository, type Repository, type Team, type Tournament } from '../src/db/repository.js';
import { buildPublicModel } from '../src/public/model.js';
import { NO_TOURNAMENT_SHARE, buildShare } from '../src/public/share.js';
import { regenerateFixture } from '../src/services/fixture.js';
import { recordPlayoffResult } from '../src/services/playoffs.js';
import { loadState } from '../src/services/state.js';

let db: Database.Database;
let repo: Repository;
let tournament: Tournament;
let teams: Team[];

const BEFORE = new Date('2026-09-30T12:00:00Z');
const current = () => repo.getTournamentById(tournament.id)!;
const model = (now: Date = BEFORE) => buildPublicModel(loadState(repo, current()), repo.listScheduleDays(tournament.id), { now });
const share = (now: Date = BEFORE) => buildShare(model(now));

const win = (matchId: number, winnerId: number, kills = 20) =>
  repo.recordResult(matchId, { winnerId, team1Kills: kills, team1Deaths: 10, team2Kills: 10, team2Deaths: kills });
const finishGroups = () => {
  for (const m of repo.listMatches(tournament.id, 'group')) win(m.id, m.team1Id!, 20 + m.matchNumber);
};
const playoff = (phase: 'semifinal' | 'final', number: number, winnerId: number) => {
  const r = recordPlayoffResult(repo, current(), loadState(repo, current()), phase, number, {
    winner: String(winnerId),
    t1Kills: '10',
    t1Deaths: '5',
    t2Kills: '5',
    t2Deaths: '10',
  });
  expect(r.ok).toBe(true);
};
const decideSemis = () => {
  const m = model();
  for (const [i, sf] of m.bracket.semifinals.entries()) playoff('semifinal', i + 1, sf.slots[0]!.team!.id);
};

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = createRepository(db);
  tournament = repo.createTournament({ name: 'Copa Octubre', slug: 'copa' });
  // These tests are about the bracket, not about series: playoffs are single games here.
  tournament = repo.updateTournament(tournament.id, { semifinalGames: 1, finalGames: 1 });
  teams = ['Tigres', 'Lobos', 'Cuervos', 'Halcones'].map((name, i) => repo.createTeam(tournament.id, { code: `T${i + 1}`, name }));
  repo.replaceScheduleDays(tournament.id, [
    { date: '2026-10-03', phase: 'group', startTimes: ['14:00', '15:00', '16:00'], slotMinutes: 60 },
    { date: '2026-10-11', phase: 'semifinal', startTimes: ['14:00', '15:00'], slotMinutes: 60 },
    { date: '2026-10-17', phase: 'final', startTimes: ['14:00'], slotMinutes: 60 },
  ]);
  regenerateFixture(repo, tournament);
});
afterEach(() => db.close());

describe('group stage', () => {
  it('before any result: progress and the start date, no leader', () => {
    expect(share()).toEqual({
      title: 'Copa Octubre · Torneo de Dota 2',
      description: 'Fase de grupos · 0/6 partidos · Empieza el 03 Oct',
    });
  });

  it('with results: progress, leader with points, and the semifinal date', () => {
    const first = repo.listMatches(tournament.id, 'group')[0]!;
    win(first.id, first.team1Id!);
    const leader = repo.getTeam(first.team1Id!)!.name;
    expect(share()).toEqual({
      title: 'Copa Octubre · Torneo de Dota 2',
      description: `Fase de grupos · 1/6 partidos · Líder: ${leader} (1 pt) · Semis el 11 Oct`,
    });
  });

  it('leaves out what is unknown (no calendar, no fixture)', () => {
    for (const m of repo.listMatches(tournament.id, 'group').slice(0, 2)) win(m.id, m.team1Id!);
    repo.replaceScheduleDays(tournament.id, []);
    const s = share();
    expect(s.description).toMatch(/^Fase de grupos · 2\/6 partidos · Líder: .+ \([12] pts?\)$/);
    expect(s.description).not.toContain('Semis');
    repo.replaceGroupMatches(tournament.id, []);
    expect(share().description).toBe('Fase de grupos');
  });
});

describe('a match is live and a stream is set', () => {
  const LIVE = new Date('2026-10-03T19:30:00Z'); // 14:30 in Lima: round 1

  it('puts the live marker in the title and points to the platform', () => {
    repo.updateTournament(tournament.id, { streamUrl: 'https://kick.com/mychannel' });
    expect(share(LIVE)).toEqual({
      title: '🔴 EN VIVO · Copa Octubre · Torneo de Dota 2',
      description: 'Ronda 1 en juego · Míralo en vivo en Kick',
    });
    repo.updateTournament(tournament.id, { streamUrl: 'https://www.twitch.tv/some_channel' });
    expect(share(LIVE).description).toBe('Ronda 1 en juego · Míralo en vivo en Twitch');
    repo.updateTournament(tournament.id, { streamUrl: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(share(LIVE).description).toBe('Ronda 1 en juego · Míralo en vivo en YouTube');
  });

  it('keeps the normal text when a stream is set but nothing is live', () => {
    repo.updateTournament(tournament.id, { streamUrl: 'https://kick.com/mychannel' });
    expect(share(BEFORE).title).toBe('Copa Octubre · Torneo de Dota 2');
    expect(share(new Date('2026-10-03T23:30:00Z')).title).not.toContain('EN VIVO');
  });

  it('keeps the normal text when a match is live but there is no stream', () => {
    expect(share(LIVE).title).toBe('Copa Octubre · Torneo de Dota 2');
  });
});

describe('playoffs', () => {
  it('semifinals: both matchups and the final date', () => {
    finishGroups();
    const s = share();
    expect(s.title).toBe('Copa Octubre · Semifinales');
    expect(s.description).toMatch(/^.+ vs .+ · .+ vs .+ · Final el 17 Oct$/);
    for (const team of teams) expect(s.description).toContain(team.name);
  });

  it('once both finalists are known and the final is pending', () => {
    finishGroups();
    decideSemis();
    const s = share();
    expect(s.title).toBe('Copa Octubre · Gran final');
    expect(s.description).toMatch(/^.+ vs .+ · 17 Oct$/);
  });

  it('keeps the semifinal wording while only one semifinal is decided', () => {
    finishGroups();
    playoff('semifinal', 1, model().bracket.semifinals[0]!.slots[0]!.team!.id);
    expect(share().title).toBe('Copa Octubre · Semifinales');
  });

  it('reads dates in the tournament zone, not UTC', () => {
    finishGroups();
    // 23:30 in Lima on 17 Oct is 04:30Z on 18 Oct.
    repo.replaceScheduleDays(tournament.id, [
      { date: '2026-10-03', phase: 'group', startTimes: ['14:00', '15:00', '16:00'], slotMinutes: 60 },
      { date: '2026-10-11', phase: 'semifinal', startTimes: ['14:00', '15:00'], slotMinutes: 60 },
      { date: '2026-10-17', phase: 'final', startTimes: ['23:30'], slotMinutes: 60 },
    ]);
    expect(share().description).toContain('Final el 17 Oct');
  });
});

describe('finished', () => {
  it('announces the champion and who they beat', () => {
    finishGroups();
    decideSemis();
    const finalists = model().bracket.final.slots.map((s) => s.team!);
    playoff('final', 1, finalists[0]!.id);
    expect(share()).toEqual({
      title: `Copa Octubre · 🏆 Campeón: ${finalists[0]!.name}`,
      description: `${finalists[0]!.name} venció a ${finalists[1]!.name} en la gran final`,
    });
  });
});

describe('no tournament, and limits', () => {
  it('has fixed copy when nothing is active', () => {
    expect(buildShare(null)).toEqual({
      title: 'Torneos de Dota 2 · jpsolutions',
      description: 'Próximamente: fixture, tabla en vivo y playoffs',
    });
    expect(NO_TOURNAMENT_SHARE.title).toBe('Torneos de Dota 2 · jpsolutions');
  });

  it('keeps the title on one clean line', () => {
    repo.updateTournament(tournament.id, { name: '  Copa\n  con   espacios\t raros ' });
    expect(share().title).toBe('Copa con espacios raros · Torneo de Dota 2');
  });

  it('truncates an over-long description with an ellipsis, within 200 characters', () => {
    const base = model();
    const long = Array.from({ length: 30 }, (_, i) => `Equipo${i}`).join(' ');
    const s = buildShare({ ...base, stream: { platform: 'kick', label: long, embedUrl: 'x', openUrl: 'x' }, days: base.days.map((d) => ({ ...d, rounds: d.rounds.map((r) => ({ ...r, status: 'live' as const })) })) });
    expect(s.description.length).toBeLessThanOrEqual(200);
    expect(s.description.endsWith('…')).toBe(true);
  });
});
