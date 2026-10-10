import { createHash, randomBytes } from 'node:crypto';

/** SHA-256 hex of an observer token: the only form that is ever stored. */
export const hashObserverToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface NewObserverToken {
  /** Plaintext, shown to the admin once; never stored. */
  token: string;
  hash: string;
  /** First characters of the token, for display in the list. */
  prefix: string;
}

export function generateObserverToken(): NewObserverToken {
  const token = randomBytes(32).toString('hex');
  return { token, hash: hashObserverToken(token), prefix: token.slice(0, 6) };
}
