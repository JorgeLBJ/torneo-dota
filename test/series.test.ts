import { describe, expect, it } from 'vitest';
import { resolveSeries, seriesLengthFor, validateSeries, winsNeeded, type GameScore } from '../src/domain/series.js';

const A = 10;
const B = 20;
const game = (gameNumber: number, winnerId: number, extra: Partial<GameScore> = {}): GameScore => ({
  gameNumber,
  winnerId,
  team1Kills: 20,
  team1Deaths: 10,
  team2Kills: 10,
  team2Deaths: 20,
  ...extra,
});

describe('winsNeeded', () => {
  it('is the first to ceil(n / 2): 1, 2 and 3 for best of 1, 3 and 5', () => {
    expect([1, 3, 5].map(winsNeeded)).toEqual([1, 2, 3]);
  });
});

describe('resolveSeries', () => {
  it('best of 1 is decided by its only game, exactly like a plain match', () => {
    const state = resolveSeries(A, B, 1, [game(1, B)]);
    expect(state).toMatchObject({ wins: [0, 1], winnerId: B, decided: true, nextGame: null });
  });

  it('no games: nothing decided, game 1 is next, no totals', () => {
    expect(resolveSeries(A, B, 3, [])).toEqual({
      length: 3,
      needed: 2,
      wins: [0, 0],
      winnerId: null,
      decided: false,
      nextGame: 1,
      totals: null,
    });
  });

  it('best of 3: first to two wins, 2-0 and 2-1', () => {
    expect(resolveSeries(A, B, 3, [game(1, A), game(2, A)])).toMatchObject({ wins: [2, 0], winnerId: A, decided: true, nextGame: null });
    const tied = resolveSeries(A, B, 3, [game(1, A), game(2, B)]);
    expect(tied).toMatchObject({ wins: [1, 1], winnerId: null, decided: false, nextGame: 3 });
    expect(resolveSeries(A, B, 3, [game(1, A), game(2, B), game(3, B)])).toMatchObject({ wins: [1, 2], winnerId: B, decided: true });
  });

  it('best of 5: first to three wins, never before', () => {
    expect(resolveSeries(A, B, 5, [game(1, A), game(2, A)])).toMatchObject({ winnerId: null, decided: false, nextGame: 3 });
    expect(resolveSeries(A, B, 5, [game(1, A), game(2, B), game(3, A), game(4, B)])).toMatchObject({ wins: [2, 2], winnerId: null, nextGame: 5 });
    expect(resolveSeries(A, B, 5, [game(1, A), game(2, B), game(3, A), game(4, B), game(5, A)])).toMatchObject({ wins: [3, 2], winnerId: A });
  });

  it('kills and deaths are summed over the games, per team', () => {
    const state = resolveSeries(A, B, 3, [
      game(1, A, { team1Kills: 30, team1Deaths: 12, team2Kills: 12, team2Deaths: 30 }),
      game(2, B, { team1Kills: 5, team1Deaths: 25, team2Kills: 25, team2Deaths: 5 }),
    ]);
    expect(state.totals).toEqual({ team1Kills: 35, team1Deaths: 37, team2Kills: 37, team2Deaths: 35 });
  });

  it('the order of the list does not matter', () => {
    expect(resolveSeries(A, B, 3, [game(2, A), game(1, A)])).toMatchObject({ winnerId: A, wins: [2, 0] });
  });
});

describe('validateSeries', () => {
  const ok = (length: 1 | 3 | 5, games: GameScore[]) => validateSeries(A, B, length, games);

  it('accepts empty, partial and complete series', () => {
    expect(ok(3, [])).toBeNull();
    expect(ok(3, [game(1, A)])).toBeNull();
    expect(ok(3, [game(1, A), game(2, B), game(3, A)])).toBeNull();
    expect(ok(1, [game(1, A)])).toBeNull();
  });

  it('rejects a game after the decider', () => {
    expect(ok(3, [game(1, A), game(2, A), game(3, B)])).toBe('La serie ya estaba decidida: el juego 3 sobra.');
    expect(ok(1, [game(1, A), game(2, B)])).toBe('El juego 2 no existe en una serie al mejor de 1.');
  });

  it('rejects a game beyond the series length', () => {
    expect(ok(3, [game(1, A), game(2, B), game(3, A), game(4, B)])).toBe('El juego 4 no existe en una serie al mejor de 3.');
  });

  it('rejects gaps: a game needs the previous ones', () => {
    expect(ok(3, [game(2, A)])).toBe('Carga los juegos en orden: falta el juego 1.');
    expect(ok(5, [game(1, A), game(3, B)])).toBe('Carga los juegos en orden: falta el juego 2.');
  });

  it('rejects duplicate game numbers and winners that are not in the match', () => {
    expect(ok(3, [game(1, A), game(1, B)])).toBe('El juego 1 está repetido.');
    expect(ok(3, [game(1, 99)])).toBe('El ganador del juego 1 no juega este partido.');
  });

  it('changing an earlier game so the series ends sooner exposes the later game as too many', () => {
    // 1-1 then 2-1 was fine; making game 2 a win for A decides the series at game 2
    expect(ok(3, [game(1, A), game(2, A), game(3, B)])).toContain('sobra');
  });
});

describe('seriesLengthFor', () => {
  const lengths = { groupGames: 1, semifinalGames: 3, finalGames: 5 } as const;
  it('reads the length of the phase from the tournament', () => {
    expect(seriesLengthFor(lengths, 'group', false)).toBe(1);
    expect(seriesLengthFor(lengths, 'semifinal', false)).toBe(3);
    expect(seriesLengthFor(lengths, 'final', false)).toBe(5);
    expect(seriesLengthFor({ ...lengths, groupGames: 3 }, 'group', false)).toBe(3);
  });

  it('extra tiebreak games are always a single game', () => {
    expect(seriesLengthFor({ ...lengths, groupGames: 5 }, 'group', true)).toBe(1);
  });
});
