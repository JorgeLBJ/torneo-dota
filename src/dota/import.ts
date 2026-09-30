import { fail, ok, type Checked } from '../checked.js';
import type { MatchResult } from '../db/repository.js';
import { parseDotaMatchId } from './opendota.js';
import type { DotaSnapshot } from './snapshot.js';
import { DotaLookupError, type DotaMatchSource } from './source.js';

/** mm:ss (minutes are not wrapped into hours: Dota games are read as "66:06"). */
export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** "Partida encontrada · 66:06 · Radiant ganó 42 – 41" */
export function snapshotSummary(snapshot: DotaSnapshot): string {
  const winner = snapshot.radiantWin ? 'Radiant' : 'Dire';
  const scores = snapshot.radiantWin ? `${snapshot.radiantScore} – ${snapshot.direScore}` : `${snapshot.direScore} – ${snapshot.radiantScore}`;
  return `Partida encontrada · ${formatDuration(snapshot.durationSec)} · ${winner} ganó ${scores}`;
}

/**
 * The game result an import fills in: the winner is whoever played the winning side; kills are the side scores;
 * deaths are the sum of the deaths of that side's players.
 */
export function gameFromSnapshot(snapshot: DotaSnapshot, radiantTeamId: number, team1Id: number, team2Id: number): MatchResult {
  const team1IsRadiant = radiantTeamId === team1Id;
  const deathsOf = (side: 'radiant' | 'dire') => snapshot.players.filter((p) => p.side === side).reduce((sum, p) => sum + p.deaths, 0);
  const side1 = team1IsRadiant ? 'radiant' : 'dire';
  const side2 = team1IsRadiant ? 'dire' : 'radiant';
  const scoreOf = (side: 'radiant' | 'dire') => (side === 'radiant' ? snapshot.radiantScore : snapshot.direScore);
  const winningSide = snapshot.radiantWin ? 'radiant' : 'dire';
  return {
    winnerId: winningSide === side1 ? team1Id : team2Id,
    team1Kills: scoreOf(side1),
    team1Deaths: deathsOf(side1),
    team2Kills: scoreOf(side2),
    team2Deaths: deathsOf(side2),
  };
}

/** Looks a Dota match up for the admin: validates the id, and turns every failure into a Spanish message. */
export async function lookupDotaMatch(source: DotaMatchSource, rawId: string): Promise<Checked<DotaSnapshot>> {
  const id = parseDotaMatchId(rawId);
  if (!id.ok) return id;
  try {
    return ok(await source.fetch(id.value));
  } catch (error) {
    if (error instanceof DotaLookupError) return fail(error.message);
    console.error(`Dota lookup failed: ${(error as Error).message}`);
    return fail('No se pudo consultar la partida. Inténtalo de nuevo.');
  }
}
