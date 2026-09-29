// Seeds the current tournament (Torneo All vs All, October 2026) with the stakeholder's exact fixture.
// Usage: npm run seed:oct2026   (uses DATABASE_PATH like the server; safe to run twice)
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/db/open.js';
import { createRepository, type Repository } from '../src/db/repository.js';
import { addMinutes } from '../src/domain/fixture.js';

export const SLUG = 'torneo-oct-2026';
const SLOT_MINUTES = 60;
const TEAM_CODES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;

// The Google Sheet's fixture, in match-number order. Never regenerate it: the sheet is the source of truth.
const ROUNDS: { date: string; time: string; pairs: [string, string][] }[] = [
  { date: '2026-10-03', time: '14:00', pairs: [['A', 'B'], ['C', 'D'], ['E', 'F']] }, // bye G
  { date: '2026-10-03', time: '15:00', pairs: [['B', 'G'], ['C', 'F'], ['D', 'E']] }, // bye A
  { date: '2026-10-03', time: '16:00', pairs: [['A', 'E'], ['C', 'G'], ['D', 'F']] }, // bye B
  { date: '2026-10-03', time: '17:00', pairs: [['A', 'F'], ['B', 'E'], ['D', 'G']] }, // bye C
  { date: '2026-10-10', time: '14:00', pairs: [['A', 'G'], ['B', 'F'], ['C', 'E']] }, // bye D
  { date: '2026-10-10', time: '15:00', pairs: [['A', 'D'], ['B', 'C'], ['F', 'G']] }, // bye E
  { date: '2026-10-10', time: '16:00', pairs: [['A', 'C'], ['B', 'D'], ['E', 'G']] }, // bye F
];

export interface SeedResult {
  created: boolean;
  tournamentId: number;
}

/** Creates the tournament through the repository layer. Does nothing when the slug already exists. */
export function seedOctober2026(repo: Repository): SeedResult {
  const existing = repo.getTournamentBySlug(SLUG);
  if (existing) return { created: false, tournamentId: existing.id };

  const tournament = repo.createTournament({ name: 'Torneo All vs All · Oct 2026', slug: SLUG, qualifiers: 4 });
  try {
    repo.updateTournament(tournament.id, {
      game: 'Dota 2',
      pointsWin: 1,
      pointsLoss: 0,
      tiebreakers: ['kd', 'kills'],
      groupLegs: 1,
    });

    const teams = new Map(
      TEAM_CODES.map((code) => [code, repo.createTeam(tournament.id, { code, name: `Equipo ${code}` }).id] as const),
    );

    repo.replaceScheduleDays(tournament.id, [
      { date: '2026-10-03', phase: 'group', startTimes: ['14:00', '15:00', '16:00', '17:00'], slotMinutes: SLOT_MINUTES },
      { date: '2026-10-10', phase: 'group', startTimes: ['14:00', '15:00', '16:00'], slotMinutes: SLOT_MINUTES },
      { date: '2026-10-11', phase: 'semifinal', startTimes: ['14:00', '15:00'], slotMinutes: SLOT_MINUTES },
      { date: '2026-10-17', phase: 'final', startTimes: ['14:00'], slotMinutes: SLOT_MINUTES },
    ]);

    let matchNumber = 0;
    repo.insertMatches(
      ROUNDS.flatMap((round, index) =>
        round.pairs.map(([a, b]) => ({
          tournamentId: tournament.id,
          phase: 'group' as const,
          round: index + 1,
          matchNumber: ++matchNumber,
          scheduledDate: round.date,
          startTime: round.time,
          endTime: addMinutes(round.time, SLOT_MINUTES),
          team1Id: teams.get(a as (typeof TEAM_CODES)[number])!,
          team2Id: teams.get(b as (typeof TEAM_CODES)[number])!,
        })),
      ),
    );

    repo.setActiveTournament(tournament.id);
  } catch (error) {
    // Leave nothing half-seeded behind: a retry would otherwise see the slug and refuse to run.
    repo.deleteTournament(tournament.id);
    throw error;
  }
  return { created: true, tournamentId: tournament.id };
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const databasePath = resolve(process.env.DATABASE_PATH ?? './data/torneos.db');
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = openDatabase(databasePath);
  try {
    const result = seedOctober2026(createRepository(db));
    console.log(
      result.created
        ? `Seeded "${SLUG}" (7 teams, 21 matches) and set it active in ${databasePath}`
        : `"${SLUG}" already exists in ${databasePath}; nothing changed`,
    );
  } finally {
    db.close();
  }
}
