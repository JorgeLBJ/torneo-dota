import type { GsiCapture, Repository } from '../db/repository.js';
import { NOT_FINISHED_MESSAGE, mapGsiState } from './gsi.js';
import type { DotaSnapshot } from './snapshot.js';
import { DotaLookupError, type DotaMatchSource } from './source.js';

/**
 * Looks in the matches our observers captured (Game State Integration) before asking the outside source:
 * tournament games are private lobbies that OpenDota cannot return. A final capture is answered from our own data,
 * one that has not ended is reported as such, and a match nobody captured goes to `inner`.
 */
export class CapturedDotaSource implements DotaMatchSource {
  constructor(
    private readonly repo: Pick<Repository, 'getGsiCapture'>,
    private readonly inner: DotaMatchSource,
  ) {}

  async fetch(matchId: number): Promise<DotaSnapshot> {
    const capture = this.repo.getGsiCapture(matchId);
    if (!capture) return this.inner.fetch(matchId);
    return snapshotFromCapture(capture);
  }
}

/** The snapshot of a final capture; throws a DotaLookupError (Spanish message) when it is not final or cannot be read. */
export function snapshotFromCapture(capture: GsiCapture): DotaSnapshot {
  if (!capture.isFinal) throw new DotaLookupError('incomplete', NOT_FINISHED_MESSAGE);
  let state: unknown;
  try {
    state = JSON.parse(capture.stateJson);
  } catch {
    throw new DotaLookupError('incomplete', 'La captura guardada de la partida no se pudo leer.');
  }
  // first_received_at is UTC 'YYYY-MM-DD HH:MM:SS'; the start of the match is approximated by it.
  const startTime = Math.floor(Date.parse(`${capture.firstReceivedAt.replace(' ', 'T')}Z`) / 1000) || 0;
  return { ...mapGsiState(state, { startTime }), matchId: capture.dotaMatchId };
}
