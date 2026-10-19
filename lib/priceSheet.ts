import { listProducts } from './catalog';
import { query } from './db';
import { inTx, loadGrid, logHistory, saveGrid, type Actor, type PriceGrid, type SaveCellIn, type SaveReport } from './priceAdmin';
import { saveOptionsV2, saveQuantityRule } from './optionsAdmin';
import { optionsToInput, type OptionIn } from './optionsForm';
import { parseNaira } from './priceGrid';
import { MAX_QUANTITY } from './pricing';
import { ProductError } from './productAdmin';
import { packProduct } from '../content/catalogue';
import type { ExtraPer, Product } from './types';

/*
 * The price sheet: every price in the shop as one spreadsheet that opens in Excel or Google Sheets, with a column for
 * what each thing costs. Fill in the yellow-ish columns (Price, Cost, Real price?), save as CSV, upload it, look at what it
 * would change, and apply it. Nothing is saved until the preview has been looked at, and one wrong line saves nothing at all.
 *
 *  - An empty Price or Cost box means "leave as it is". To take a price away, use the price grid.
 *  - One sheet can also carry new quantity steps (a price line for a quantity the product does not have yet adds the step), the quantity
 *    rule of each product (smallest and largest order, and whether a customer may type their own number) and the delivery fees.
 *  - The key columns on the right say which price each line is. They are what makes an upload land in the right place.
 */

export const HEAD = ['Product', 'Part', 'What', 'Quantity or size', 'Price (₦)', 'Cost (₦)', 'Real price? (yes/no)', 'Note', 'Product key (do not change)', 'Row key (do not change)', 'Column key (do not change)'] as const;
const PART_TABLE = 'Price table';
const PART_ADDON = 'Add-on';
/** How many pieces a customer may order, and whether they may type their own number. One product, three lines. */
const PART_RULE = 'Quantity rule';
/** The delivery fee of a zone, and whether the zone gets 24-hour delivery. */
const PART_DELIVERY = 'Delivery';
const DELIVERY_KEY = 'delivery';

// ---------- CSV ----------
const cell = (v: string | number | null | undefined) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Text for a CSV file. A byte-order mark at the start makes Excel read the naira sign correctly. */
export const toCsv = (rows: (string | number | null | undefined)[][]): string => '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

/** Read CSV text from Excel or Google Sheets. Commas, semicolons or tabs between boxes; quotes around boxes that hold them. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delim = [',', ';', '\t'].map((d) => ({ d, n: count(d) })).sort((a, b) => b.n - a.n)[0];
  const sep = delim.n > 0 ? delim.d : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// ---------- Export ----------
const naira = (k: number | null | undefined) => (k == null ? '' : String(k / 100));
const nairaText = (k: number) => `${k < 0 ? '−' : ''}₦${Math.abs(k / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const PER_TEXT: Record<string, string> = { order: 'once per order', piece: 'per piece', sqft: 'per square foot', foot: 'per foot', position: 'per print position' };
/** The unit written on a line ("charged per piece"), read back. Anything else means the line does not say. */
function unitOfText(text: string): ExtraPer | null {
  const t = text.toLowerCase();
  for (const [k, v] of Object.entries(PER_TEXT)) if (t.includes(v)) return k as ExtraPer;
  return null;
}
/** A choice that is waiting for a price has no unit stored yet; the catalogue knows what it was meant to be. */
function intendedUnit(slug: string, optionKey: string, value: string): ExtraPer | null {
  return packProduct(slug)?.options.find((o) => o.key === optionKey)?.choices.find((c) => c.value === value)?.ex?.extra_per ?? null;
}

