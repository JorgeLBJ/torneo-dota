import { fail, ok, type Checked } from '../checked.js';
import type { MatchResult } from '../db/repository.js';

export interface RawResult {
  winner: string;
  t1Kills: string;
  t1Deaths: string;
  t2Kills: string;
  t2Deaths: string;
}

const MAX_STAT = 999;

const stat = (value: string): number | null => {
  if (!/^\d{1,3}$/.test(value)) return null;
  const n = Number(value);
  return n <= MAX_STAT ? n : null;
};

/** Validates a submitted result against the two teams of the match. */
export function validateResult(teams: [number | null, number | null], raw: RawResult): Checked<MatchResult> {
  const [team1, team2] = teams;
  if (team1 === null || team2 === null) return fail('El partido todavía no tiene los dos equipos definidos.');
  const winner = /^\d+$/.test(raw.winner) ? Number(raw.winner) : null;
  if (winner === null || (winner !== team1 && winner !== team2)) return fail('Elige el equipo ganador.');
  const values = [raw.t1Kills, raw.t1Deaths, raw.t2Kills, raw.t2Deaths].map(stat);
  if (values.some((v) => v === null)) {
    return fail('Carga kills y deaths de ambos equipos como números enteros entre 0 y 999.');
  }
  const [team1Kills, team1Deaths, team2Kills, team2Deaths] = values as number[];
  return ok({
    winnerId: winner,
    team1Kills: team1Kills!,
    team1Deaths: team1Deaths!,
    team2Kills: team2Kills!,
    team2Deaths: team2Deaths!,
  });
}
