import { query, one, tx } from './db';
import type { Q } from './db';
import { getProductById, getRules } from './catalog';
import { ProductError } from './productAdmin';
import { MAX_QUANTITY, type PriceRule } from './pricing';
import { gridRows, marginOf, parseNaira, rowId, type GridRow, type Margin } from './priceGrid';
import { ladderFor, packagePrices, priceConfigured, availabilityFor, type LadderStep, type PackagePrice, type Priced, type Availability } from './priceEngine';
import { PriceError } from './pricing';
import type { Product, ProductOption } from './types';

/*
 * Everything the console does to prices: read the grid, save it, confirm placeholders, remove stray prices, keep a
 * history of who changed what, and try a price the way a customer would. Plain functions that check their input and
 * throw ProductError with a sentence the person at the keyboard can act on.
 */

export type Actor = { id: string | null; name: string };

export type GridCell = { price: number | null; cost: number | null; placeholder: boolean; off: boolean };
export type GridCol = { id: string; label: string; quantity?: number; sizeKey?: string };
export type AreaCell = { rate: number | null; cost: number | null; minArea: number | null; placeholder: boolean; off: boolean };
export type Orphan = { id: string; label: string; detail: string };

export type PriceGrid = {
  productId: string;
  slug: string;
  name: string;
  mode: Product['pricing_mode'];
  rows: GridRow[];
  cols: GridCol[];
  /** Keyed `${row.id}|${col.id}`. */
  cells: Record<string, GridCell>;
  /** Area products: keyed by row id. */
  area: Record<string, AreaCell> | null;
  /** Prices that match no row or column of the grid (a choice was removed, for instance). They still apply until removed. */
  orphans: Orphan[];
  targetMarginPct: number;
  customQuantity: boolean;
};

/** Run a change in a transaction. With `dryRun` everything is worked out and then undone, so a preview reports exactly what a real save would do. */
class DryRun extends Error {
  constructor(public result: unknown) { super('dry run'); }
}
export async function inTx<T>(dryRun: boolean | undefined, fn: (q: Q) => Promise<T>): Promise<T> {
  try {
    return await tx(async (q) => {
      const r = await fn(q);
      if (dryRun) throw new DryRun(r);
      return r;
    });
  } catch (e) {
    if (e instanceof DryRun) return e.result as T;
    throw e;
  }
}

