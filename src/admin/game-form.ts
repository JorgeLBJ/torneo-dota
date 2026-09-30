import type { Game } from '../db/repository.js';
import type { DotaMatchSource } from '../dota/source.js';
import { prepareGameImport } from '../services/games.js';
import type { ImportChoice } from '../services/games.js';
import type { RawResult } from '../services/results.js';
import { fail, ok, type Checked } from '../checked.js';
import type { Body } from './form.js';
import { str } from './form.js';

export interface GameFormInput {
  raw: RawResult;
  imported: ImportChoice;
}

/** A game number from the URL or the form: 1 to 5, otherwise null. */
export function parseGameNumber(value: string | undefined): number | null {
  return value !== undefined && /^[1-5]$/.test(value) ? Number(value) : null;
}

/**
 * Reads one game's form: the result fields plus the optional Dota import. A game that was already imported and
 * whose Match ID is untouched keeps its import without asking the provider again (as long as the numbers are the same).
 */
export async function readGameForm(
  source: DotaMatchSource,
  teams: [number | null, number | null],
  body: Body,
  existing: Game | undefined,
): Promise<Checked<GameFormInput>> {
  const raw: RawResult = {
    winner: str(body, 'winner'),
    t1Kills: str(body, 't1_kills'),
    t1Deaths: str(body, 't1_deaths'),
    t2Kills: str(body, 't2_kills'),
    t2Deaths: str(body, 't2_deaths'),
  };
  const typedId = str(body, 'dota_match_id');
  const typedRadiant = str(body, 'dota_radiant');
  // Untouched: same Match ID and the same Radiant team (or none chosen). A different Radiant team is a new import
  // and has to produce the submitted numbers, so it goes through the full check instead of being ignored.
  const untouched =
    str(body, 'dota_keep') === '1' &&
    existing?.dotaMatchId != null &&
    String(existing.dotaMatchId) === typedId &&
    (typedRadiant === '' || typedRadiant === String(existing.radiantTeamId));
  const imported = await prepareGameImport(source, teams, raw, {
    dotaMatchId: untouched ? '' : typedId,
    radiant: typedRadiant,
    keep: untouched,
  });
  if (!imported.ok) return fail(imported.error);
  return ok({ raw, imported: imported.value });
}