/** What a size-dependent add-on needs a price for: the sizes (or the other option's choices) it varies with. */
function byKeys(p: Product, key: string): { value: string; label: string }[] {
  if (key === 'size' && p.pricing_mode === 'size') return p.sizes.map((x) => ({ value: x.key, label: x.label }));
  return (p.options.find((o) => o.key === key)?.choices ?? []).map((c) => ({ value: c.value, label: c.label }));
}
const exampleOf = (slug: string, optionKey: string, value: string) => packProduct(slug)?.options.find((o) => o.key === optionKey)?.choices.find((c) => c.value === value)?.ex;

/**
 * Add-ons a sheet can carry: a flat extra, one that varies with size (one line per size), a one-time setup charge
 * (its own line), or any of them waiting for a price. Only a percentage is edited in the console.
 */
function sheetChoices(p: Product) {
  const out: { o: Product['options'][number]; c: Product['options'][number]['choices'][number] }[] = [];
  for (const o of p.options) {
    if (o.drives) continue;
    for (const c of o.choices) {
      if (c.percent || c.price_like || c.value === 'auto') continue;
      const priced = (c.extra_kobo ?? 0) !== 0 || !!c.setup_kobo || (!!c.by && Object.keys(c.by.amounts).length > 0);
      if (priced || c.unpriced || c.provisional) out.push({ o, c });
    }
  }
  return out;
}

export async function buildSheet(only?: string): Promise<{ csv: string; lines: number; products: number }> {
  const products = (await listProducts(true)).filter((p) => !only || p.slug === only);
  const rows: (string | number | null)[][] = [[...HEAD]];
  for (const p of products) {
    const g = await loadGrid(p.id);
    const first = rows.length;
    if (g.area) {
      for (const r of g.rows) {
        const a = g.area[r.id];
        rows.push([p.name, PART_TABLE, r.label === 'Price' ? 'Every choice' : r.label, 'rate per square foot', naira(a?.rate), naira(a?.cost), a?.rate == null ? '' : a.placeholder ? 'no' : 'yes', a?.placeholder ? 'Example price: not real until you say so' : '', p.slug, r.id, 'a']);
      }
    } else {
      for (const r of g.rows) {
        for (const c of g.cols) {
          const x = g.cells[`${r.id}|${c.id}`];
          rows.push([p.name, PART_TABLE, r.label === 'Price' ? 'Every choice' : r.label, p.pricing_mode === 'tier' ? `${c.label} pieces, price for all of them` : `${c.label}, price for one`, naira(x?.price), naira(x?.cost), x?.price == null ? '' : x.placeholder ? 'no' : 'yes', x?.placeholder ? 'Example price: not real until you say so' : x?.off && x.price == null ? 'Cost only; not for sale' : '', p.slug, r.id, c.id]);
        }
      }
    }
    for (const { o, c } of sheetChoices(p)) {
      const ex = exampleOf(p.slug, o.key, c.value);
      const unit = c.extra_per ?? ex?.extra_per ?? 'order';
      const unitText = `charged ${PER_TEXT[unit] ?? 'once per order'}`;
      const name = `${o.label}: ${c.label}`;
      const waiting = !!c.unpriced;
      const status = (has: boolean) => (!has ? '' : c.provisional ? 'no' : 'yes');
      const note = waiting ? 'Waiting for a price: customers cannot see it yet. Type 0 if it costs nothing extra.' : c.hidden ? 'Switched off' : c.provisional ? 'Example price: not real until you say so' : '';
      if (c.by) {
        for (const k of byKeys(p, c.by.key)) {
          const amt = c.by.amounts[k.value];
          rows.push([p.name, PART_ADDON, `${name} · ${k.label}`, unitText, naira(amt), '', status(amt != null), note, p.slug, o.key, `${c.value}@${k.value}`]);
        }
        continue;
      }
      const wantsSetup = !!c.setup_kobo || (waiting && ex?.setup_kobo != null);
      const wantsExtra = (c.extra_kobo ?? 0) !== 0 || (waiting ? ex?.extra_kobo != null || ex?.setup_kobo == null : !c.setup_kobo);
      if (wantsExtra) {
        const price = waiting ? '' : naira(c.extra_kobo ?? 0);
        rows.push([p.name, PART_ADDON, name, unitText, price, naira(c.cost_kobo), price === '' ? '' : c.provisional ? 'no' : 'yes', note, p.slug, o.key, c.value]);
      }
      if (wantsSetup) {
        const price = waiting ? '' : naira(c.setup_kobo ?? 0);
        rows.push([p.name, PART_ADDON, `${name} · one-time setup`, 'charged once, whatever the quantity', price, '', price === '' ? '' : c.provisional ? 'no' : 'yes', note, p.slug, o.key, `${c.value}#setup`]);
      }
    }
    if (p.pricing_mode === 'tier') {
      const note = 'Type a number of pieces (not naira). Empty keeps what is there; "none" takes the limit away.';
      rows.push([p.name, PART_RULE, 'Customers may type their own quantity', 'yes or no', p.qty_custom ? 'yes' : 'no', '', '', '', p.slug, 'qty', 'custom']);
      rows.push([p.name, PART_RULE, 'Smallest order', 'pieces', p.qty_min ?? '', '', '', note, p.slug, 'qty', 'min']);
      rows.push([p.name, PART_RULE, 'Largest online order', 'pieces', p.qty_max ?? '', '', '', '', p.slug, 'qty', 'max']);
    }
    if (rows.length === first) rows.push([p.name, '', 'Nothing to price yet', '', '', '', '', 'Add quantity steps in the price grid first', p.slug, '', '']);
  }
  if (!only) {
    const zones = await query<{ name: string; fee_kobo: number; eligible_24h: boolean; provisional: boolean }>('select name, fee_kobo, eligible_24h, provisional from delivery_zones order by sort, name');
    for (const z of zones) {
      const note = z.provisional ? 'Stand-in fee: not confirmed yet' : '';
      rows.push(['Delivery', PART_DELIVERY, z.name, 'fee for one delivery', naira(z.fee_kobo), '', '', note, DELIVERY_KEY, z.name, 'fee']);
      rows.push(['Delivery', PART_DELIVERY, z.name, '24-hour delivery? (yes or no)', z.eligible_24h ? 'yes' : 'no', '', '', '', DELIVERY_KEY, z.name, '24h']);
    }
  }
  return { csv: toCsv(rows), lines: rows.length - 1, products: products.length };
}