export const MAX_COLUMNS = 16;
export const MAX_PRICE_KOBO = 2_000_000_000; // ₦20 million: anything higher is almost surely a typo
const naira = (k: number) => `₦${(k / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

type RuleRow = { id: string; config: Record<string, string>; quantity: number | null; size_key: string | null; price_kobo: number | null; rate_per_sqft_kobo: number | null; min_area_sqft: number | null; cost_kobo: number | null; provisional: boolean; active: boolean };

const RULE_COLUMNS = 'id, config, quantity, size_key, price_kobo, rate_per_sqft_kobo, min_area_sqft::float as min_area_sqft, cost_kobo, provisional, active';

async function targetMargin(): Promise<number> {
  const r = await one<{ value: unknown }>("select value from settings where key = 'target_margin_pct'");
  const n = Number(r?.value);
  return Number.isFinite(n) && n >= 0 && n < 95 ? n : 40;
}

const colsFor = (p: Product, rules: RuleRow[]): GridCol[] => {
  if (p.pricing_mode === 'size') return p.sizes.map((s) => ({ id: `s:${s.key}`, label: s.label, sizeKey: s.key }));
  if (p.pricing_mode === 'tier') {
    const qs = [...new Set(rules.map((r) => r.quantity).filter((q): q is number => q != null))].sort((a, b) => a - b);
    return qs.map((q) => ({ id: `q:${q}`, label: q.toLocaleString('en-US'), quantity: q }));
  }
  return [];
};

const colOf = (p: Product, r: RuleRow): string | null => (p.pricing_mode === 'size' ? (r.size_key ? `s:${r.size_key}` : null) : p.pricing_mode === 'tier' ? (r.quantity != null ? `q:${r.quantity}` : null) : 'a');

export async function loadGrid(productId: string): Promise<PriceGrid> {
  const p = await getProductById(productId);
  if (!p) throw new ProductError('We could not find that product.');
  const rules = await query<RuleRow>(`select ${RULE_COLUMNS} from price_rules where product_id = $1`, [productId]);
  const rows = gridRows(p.options);
  const rowIds = new Set(rows.map((r) => r.id));
  const cols = colsFor(p, rules);
  const colIds = new Set(cols.map((c) => c.id));
  const cells: Record<string, GridCell> = {};
  const area: Record<string, AreaCell> | null = p.pricing_mode === 'area' ? {} : null;
  const orphans: Orphan[] = [];
  const labelOfConfig = (cfg: Record<string, string>) =>
    Object.entries(cfg).map(([k, v]) => p.options.find((o) => o.key === k)?.choices.find((c) => c.value === v)?.label ?? `${k}=${v}`).join(' · ') || 'any choice';

  for (const r of rules) {
    const id = rowId(r.config ?? {});
    const col = colOf(p, r);
    const placed = rowIds.has(id) && col != null && (p.pricing_mode === 'area' || colIds.has(col));
    if (!placed) {
      const what = p.pricing_mode === 'area' ? `${r.rate_per_sqft_kobo != null ? naira(r.rate_per_sqft_kobo) + ' per sq ft' : 'no rate'}` : `${r.quantity != null ? r.quantity.toLocaleString('en-US') + ' pieces' : (r.size_key ?? 'every size')}, ${r.price_kobo != null ? naira(r.price_kobo) : 'no price'}`;
      orphans.push({ id: r.id, label: labelOfConfig(r.config ?? {}), detail: what });
      continue;
    }
    if (area) area[id] = { rate: r.rate_per_sqft_kobo, cost: r.cost_kobo, minArea: r.min_area_sqft, placeholder: r.provisional, off: !r.active };
    else cells[`${id}|${col}`] = { price: r.price_kobo, cost: r.cost_kobo, placeholder: r.provisional, off: !r.active && r.price_kobo != null };
  }
  return { productId, slug: p.slug, name: p.name, mode: p.pricing_mode, rows, cols, cells, area, orphans, targetMarginPct: await targetMargin(), customQuantity: p.qty_custom };
}

// ---------- Saving ----------
/** `confirm`: the person typed or pasted in this box, so a placeholder price here is now a real one even if the number is the same. */
export type SaveCellIn = { row: string; col: string; price: string; cost: string; min?: string; confirm?: boolean };
export type SaveGridIn = { quantities?: (string | number)[]; cells: SaveCellIn[] };
export type SaveReport = { changed: number; added: number; removed: number; costsOnly: number; confirmed: number; belowCost: string[]; summary: string };

async function logHistory(q: Pick<Q, 'query'>, actor: Actor, product: { id: string; name: string } | null, kind: string, summary: string, detail: unknown) {
  await q.query('insert into price_history (staff_id, actor, product_id, product_name, kind, summary, detail) values ($1,$2,$3,$4,$5,$6,$7)', [actor.id, actor.name, product?.id ?? null, product?.name ?? '', kind, summary, JSON.stringify(detail)]);
}
export { logHistory };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function saveGrid(productId: string, input: SaveGridIn, actor: Actor, opts: { dryRun?: boolean } = {}): Promise<SaveReport> {
  const p = await getProductById(productId);
  if (!p) throw new ProductError('We could not find that product.');
  if (!input || !Array.isArray(input.cells)) throw new ProductError('The prices could not be read. Reload the page and try again.');
  const rows = gridRows(p.options);
  const rowById = new Map(rows.map((r) => [r.id, r]));

  // Quantity columns (tier products).
  let quantities: number[] | null = null;
  if (p.pricing_mode === 'tier') {
    const seen = new Set<number>();
    for (const raw of input.quantities ?? []) {
      const n = Math.trunc(Number(raw));
      if (!(n >= 1 && n <= MAX_QUANTITY)) throw new ProductError(`A quantity must be between 1 and ${MAX_QUANTITY.toLocaleString('en-US')}.`);
      if (seen.has(n)) throw new ProductError(`${n.toLocaleString('en-US')} appears twice. Each quantity needs one column.`);
      seen.add(n);
    }
    quantities = [...seen].sort((a, b) => a - b);
    if (quantities.length > MAX_COLUMNS) throw new ProductError(`Up to ${MAX_COLUMNS} quantity steps are allowed.`);
  }
  const sizeKeys = new Set(p.sizes.map((s) => s.key));

  // Read every cell before touching anything, so a typo anywhere saves nothing.
  type Parsed = { confirm: boolean; rowId: string; row: GridRow; colId: string; quantity: number | null; sizeKey: string | null; price: number | null; cost: number | null; min: number | null; where: string };
  const parsed: Parsed[] = [];
  const seenCell = new Set<string>();
  for (const c of input.cells) {
    const row = rowById.get(c.row);
    if (!row) throw new ProductError('A row in the grid no longer matches the options. Reload the page and try again.');
    let quantity: number | null = null;
    let sizeKey: string | null = null;
    let colLabel = '';
    if (p.pricing_mode === 'tier') {
      const m = /^q:(\d+)$/.exec(c.col);
      quantity = m ? Number(m[1]) : null;
      if (quantity == null || !quantities!.includes(quantity)) continue; // a column that was removed
      colLabel = quantity.toLocaleString('en-US');
    } else if (p.pricing_mode === 'size') {
      const m = /^s:(.+)$/.exec(c.col);
      sizeKey = m ? m[1] : null;
      if (sizeKey == null || !sizeKeys.has(sizeKey)) throw new ProductError('A column in the grid is not a size of this product. Reload the page and try again.');
      colLabel = p.sizes.find((s) => s.key === sizeKey)?.label ?? sizeKey;
    }
    const where = [row.label, colLabel].filter(Boolean).join(', ');
    const price = parseNaira(c.price);
    const cost = parseNaira(c.cost);
    if (price === undefined) throw new ProductError(`"${c.price}" is not a price (${where}). Use digits only, like 15000.`);
    if (cost === undefined) throw new ProductError(`"${c.cost}" is not a cost (${where}). Use digits only, like 9000.`);
    if (price !== null && !(price > 0)) throw new ProductError(`The price for ${where} must be more than zero. Leave it empty if it is not sold.`);
    if (price !== null && price > MAX_PRICE_KOBO) throw new ProductError(`${naira(price)} for ${where} looks like a typo. The most one price can be is ${naira(MAX_PRICE_KOBO)}.`);
    if (cost !== null && cost > MAX_PRICE_KOBO) throw new ProductError(`The cost ${naira(cost)} for ${where} looks like a typo.`);
    let min: number | null = null;
    if (p.pricing_mode === 'area' && String(c.min ?? '').trim() !== '') {
      min = Number(c.min);
      if (!(min >= 0 && min <= 1000)) throw new ProductError(`The smallest area for ${where} must be a number of square feet, or empty.`);
    }
    const k = `${c.row}|${c.col}`;
    if (seenCell.has(k)) throw new ProductError('A price appears twice in what was sent. Reload the page and try again.');
    seenCell.add(k);
    parsed.push({ confirm: !!c.confirm, rowId: c.row, row, colId: c.col, quantity, sizeKey, price, cost, min, where });
  }

  return inTx(opts.dryRun, async (q) => {
    const existing = await q.query<RuleRow>(`select ${RULE_COLUMNS} from price_rules where product_id = $1`, [productId]);
    const byCell = new Map<string, RuleRow>();
    const inGrid = new Set<string>();
    for (const r of existing) {
      const id = rowId(r.config ?? {});
      if (!rowById.has(id)) continue; // a stray price: only "remove stray prices" deletes it
      const col = colOf(p, r);
      if (col == null) continue;
      byCell.set(`${id}|${col}`, r);
      inGrid.add(r.id);
    }

    let changed = 0, added = 0, removed = 0, costsOnly = 0, confirmed = 0;
    const detail: { where: string; was: string; now: string }[] = [];
    const belowCost: string[] = [];
    const log = (where: string, was: string, now: string) => { if (detail.length < 300) detail.push({ where, was, now }); };

    // A removed quantity column takes its prices with it.
    if (quantities) {
      for (const r of existing) {
        if (!inGrid.has(r.id) || r.quantity == null || quantities.includes(r.quantity)) continue;
        await q.query('delete from price_rules where id = $1', [r.id]);
        byCell.forEach((v, k) => { if (v.id === r.id) byCell.delete(k); });
        removed++;
        log(`${rowById.get(rowId(r.config ?? {}))?.label ?? ''}, ${r.quantity.toLocaleString('en-US')}`, r.price_kobo != null ? naira(r.price_kobo) : 'no price', 'column removed');
      }
    }

    for (const c of parsed) {
      const key = `${c.rowId}|${c.colId}`;
      const old = byCell.get(key);
      const text = (k: number | null) => (k == null ? 'empty' : naira(k));
      if (c.price === null && c.cost === null) {
        if (old) {
          await q.query('delete from price_rules where id = $1', [old.id]);
          removed++;
          log(c.where, text(old.price_kobo), 'removed');
        }
        continue;
      }
      if (p.pricing_mode === 'area') {
        // Area: "price" is the rate per square foot and "cost" the cost per square foot.
        const oldRate = old?.rate_per_sqft_kobo ?? null;
        if (old) {
          const same = oldRate === c.price && old.cost_kobo === c.cost && (old.min_area_sqft ?? null) === c.min && old.active === (c.price !== null) && !(old.provisional && c.confirm);
          if (same) continue;
          const keep = old.provisional && oldRate === c.price && !c.confirm;
          await q.query('update price_rules set rate_per_sqft_kobo = $2, cost_kobo = $3, min_area_sqft = $4, provisional = $6, active = $5 where id = $1', [old.id, c.price, c.cost, c.min, c.price !== null, keep]);
          if (oldRate !== c.price) changed++; else if (old.provisional && c.confirm) confirmed++; else costsOnly++;
        } else {
          await q.query('insert into price_rules (product_id, config, rate_per_sqft_kobo, cost_kobo, min_area_sqft, provisional, active) values ($1,$2,$3,$4,$5,false,$6)', [productId, JSON.stringify(c.row.config), c.price, c.cost, c.min, c.price !== null]);
          added++;
        }
        log(c.where || c.row.label, text(oldRate), text(c.price));
        if (c.price !== null && c.cost !== null && c.cost > c.price) belowCost.push(c.where || c.row.label);
        continue;
      }
      const active = c.price !== null;
      if (old) {
        // A placeholder stays a placeholder unless the price was changed or the person said it is real.
        const same = old.price_kobo === c.price && old.cost_kobo === c.cost && old.active === active && !(old.provisional && c.confirm);
        if (same) continue;
        const stillPlaceholder = old.provisional && old.price_kobo === c.price && !c.confirm;
        await q.query('update price_rules set price_kobo = $2, cost_kobo = $3, provisional = $5, active = $4 where id = $1', [old.id, c.price, c.cost, active, stillPlaceholder]);
        if (old.price_kobo !== c.price) changed++;
        else if (old.provisional && c.confirm) confirmed++;
        else costsOnly++;
        log(c.where, text(old.price_kobo), old.price_kobo === c.price && old.provisional ? `${text(c.price)} (confirmed)` : text(c.price));
      } else {
        await q.query('insert into price_rules (product_id, config, quantity, size_key, price_kobo, cost_kobo, provisional, active) values ($1,$2,$3,$4,$5,$6,false,$7)', [productId, JSON.stringify(c.row.config), c.quantity, c.sizeKey, c.price, c.cost, active]);
        if (c.price !== null) added++; else costsOnly++;
        log(c.where, 'empty', text(c.price));
      }
      if (c.price !== null && c.cost !== null && c.cost > c.price) belowCost.push(c.where);
    }

    const parts = [changed && plural(changed, 'price changed', 'prices changed'), added && plural(added, 'price added', 'prices added'), removed && plural(removed, 'price removed', 'prices removed'), costsOnly && plural(costsOnly, 'cost updated', 'costs updated'), confirmed && plural(confirmed, 'placeholder confirmed', 'placeholders confirmed')].filter(Boolean) as string[];
    const summary = parts.length ? `${p.name}: ${parts.join(', ')}.` : `${p.name}: nothing changed.`;
    if (parts.length) await logHistory(q, actor, { id: productId, name: p.name }, 'prices', summary, { cells: detail, belowCost });
    return { changed, added, removed, costsOnly, confirmed, belowCost, summary };
  });
}

// ---------- Placeholders and stray prices ----------

/** Say that every placeholder price on this product is a real price now. */
export async function confirmPlaceholders(productId: string, actor: Actor): Promise<number> {
  const p = await getProductById(productId);
  if (!p) throw new ProductError('We could not find that product.');
  return tx(async (q) => {
    const cells = await q.query<{ id: string }>('update price_rules set provisional = false where product_id = $1 and provisional returning id', [productId]);
    let choices = 0;
    const options: ProductOption[] = p.options.map((o) => ({
      ...o,
      choices: o.choices.map((c) => {
        if (!c.provisional) return c;
        choices++;
        const { provisional: _x, ...rest } = c;
        return rest;
      }),
    }));
    if (choices) await q.query('update products set options = $2 where id = $1', [productId, JSON.stringify(options)]);
    const n = cells.length + choices;
    if (n) await logHistory(q, actor, { id: productId, name: p.name }, 'confirm', `${p.name}: ${plural(n, 'placeholder price', 'placeholder prices')} confirmed as real.`, { cells: cells.length, addons: choices });
    return n;
  });
}

/** Remove prices that match no row or column. */
export async function removeStray(productId: string, ids: string[], actor: Actor): Promise<number> {
  const grid = await loadGrid(productId);
  const allowed = new Set(grid.orphans.map((o) => o.id));
  const take = ids.filter((i) => allowed.has(i));
  if (!take.length) return 0;
  return tx(async (q) => {
    await q.query('delete from price_rules where product_id = $1 and id = any($2::uuid[])', [productId, take]);
    await logHistory(q, actor, { id: productId, name: grid.name }, 'prices', `${grid.name}: ${plural(take.length, 'stray price', 'stray prices')} removed.`, { removed: grid.orphans.filter((o) => take.includes(o.id)) });
    return take.length;
  });
}

// ---------- History ----------
export type HistoryRow = { id: number; at: string; actor: string; product_id: string | null; product_name: string; kind: string; summary: string; detail: any };

export async function priceHistory(opts: { productId?: string; limit?: number } = {}): Promise<HistoryRow[]> {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 50));
  return query<HistoryRow>(
    `select id::int as id, at, actor, product_id, product_name, kind, summary, detail from price_history ${opts.productId ? 'where product_id = $2' : ''} order by at desc, id desc limit $1`,
    opts.productId ? [limit, opts.productId] : [limit],
  );
}

// ---------- Try a price ----------
export type TryIn = { quantity: number; config?: Record<string, string>; sizeKey?: string | null; widthFt?: number; heightFt?: number };
export type TryOut =
  | {
      ok: true;
      priced: Priced;
      margin: Margin | null;
      suggested: number | null;
      ladder: LadderStep[];
      packages: PackagePrice[];
      availability: Availability;
    }
  | { ok: false; error: string; availability: Availability | null };

/** Price an order the way a customer's would be, including choices that are not on sale yet. Reads only. */
export async function tryPrice(productId: string, input: TryIn): Promise<TryOut> {
  const p = await getProductById(productId);
  if (!p) throw new ProductError('We could not find that product.');
  const rules = (await getRules(productId)).price as PriceRule[];
  const target = await targetMargin();
  const opt = { preview: true };
  let availability: Availability | null = null;
  try {
    availability = availabilityFor(p, rules, input, opt);
    const priced = priceConfigured(p, rules, input, opt);
    const margin = marginOf(priced.totalKobo, priced.costKobo, target);
    const suggested = priced.costKobo != null && margin && margin.level !== 'ok' ? Math.ceil(priced.costKobo / (1 - target / 100) / 10000) * 10000 : null;
    return { ok: true, priced, margin, suggested, ladder: ladderFor(p, rules, input, opt), packages: packagePrices(p, rules, input, opt), availability };
  } catch (e) {
    if (e instanceof PriceError) return { ok: false, error: e.message, availability };
    throw e;
  }
}
