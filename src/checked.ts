/** Result of a validation step: a value or a Spanish, user-facing error message. */
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

export const ok = <T>(value: T): Checked<T> => ({ ok: true, value });
export const fail = (error: string): Checked<never> => ({ ok: false, error });
