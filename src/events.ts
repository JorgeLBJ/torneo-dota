import { EventEmitter } from 'node:events';

/** In-process bus. The public site (SSE) subscribes to `tournament:<id>:changed`. */
export function createEvents() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const name = (tournamentId: number) => `tournament:${tournamentId}:changed`;
  return {
    emitter,
    tournamentChanged(tournamentId: number): void {
      emitter.emit(name(tournamentId), tournamentId);
    },
    /** Returns an unsubscribe function. */
    onTournamentChanged(tournamentId: number, listener: () => void): () => void {
      emitter.on(name(tournamentId), listener);
      return () => emitter.off(name(tournamentId), listener);
    },
  };
}

export type Events = ReturnType<typeof createEvents>;
