import { describe, expect, it } from 'vitest';
import { liveEligibility } from '../src/domain/live.js';
import type { GameScore } from '../src/domain/series.js';

const A = 10;
const B = 20;
const game = (gameNumber: number, winnerId: number): GameScore => ({ gameNumber, winnerId, team1Kills: 1, team1Deaths: 1, team2Kills: 1, team2Deaths: 1 });

describe('liveEligibility: which game of a match can be marked as live', () => {
  it('the first game of a fresh best of 1 and of a best of 3', () => {
    expect(liveEligibility(A, B, 1, [], 1)).toBeNull();
    expect(liveEligibility(A, B, 3, [], 1)).toBeNull();
  });

  it('needs both teams', () => {
    const message = 'El partido todavía no tiene los dos equipos definidos.';
    expect(liveEligibility(A, null, 3, [], 1)).toBe(message);
    expect(liveEligibility(null, B, 3, [], 1)).toBe(message);
    expect(liveEligibility(null, null, 1, [], 1)).toBe(message);
  });

  it('only the next unplayed game of the series', () => {
    const games = [game(1, A)];
    expect(liveEligibility(A, B, 3, games, 2)).toBeNull();
    expect(liveEligibility(A, B, 3, games, 3)).toBe('Marca primero el juego 2: los juegos se juegan en orden.');
    expect(liveEligibility(A, B, 5, [game(1, A), game(2, B)], 3)).toBeNull();
  });

  it('never a game that already has a result', () => {
    expect(liveEligibility(A, B, 3, [game(1, A)], 1)).toBe('Ese juego ya tiene resultado.');
    expect(liveEligibility(A, B, 1, [game(1, B)], 1)).toBe('Ese juego ya tiene resultado.');
  });

  it('never after the series was decided', () => {
    expect(liveEligibility(A, B, 3, [game(1, A), game(2, A)], 3)).toBe('La serie ya está decidida.');
    expect(liveEligibility(A, B, 5, [game(1, B), game(2, B), game(3, B)], 4)).toBe('La serie ya está decidida.');
  });

  it('never a game outside the series length', () => {
    expect(liveEligibility(A, B, 1, [], 2)).toBe('Ese juego no existe.');
    expect(liveEligibility(A, B, 3, [], 0)).toBe('Ese juego no existe.');
    expect(liveEligibility(A, B, 3, [], 4)).toBe('Ese juego no existe.');
  });
});
