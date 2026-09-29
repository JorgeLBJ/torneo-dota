import type { AppConfig } from './config.js';

/** The one source of "now" for the app; tests inject a fixed one through `AppConfig.now`. */
export type Clock = () => Date;

export const clockOf = (config: Pick<AppConfig, 'now'>): Clock => config.now ?? (() => new Date());
