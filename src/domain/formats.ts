import type { SeriesLength } from './series.js';

export const TOURNAMENT_FORMATS = ['league_playoffs', 'double_elimination'] as const;
export type TournamentFormat = (typeof TOURNAMENT_FORMATS)[number];

export interface FormatInfo {
  key: TournamentFormat;
  name: string;
  description: string;
}

export const FORMAT_INFO: Record<TournamentFormat, FormatInfo> = {
  league_playoffs: {
    key: 'league_playoffs',
    name: 'Liga + Playoffs',
    description: 'Todos contra todos con tabla, luego semifinales y final con los 4 mejores.',
  },
  double_elimination: {
    key: 'double_elimination',
    name: 'Doble eliminación',
    description: 'Llaves superior e inferior desde el inicio, posiciones asignadas a mano, gran final BO3.',
  },
};

export const isTournamentFormat = (value: unknown): value is TournamentFormat =>
  typeof value === 'string' && (TOURNAMENT_FORMATS as readonly string[]).includes(value);

/**
 * Series lengths a new tournament starts with. Double elimination stores its bracket series as semifinals and its
 * grand final as the final (see domain/double-elimination.ts): every series best of 1, the grand final best of 3.
 */
export function initialSeriesLengths(format: TournamentFormat): { semifinalGames: SeriesLength; finalGames: SeriesLength } {
  return format === 'double_elimination' ? { semifinalGames: 1, finalGames: 3 } : { semifinalGames: 3, finalGames: 5 };
}
