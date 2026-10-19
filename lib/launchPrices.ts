import { one, query, isDemo } from './db';
import { applySheet, type SheetResult } from './priceSheet';
import { LAUNCH_PRICE_BOOK_CSV } from '../content/launch-price-book';

/*
 * The launch price book. A new live site has every product, option and package but no confirmed prices, so customers would
 * see nothing to buy. The price book that came with this build holds the numbers Brandit gave and the gaps filled from what
 * other Lagos printers publish (each line says which in its note). It is loaded:
 *   - once, automatically, on the first start of a live site when LAUNCH_PRICES=yes, or
 *   - by pressing the button on the console Setup page (after a preview that shows what it would change).
 * It never loads itself a second time, so a price the team has changed in the console is never put back.
 */
const KEY = 'launch_prices';

export type LaunchState = { loadedAt: string; by: string; lines: number; products: number } | null;

export async function launchState(): Promise<LaunchState> {
  const r = await one<{ value: LaunchState }>('select value from settings where key = $1', [KEY]);
  return r?.value ?? null;
}

export const launchBookLines = () => LAUNCH_PRICE_BOOK_CSV.split(/\r?\n/).filter((l) => l.trim()).length - 1;

/** What loading it would change, without saving anything. */
export async function previewLaunchPrices(): Promise<SheetResult> {
  return applySheet(LAUNCH_PRICE_BOOK_CSV, { id: null, name: 'Launch price book' }, { dryRun: true });
}

/** Load it. All or nothing: if anything in it does not fit the catalogue, nothing is saved and the problems are returned. */
export async function loadLaunchPrices(by: string): Promise<SheetResult> {
  const res = await applySheet(LAUNCH_PRICE_BOOK_CSV, { id: null, name: `Launch price book (${by})` }, { dryRun: false });
  if (res.ok) {
    const state = { loadedAt: new Date().toISOString(), by, lines: res.readLines, products: res.products.length };
    await query('insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', [KEY, JSON.stringify(state)]);
  }
  return res;
}

/** Called on server start. Loads the price book once, on a live site, when LAUNCH_PRICES is yes. Never throws. */
export async function autoLoadLaunchPrices(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (!['yes', 'true', '1'].includes((env.LAUNCH_PRICES ?? '').toLowerCase())) return null;
  if (isDemo(env)) return null;
  try {
    if (await launchState()) return null;
    const res = await loadLaunchPrices('first start');
    if (res.ok) return `launch price book loaded (${res.readLines} lines)`;
    return `launch price book NOT loaded: ${res.problems.slice(0, 3).join(' | ')}`;
  } catch (e) {
    return `launch price book NOT loaded: ${(e as Error)?.message ?? e}`;
  }
}
