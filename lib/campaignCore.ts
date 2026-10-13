import { PALETTES, isPalette, type PaletteKey } from './templateCore';

/*
 * Seasonal pages, the parts that need no database: which stage a page is in on a given day, and its colours.
 * A page is "live" from its first day to its last day inclusive (Lagos dates), so a page that ends on 24 December
 * still shows all of 24 December.
 */
export type Phase = 'live' | 'upcoming' | 'ended' | 'hidden';
export type DateRange = { active: boolean; starts_on: string | null; ends_on: string | null };

export function phaseOf(c: DateRange, today: string): Phase {
  if (!c.active) return 'hidden';
  if (c.starts_on && today < c.starts_on) return 'upcoming';
  if (c.ends_on && today > c.ends_on) return 'ended';
  return 'live';
}

const dayNumber = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};
/** Whole days from one Lagos date to another (positive when `to` is later). */
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);

/** "Last day today", "1 day left", "12 days left", or null when the page has no end date. */
export function leftText(c: Pick<DateRange, 'ends_on'>, today: string): string | null {
  if (!c.ends_on) return null;
  const n = daysBetween(today, c.ends_on);
  if (n < 0) return null;
  return n === 0 ? 'Last day today' : n === 1 ? '1 day left' : `${n} days left`;
}

export const THEMES = PALETTES;
export const themeOf = (v: unknown): PaletteKey => (isPalette(v) ? v : 'ink');
export { isPalette };

export const validYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export const niceDay = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-NG', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
};