// ---------- Import ----------
export type SheetProduct = {
  slug: string;
  name: string;
  /** What the price grid would do. */
  grid: SaveReport | null;
  /** How many add-ons would change. */
  addons: number;
  /** Plain sentences to show the person. */
  lines: string[];
};
export type SheetResult = {
  ok: boolean;
  applied: boolean;
  products: SheetProduct[];
  /** What is wrong, in sentences that name the line. When there is anything here nothing was saved. */
  problems: string[];
  belowCost: string[];
  readLines: number;
  unchanged: number;
};

type Line = { n: number; slug: string; part: string; keyA: string; keyB: string; price: string; cost: string; real: boolean; what: string; size: string };

const MAX_SHEET_BYTES = 2_000_000;
const MAX_PROBLEMS = 25;

export function readSheet(input: string | string[][]): { lines: Line[]; problems: string[] } {
  if (typeof input === 'string' && input.length > MAX_SHEET_BYTES) throw new ProductError('That file is too big to be a price sheet. Download a fresh sheet and fill that in.');
  const rows = typeof input === 'string' ? parseCsv(input) : input;
  const at = (head: string[], ...starts: string[]) => head.findIndex((h) => starts.some((s) => h.startsWith(s)));
  let hi = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const h = rows[i].map((c) => c.trim().toLowerCase());
    if (at(h, 'product key') >= 0 && at(h, 'row key') >= 0 && at(h, 'column key') >= 0) { hi = i; break; }
  }
  if (hi < 0) throw new ProductError('This does not look like a Brandit price sheet. Download a fresh sheet from the Products page, fill it in and save it as CSV.');
  const head = rows[hi].map((c) => c.trim().toLowerCase());
  const col = { slug: at(head, 'product key'), a: at(head, 'row key'), b: at(head, 'column key'), price: at(head, 'price'), cost: at(head, 'cost'), real: at(head, 'real price'), part: at(head, 'part'), what: at(head, 'what'), size: at(head, 'quantity or size') };
  if (col.price < 0 || col.cost < 0) throw new ProductError('The Price and Cost columns are missing from this file. Download a fresh sheet and keep every column.');
  const lines: Line[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const g = (k: number) => (k >= 0 ? (r[k] ?? '').trim() : '');
    const slug = g(col.slug);
    if (!slug) continue;
    const part = g(col.part) || PART_TABLE;
    const keyA = (r[col.a] ?? '').trim();
    const keyB = (r[col.b] ?? '').trim();
    if (!keyA && !keyB) continue; // a line that says "nothing to price yet"
    const id = `${slug}|${part}|${keyA}|${keyB}`;
    if (seen.has(id)) { problems.push(`Line ${i + 1}: "${g(col.what)}" appears twice. Each price may be on one line only.`); continue; }
    seen.add(id);
    lines.push({ n: i + 1, slug, part: /^add/i.test(part) ? PART_ADDON : /^quantity/i.test(part) ? PART_RULE : /^deliver/i.test(part) ? PART_DELIVERY : PART_TABLE, keyA, keyB, price: g(col.price), cost: g(col.cost), real: /^(y|yes|true|1)/i.test(g(col.real)), what: g(col.what), size: g(col.size) });
  }
  if (!lines.length) throw new ProductError('There are no price lines in this file.');
  return { lines, problems };
}

