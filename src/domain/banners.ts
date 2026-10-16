// Welcome banners: which one is on the air, and whether two of them fight for the same moment.
// Windows are half-open, [startsAt, endsAt): the end instant already belongs to whatever comes next, so a banner
// that ends at 18/10 00:00 and one that starts at 18/10 00:00 do not conflict. A missing start is -infinity and a
// missing end is +infinity. Instants are ISO UTC strings ("2026-10-18T05:00:00Z").

/** The tabs of the public page a banner button can jump to; the keys are the page's own tab identifiers. */
export const BANNER_TABS = [
  { key: 'partidos', label: 'Partidos' },
  { key: 'envivo', label: 'En vivo' },
  { key: 'posiciones', label: 'Posiciones' },
  { key: 'playoffs', label: 'Playoffs' },
  { key: 'reglas', label: 'Reglas' },
] as const;

export type BannerTab = (typeof BANNER_TABS)[number]['key'];

export const isBannerTab = (value: string): value is BannerTab => BANNER_TABS.some((tab) => tab.key === value);

export const bannerTabLabel = (key: BannerTab): string => BANNER_TABS.find((tab) => tab.key === key)!.label;

export interface BannerWindow {
  startsAt: string | null;
  endsAt: string | null;
}

export interface WindowedBanner extends BannerWindow {
  id: number;
  active: boolean;
}

export type BannerState = 'showing' | 'scheduled' | 'ended' | 'inactive';

const at = (iso: string): number => Date.parse(iso);

/** Whether two windows share at least one instant. */
export function windowsOverlap(a: BannerWindow, b: BannerWindow): boolean {
  const aStart = a.startsAt === null ? -Infinity : at(a.startsAt);
  const aEnd = a.endsAt === null ? Infinity : at(a.endsAt);
  const bStart = b.startsAt === null ? -Infinity : at(b.startsAt);
  const bEnd = b.endsAt === null ? Infinity : at(b.endsAt);
  return aStart < bEnd && bStart < aEnd;
}

/**
 * The active banner that the candidate would collide with, if any. An inactive candidate never collides, inactive
 * banners are never collided with, and a banner already stored (same id) does not collide with itself.
 */
export function findBannerConflict<T extends WindowedBanner>(
  others: readonly T[],
  candidate: Omit<WindowedBanner, 'id'> & { id?: number },
): T | undefined {
  if (!candidate.active) return undefined;
  return others.find((other) => other.active && other.id !== candidate.id && windowsOverlap(other, candidate));
}

/** What the admin list shows for a banner at `now`. */
export function bannerState(banner: WindowedBanner, now: Date): BannerState {
  if (!banner.active) return 'inactive';
  const t = now.getTime();
  if (banner.startsAt !== null && t < at(banner.startsAt)) return 'scheduled';
  if (banner.endsAt !== null && t >= at(banner.endsAt)) return 'ended';
  return 'showing';
}
