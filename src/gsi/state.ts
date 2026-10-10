export type CaptureState = 'live' | 'final' | 'incomplete';

/** A capture that is not final and has not been updated for this long is taken as abandoned (the observer left or crashed). */
export const INCOMPLETE_AFTER_MS = 5 * 60 * 1000;

/** SQLite 'YYYY-MM-DD HH:MM:SS' (UTC) to a Date; an unreadable value is an invalid Date. */
export const parseSqliteUtc = (value: string): Date => new Date(`${value.replace(' ', 'T')}Z`);

export function captureStateOf(capture: { isFinal: boolean; updatedAt: string }, now: Date): CaptureState {
  if (capture.isFinal) return 'final';
  const age = now.getTime() - parseSqliteUtc(capture.updatedAt).getTime();
  return age <= INCOMPLETE_AFTER_MS ? 'live' : 'incomplete';
}
