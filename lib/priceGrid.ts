import type { Condition, ProductOption } from './types';

/*
 * The shape of the price grid, with no database in it. A product's prices live in a table with one row for every
 * combination of the choices that pick the base price (paper, size, card...) and one column for every quantity step (or
 * every size). This file works out the rows, reads pasted text, applies a bulk change and works out margins, so the
 * console screen and the tests use the same rules.
 */

export type GridRow = { id: string; label: string; config: Record<string, string> };

/** A stable name for a row's choices: the same choices always give the same id, whatever order they were built in. */
export const rowId = (config: Record<string, string>) => JSON.stringify(Object.entries(config).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** True when the condition holds for what has been picked so far. A condition on something not picked yet is given the benefit of the doubt. */
function holds(cond: Condition | undefined, picks: Record<string, string>): boolean {
  if (!cond) return true;
  return Object.entries(cond).every(([k, allowed]) => picks[k] === undefined || allowed.includes(picks[k]));
}

/**
 * One row for every combination of the options that pick the price table. A choice that shares another choice's table
 * (150gsm matte uses 150gsm gloss) has no row of its own. Options and choices that only apply with certain other choices
 * only appear under those (a V-neck row exists only under "T-shirt").
 */
export function gridRows(options: ProductOption[]): GridRow[] {
  const drivers = options.filter((o) => o.drives && (o.kind ?? 'pick') === 'pick');
  let rows: { config: Record<string, string>; labels: string[] }[] = [{ config: {}, labels: [] }];
  for (const o of drivers) {
    const next: typeof rows = [];
    for (const r of rows) {
      if (!holds(o.only_if, r.config)) { next.push(r); continue; }
      const choices = o.choices.filter((c) => c.value !== 'auto' && !c.price_like && holds(c.only_if, r.config));
      if (!choices.length) { next.push(r); continue; }
      for (const c of choices) next.push({ config: { ...r.config, [o.key]: c.value }, labels: [...r.labels, c.label] });
    }
    rows = next;
  }
  return rows.map((r) => ({ id: rowId(r.config), label: r.labels.join(' · ') || 'Price', config: r.config }));
}

// ---------- Typing and pasting ----------

/** What a person typed or pasted in a price box, as kobo. Empty is null; anything that is not an amount is undefined. */
export function parseNaira(text: string | number | null | undefined): number | null | undefined {
  if (text === null || text === undefined) return null;
  const raw = String(text).trim();
  if (raw === '' || raw === '-' || raw === '—') return null;
  const cleaned = raw.replace(/[₦\s]/g, '').replace(/^n(?=[\d.,])/i, '').replace(/,/g, '').replace(/ngn/i, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}

/** Cut text copied from Excel or Google Sheets into rows and cells. Tabs separate cells and new lines separate rows. */
export function parsePaste(text: string): string[][] {
  const rows = text.replace(/\r\n?/g, '\n').split('\n');
  while (rows.length && rows[rows.length - 1].trim() === '') rows.pop();
  return rows.map((r) => r.split('\t').map((c) => c.trim().replace(/^"(.*)"$/, '$1')));
}

// ---------- Bulk change ----------
export type BulkOp = { mode: 'percent' | 'amount'; value: number; round: 'none' | '10' | '50' | '100' | '500' };

/** Apply a rise or fall to prices in kobo. Empty cells stay empty, a price never falls below ₦1, and the result is rounded as asked. */
export function applyBulk(kobo: number | null, op: BulkOp): number | null {
  if (kobo === null) return null;
  const raw = op.mode === 'percent' ? kobo * (1 + op.value / 100) : kobo + Math.round(op.value * 100);
  const step = op.round === 'none' ? 1 : Number(op.round) * 100;
  const rounded = step === 1 ? Math.round(raw) : Math.round(raw / step) * step;
  return Math.max(100, rounded);
}

// ---------- Margins ----------
export type Margin = { pct: number; level: 'loss' | 'thin' | 'ok' };

/** Margin on the price: (price - cost) / price. Null when either number is missing. */
export function marginOf(priceKobo: number | null | undefined, costKobo: number | null | undefined, targetPct: number): Margin | null {
  if (!priceKobo || costKobo == null || priceKobo <= 0) return null;
  const pct = ((priceKobo - costKobo) / priceKobo) * 100;
  return { pct: Math.round(pct * 10) / 10, level: pct < 0 ? 'loss' : pct < targetPct ? 'thin' : 'ok' };
}

/** The price that reaches the target margin for a cost, rounded up to the next ₦100. */
export function priceForMargin(costKobo: number, targetPct: number): number {
  const exact = costKobo / (1 - Math.min(95, Math.max(0, targetPct)) / 100);
  return Math.ceil(exact / 10000) * 10000;
}
