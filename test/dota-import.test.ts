import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatDuration, gameFromSnapshot, lookupDotaMatch, snapshotSummary } from '../src/dota/import.js';
import { mapOpenDotaMatch } from '../src/dota/opendota.js';
import { DotaLookupError, type DotaMatchSource } from '../src/dota/source.js';

const snapshot = mapOpenDotaMatch(JSON.parse(readFileSync(new URL('./fixtures/opendota-9023462170.json', import.meta.url), 'utf8')));
const T1 = 11;
const T2 = 22;
const deaths = (side: 'radiant' | 'dire') => snapshot.players.filter((p) => p.side === side).reduce((n, p) => n + p.deaths, 0);

describe('gameFromSnapshot', () => {
  it('team 1 was Radiant: Radiant won, so team 1 wins with the Radiant score as kills', () => {
    expect(gameFromSnapshot(snapshot, T1, T1, T2)).toEqual({
      winnerId: T1,
      team1Kills: 42,
      team1Deaths: deaths('radiant'),
      team2Kills: 41,
      team2Deaths: deaths('dire'),
    });
  });

  it('team 2 was Radiant: the sides swap onto the two teams', () => {
    expect(gameFromSnapshot(snapshot, T2, T1, T2)).toEqual({
      winnerId: T2,
      team1Kills: 41,
      team1Deaths: deaths('dire'),
      team2Kills: 42,
      team2Deaths: deaths('radiant'),
    });
  });

  it('a Dire win goes to whoever played Dire', () => {
    const direWin = { ...snapshot, radiantWin: false };
    expect(gameFromSnapshot(direWin, T1, T1, T2).winnerId).toBe(T2);
    expect(gameFromSnapshot(direWin, T2, T1, T2).winnerId).toBe(T1);
  });

  it('the stored numbers are the deaths of the players, which are also the other side kills', () => {
    const result = gameFromSnapshot(snapshot, T1, T1, T2);
    expect(result.team1Deaths).toBe(deaths('radiant'));
    expect(deaths('radiant')).toBe(snapshot.players.filter((p) => p.side === 'dire').reduce((n, p) => n + p.kills, 0));
  });
});

describe('snapshotSummary', () => {
  it('formats the duration as mm:ss and says who won', () => {
    expect(formatDuration(3966)).toBe('66:06');
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(600)).toBe('10:00');
    expect(formatDuration(-25)).toBe('−0:25');
    // no side names: the admin is asked who won, not who played Radiant; the winning score comes first
    expect(snapshotSummary(snapshot)).toBe('Partida encontrada · 66:06 · 42 – 41');
    expect(snapshotSummary({ ...snapshot, radiantWin: false })).toBe('Partida encontrada · 66:06 · 41 – 42');
    expect(snapshotSummary(snapshot)).not.toMatch(/Radiant|Dire/);
  });
});

describe('lookupDotaMatch', () => {
  const source = (behaviour: () => Promise<typeof snapshot>): DotaMatchSource => ({ fetch: behaviour });

  it('validates the id before asking anything', async () => {
    let asked = false;
    const result = await lookupDotaMatch(source(async () => ((asked = true), snapshot)), 'abc');
    expect(result).toEqual({ ok: false, error: 'El Match ID de Dota debe ser un número entero positivo (por ejemplo 9023462170).' });
    expect(asked).toBe(false);
  });

  it('returns the snapshot of a found match', async () => {
    const result = await lookupDotaMatch(source(async () => snapshot), ' 9023462170 ');
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.value.matchId).toBe(9023462170);
  });

  it('turns a failed lookup into its Spanish message, and never throws for it', async () => {
    const failing = source(async () => {
      throw new DotaLookupError('not_found', 'Partida no encontrada. Revisa el Match ID.');
    });
    expect(await lookupDotaMatch(failing, '1')).toEqual({ ok: false, error: 'Partida no encontrada. Revisa el Match ID.' });
  });

  it('an unexpected error becomes a generic message (and is not leaked)', async () => {
    const broken = source(async () => {
      throw new Error('secret internals');
    });
    expect(await lookupDotaMatch(broken, '1')).toEqual({ ok: false, error: 'No se pudo consultar la partida. Inténtalo de nuevo.' });
  });
});
