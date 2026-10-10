import { EventEmitter } from 'node:events';

/** In-process bus. The public site (SSE) subscribes to `tournament:<id>:changed`. */
export function createEvents() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const CAPTURES = 'captures:changed';
  const ANY ='tournament:any:changed';
  const name = (tournamentId: number) => `tournament:${tournamentId}:changed`;
  return {
    emitter,
    tournamentChanged(tournamentId: number): void {
      emitter.emit(name(tournamentId), tournamentId);
      emitter.emit(ANY, tournamentId);
    },
    /** Fires for every tournament; used by the site root, which follows whichever tournament is active. */
    onAnyChanged(listener: (tournamentId: number) => void): () => void {
      emitter.on(ANY, listener);
      return () => emitter.off(ANY, listener);
    },
    /** A GSI capture was stored, updated or deleted, or a game changed which capture it uses. */
    capturesChanged(): void {
      emitter.emit(CAPTURES);
    },
    /** Returns an unsubscribe function. */
    onCapturesChanged(listener: () => void): () => void {
      emitter.on(CAPTURES, listener);
      return () => emitter.off(CAPTURES, listener);
    },
    /** Returns an unsubscribe function. */
    onTournamentChanged(tournamentId: number, listener: () => void): () => void {
      emitter.on(name(tournamentId), listener);
      return () => emitter.off(name(tournamentId), listener);
    },
  };
}

export type Events = ReturnType<typeof createEvents>;