/** Add-ons may be negative (a saving), so they need their own reading of an amount. */
function signedKobo(text: string): number | null | undefined {
  const t = text.trim();
  if (/^[-−–]/.test(t)) {
    const k = parseNaira(t.replace(/^[-−–]\s*/, ''));
    return k == null ? k : -k;
  }
  return parseNaira(t);
}

const asNaira = (k: number | null) => (k == null ? '' : (k / 100).toFixed(2));
const yesNo = (v: string): boolean | null => (/^(y|yes|true|1)$/i.test(v) ? true : /^(n|no|false|0)$/i.test(v) ? false : null);
const piecesText = (n: number) => `${n.toLocaleString('en-US')}`;

type Rule = { custom: boolean; min: number | null; max: number | null };
const ruleSentence = (r: Rule) => (r.custom ? `customers may type their own quantity${r.min ? ` from ${piecesText(r.min)}` : ''}${r.max ? ` up to ${piecesText(r.max)}` : ''}` : 'customers pick from the quantity steps only');
type ZoneRow = { id: string; name: string; fee_kobo: number; eligible_24h: boolean; provisional: boolean };

export async function applySheet(input: string | string[][], actor: Actor, opts: { dryRun: boolean }): Promise<SheetResult> {
  const { lines, problems } = readSheet(input);
  const products = await listProducts(true);
  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const grouped = new Map<string, Line[]>();
  const deliveryLines: Line[] = [];
  for (const l of lines) {
    if (l.part === PART_DELIVERY) { deliveryLines.push(l); continue; }
    if (!bySlug.has(l.slug)) { problems.push(`Line ${l.n}: "${l.slug}" is not a product in this shop. Download a fresh sheet.`); continue; }
    grouped.set(l.slug, [...(grouped.get(l.slug) ?? []), l]);
  }

  type Plan = { p: Product; cells: SaveCellIn[]; quantities: number[] | undefined; options: OptionIn[] | null; addons: number; rule: Rule | null; lines: string[] };
  const plans: Plan[] = [];
  let unchanged = 0;
  for (const [slug, ls] of grouped) {
    const p = bySlug.get(slug)!;
    const grid: PriceGrid = await loadGrid(p.id);
    const rowIds = new Set(grid.rows.map((r) => r.id));
    const colIds = new Set(grid.cols.map((c) => c.id));
    const isTier = p.pricing_mode === 'tier';
    // A new rate per square foot takes the minimum charge the product already has, so a new material is not cheaper to order small.
    const usualMin = grid.area ? Object.values(grid.area).find((a) => a.minArea != null)?.minArea ?? null : null;
    const cells: SaveCellIn[] = [];
    const options = optionsToInput(p.options);
    let optionsTouched = 0;
    const notes: string[] = [];
    const addedQuantities = new Set<number>();
    const bySizeTouched = new Set<string>();
    const ruleNow: Rule = { custom: !!p.qty_custom, min: p.qty_min ?? null, max: p.qty_max ?? null };
    const ruleNew: Rule = { ...ruleNow };
    let ruleLines = 0;
    for (const l of ls) {
      const where = `Line ${l.n} (${p.name}, ${l.what}${l.size ? `, ${l.size}` : ''})`;

      if (l.part === PART_RULE) {
        if (!isTier) { problems.push(`${where}: only products priced by quantity have a quantity rule.`); continue; }
        const v = l.price.trim();
        if (v === '') continue;
        ruleLines++;
        if (l.keyB === 'custom') {
          const yn = yesNo(v);
          if (yn == null) problems.push(`${where}: write yes or no.`); else ruleNew.custom = yn;
        } else if (l.keyB === 'min' || l.keyB === 'max') {
          if (/^none$/i.test(v)) { ruleNew[l.keyB] = null; continue; }
          const n = Number(v.replace(/,/g, ''));
          if (!Number.isInteger(n) || n < 1 || n > MAX_QUANTITY) problems.push(`${where}: write a whole number of pieces between 1 and ${MAX_QUANTITY.toLocaleString('en-US')}, or the word none.`);
          else ruleNew[l.keyB] = n;
        } else problems.push(`${where}: this is not a quantity rule line. Download a fresh sheet.`);
        continue;
      }

      const sheetPrice = l.part === PART_ADDON ? signedKobo(l.price) : parseNaira(l.price);
      const sheetCost = parseNaira(l.cost);
      if (sheetPrice === undefined) { problems.push(`${where}: "${l.price}" is not a price. Use digits only, like 15000.`); continue; }
      if (sheetCost === undefined) { problems.push(`${where}: "${l.cost}" is not a cost. Use digits only, like 9000.`); continue; }

      if (l.part === PART_TABLE) {
        const isArea = !!grid.area;
        // A quantity the product does not have yet becomes a new step, so one sheet can carry the steps as well as the prices.
        const q = isTier ? /^q:(\d+)$/.exec(l.keyB) : null;
        const newStep = q && !colIds.has(l.keyB) ? Number(q[1]) : null;
        if (newStep != null && !(newStep >= 1 && newStep <= MAX_QUANTITY)) {
          problems.push(`${where}: ${newStep.toLocaleString('en-US')} pieces is outside what the shop takes (1 to ${MAX_QUANTITY.toLocaleString('en-US')}).`);
          continue;
        }
        if (!rowIds.has(l.keyA) || (isArea ? l.keyB !== 'a' : !colIds.has(l.keyB) && newStep == null)) {
          problems.push(`${where}: this price is no longer in the grid (the choices or quantities changed since the sheet was made). Download a fresh sheet.`);
          continue;
        }
        const old = isArea ? grid.area![l.keyA] : grid.cells[`${l.keyA}|${l.keyB}`];
        const oldPrice = old ? (isArea ? (old as any).rate : (old as any).price) : null;
        const oldCost = old?.cost ?? null;
        const newPrice = sheetPrice ?? oldPrice;
        const newCost = sheetCost ?? oldCost;
        const confirm = !!old?.placeholder && l.real && sheetPrice != null;
        if (newPrice === oldPrice && newCost === oldCost && !confirm) { unchanged++; continue; }
        if (newStep != null) addedQuantities.add(newStep);
        cells.push({ row: l.keyA, col: l.keyB, price: asNaira(newPrice), cost: asNaira(newCost), min: isArea ? String((old as any)?.minArea ?? usualMin ?? '') : undefined, confirm });
      } else {
        // Three kinds of line: a flat extra ("value"), a one-time setup charge ("value#setup"), and an extra that depends on size ("value@size").
        const setupLine = l.keyB.endsWith('#setup');
        const at = setupLine ? -1 : l.keyB.indexOf('@');
        const value = setupLine ? l.keyB.slice(0, -'#setup'.length) : at >= 0 ? l.keyB.slice(0, at) : l.keyB;
        const sizeKey = at >= 0 ? l.keyB.slice(at + 1) : null;
        const o = options.find((x) => x.key === l.keyA);
        const c = o?.choices.find((x) => x.value === value);
        const stored = p.options.find((x) => x.key === l.keyA)?.choices.find((x) => x.value === value);
        if (!o || !c || !stored) { problems.push(`${where}: this add-on is no longer on the product. Download a fresh sheet.`); continue; }
        if (stored.percent || stored.price_like) { problems.push(`${where}: this add-on's price is worked out another way, so it can only be changed in the console.`); continue; }
        if (sizeKey != null && !stored.by) { problems.push(`${where}: this add-on no longer varies with size. Download a fresh sheet.`); continue; }
        if (sizeKey == null && !setupLine && stored.by) { problems.push(`${where}: this add-on now varies with size, so it has a price for each size. Download a fresh sheet.`); continue; }
        if ((setupLine || sizeKey != null) && sheetCost != null) { problems.push(`${where}: a cost cannot be set on this kind of line. Leave Cost empty, or set it in the console.`); continue; }
        if (setupLine && sheetPrice != null && sheetPrice < 0) { problems.push(`${where}: a setup charge cannot be less than nothing.`); continue; }
        if (sizeKey != null && !byKeys(p, stored.by!.key).some((k) => k.value === sizeKey)) { problems.push(`${where}: "${sizeKey}" is not one of this product's sizes. Download a fresh sheet.`); continue; }

        const confirm = !!stored.provisional && l.real && sheetPrice != null;
        const oldCost = stored.cost_kobo ?? null;
        const newCost = setupLine || sizeKey != null ? oldCost : sheetCost ?? oldCost;
        // The line says what the price is charged on ("per piece"); a choice waiting for a price has not been told yet.
        const unit = sheetPrice != null && !setupLine ? unitOfText(l.size) : null;
        const oldUnit = (stored.extra_per ?? intendedUnit(slug, l.keyA, value) ?? 'order') as ExtraPer;
        const unitChanged = !!unit && unit !== (stored.unpriced ? oldUnit : (stored.extra_per ?? 'order'));
        let oldPrice: number | null;
        let newPrice: number | null;
        if (setupLine) { oldPrice = stored.unpriced ? null : stored.setup_kobo ?? null; newPrice = sheetPrice ?? oldPrice; }
        else if (sizeKey != null) { oldPrice = stored.by!.amounts[sizeKey] ?? null; newPrice = sheetPrice ?? oldPrice; }
        else { oldPrice = stored.unpriced ? null : stored.extra_kobo ?? 0; newPrice = sheetPrice ?? oldPrice; }
        if (newPrice === oldPrice && newCost === oldCost && !confirm && !(stored.unpriced && sheetPrice != null) && !unitChanged) { unchanged++; continue; }

        if (setupLine) c.setup = newPrice == null ? '' : String(newPrice / 100);
        else if (sizeKey != null) {
          c.by = c.by ?? { key: stored.by!.key, amounts: {} };
          if (newPrice == null) delete c.by.amounts[sizeKey]; else c.by.amounts[sizeKey] = String(newPrice / 100);
          bySizeTouched.add(`${l.keyA}|${value}`);
        } else {
          c.amount = newPrice == null ? '' : String(newPrice / 100);
          c.cost = newCost == null ? '' : String(newCost / 100);
        }
        if (unit) c.per = unit;
        else if (stored.unpriced && sheetPrice != null && !setupLine) c.per = oldUnit;
        if (newPrice != null) c.unpriced = false;
        if (newPrice !== oldPrice || confirm) c.provisional = false;
        optionsTouched++;
        const sizeLabel = sizeKey != null ? byKeys(p, stored.by!.key).find((k) => k.value === sizeKey)?.label : null;
        notes.push(`${o.label}: ${c.label}${setupLine ? ' (one-time setup)' : sizeLabel ? ` (${sizeLabel})` : ''}${newPrice != null && newPrice !== oldPrice ? `, ${oldPrice == null ? 'now ' : `${nairaText(oldPrice)} → `}${nairaText(newPrice)}${!setupLine && c.per && c.per !== 'order' ? ` ${PER_TEXT[c.per] ?? ''}` : ''}` : ''}`);
      }
    }

    // A price that depends on size needs a price for every size, or the sizes left out would be free.
    for (const key of bySizeTouched) {
      const [optKey, value] = key.split('|');
      const c = options.find((x) => x.key === optKey)?.choices.find((x) => x.value === value);
      const stored = p.options.find((x) => x.key === optKey)?.choices.find((x) => x.value === value);
      if (!c?.by || !stored?.by) continue;
      const have = Object.values(c.by.amounts).some((v) => v !== '' && v != null);
      const missing = byKeys(p, stored.by.key).filter((k) => c.by!.amounts[k.value] == null || c.by!.amounts[k.value] === '');
      if (have && missing.length) problems.push(`${p.name}, ${c.label}: the sheet leaves out the price for ${missing.map((m) => m.label).join(', ')}. A price that depends on size needs one for every size.`);
    }

    let rule: Rule | null = null;
    if (ruleNew.custom !== ruleNow.custom || ruleNew.min !== ruleNow.min || ruleNew.max !== ruleNow.max) {
      rule = ruleNew;
      notes.push(`Quantity rule: ${ruleSentence(ruleNew)}`);
    } else unchanged += ruleLines;

    const existingQuantities = isTier ? grid.cols.map((c) => c.quantity!).filter((q) => q != null) : [];
    if (addedQuantities.size) notes.push(`Quantity steps added: ${[...addedQuantities].sort((a, b) => a - b).map(piecesText).join(', ')}`);
    if (cells.length || optionsTouched || rule) {
      plans.push({
        p, cells, options: optionsTouched ? options : null, addons: optionsTouched, rule, lines: notes,
        quantities: isTier ? [...new Set([...existingQuantities, ...addedQuantities])].sort((a, b) => a - b) : undefined,
      });
    }
  }

  // Delivery fees: matched to the zones by name.
  type ZonePlan = { z: ZoneRow; fee: number; h24: boolean; confirmed: boolean };
  const zonePlans: ZonePlan[] = [];
  if (deliveryLines.length) {
    const zones = await query<ZoneRow>('select id, name, fee_kobo, eligible_24h, provisional from delivery_zones');
    const touched = new Map<string, ZonePlan>();
    for (const l of deliveryLines) {
      const where = `Line ${l.n} (Delivery, ${l.keyA})`;
      const z = zones.find((x) => x.name === l.keyA);
      if (!z) { problems.push(`${where}: there is no delivery zone with this name. Download a fresh sheet.`); continue; }
      const v = l.price.trim();
      if (v === '') continue;
      const zp = touched.get(z.id) ?? { z, fee: z.fee_kobo, h24: z.eligible_24h, confirmed: false };
      if (l.keyB === 'fee') {
        const k = parseNaira(v);
        if (k == null || k < 0) { problems.push(`${where}: "${v}" is not a fee. Use digits only, like 2500.`); continue; }
        zp.fee = k;
      } else if (l.keyB === '24h') {
        const yn = yesNo(v);
        if (yn == null) { problems.push(`${where}: write yes or no for 24-hour delivery.`); continue; }
        zp.h24 = yn;
      } else { problems.push(`${where}: this is not a delivery line. Download a fresh sheet.`); continue; }
      if (l.real) zp.confirmed = true; // "Real price? yes" on a line says the stand-in fee is the real one
      touched.set(z.id, zp);
    }
    for (const zp of touched.values()) {
      if (zp.fee !== zp.z.fee_kobo || zp.h24 !== zp.z.eligible_24h || (zp.z.provisional && zp.confirmed)) zonePlans.push(zp);
      else unchanged++;
    }
  }

  const out: SheetResult = { ok: false, applied: false, products: [], problems, belowCost: [], readLines: lines.length, unchanged };
  if (problems.length) { out.problems = problems.slice(0, MAX_PROBLEMS).concat(problems.length > MAX_PROBLEMS ? [`and ${problems.length - MAX_PROBLEMS} more`] : []); return out; }

  // First everything is tried and undone; only if every product is fine is anything saved.
  const run = async (dry: boolean) => {
    const done: SheetProduct[] = [];
    for (const pl of plans) {
      const prod: SheetProduct = { slug: pl.p.slug, name: pl.p.name, grid: null, addons: 0, lines: [...pl.lines] };
      if (pl.cells.length) {
        prod.grid = await saveGrid(pl.p.id, { quantities: pl.quantities, cells: pl.cells }, actor, { dryRun: dry });
        out.belowCost.push(...prod.grid.belowCost.map((b) => `${pl.p.name}: ${b}`));
      }
      if (pl.options) {
        await saveOptionsV2(pl.p.id, pl.options, actor, { dryRun: dry });
        prod.addons = pl.addons;
      }
      if (pl.rule) await saveQuantityRule(pl.p.id, { custom: pl.rule.custom, min: pl.rule.min == null ? '' : String(pl.rule.min), max: pl.rule.max == null ? '' : String(pl.rule.max) }, actor, { dryRun: dry });
      done.push(prod);
    }
    if (zonePlans.length) {
      const sentences = zonePlans.map((zp) => {
        const bits = [zp.fee !== zp.z.fee_kobo ? `fee ${nairaText(zp.z.fee_kobo)} → ${nairaText(zp.fee)}` : `fee ${nairaText(zp.fee)} confirmed`, `24-hour delivery ${zp.h24 ? 'yes' : 'no'}`];
        return `${zp.z.name}: ${bits.join(', ')}`;
      });
      await inTx(dry, async (q) => {
        for (const zp of zonePlans) await q.query('update delivery_zones set fee_kobo = $2, eligible_24h = $3, provisional = false where id = $1', [zp.z.id, zp.fee, zp.h24]);
        await logHistory(q, actor, null, 'delivery', `Delivery fees saved: ${sentences.join('; ')}.`, { zones: zonePlans.map((zp) => ({ name: zp.z.name, fee_kobo: zp.fee, eligible_24h: zp.h24 })) });
      });
      done.push({ slug: DELIVERY_KEY, name: 'Delivery fees', grid: null, addons: 0, lines: sentences });
    }
    return done;
  };
  try {
    out.belowCost = [];
    const tried = await run(true);
    if (opts.dryRun) out.products = tried;
    else {
      out.belowCost = [];
      out.products = await run(false);
    }
    out.applied = !opts.dryRun && (plans.length > 0 || zonePlans.length > 0);
    out.ok = true;
  } catch (e) {
    if (e instanceof ProductError) { out.problems = [e.message]; out.products = []; out.belowCost = []; return out; }
    throw e;
  }
  return out;
}
