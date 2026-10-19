import { one, tx } from './db';
import { ProductError } from './productAdmin';
import { MAX_QUANTITY } from './pricing';
import { gridRows } from './priceGrid';
import { logHistory, loadGrid, inTx, type Actor } from './priceAdmin';
import { MAX_PIECES } from './options';
import type { OptionIn } from './optionsForm';
export type { ChoiceIn, OptionIn } from './optionsForm';
import type { Condition, ExtraPer, OptionChoice, OptionKind, Package, PricingMode, ProductOption, QuantityRule } from './types';

/*
 * What the console does to a product's options (finish, paper, sides...), its packages (Standard, Premium, Luxury) and
 * its quantity rule. The editor sends one JSON list; this reads it, checks it and says in plain words what is wrong.
 */

export const MAX_OPTIONS = 24;
export const MAX_CHOICES = 16;
export const MAX_DRIVERS = 4;
export const MAX_GRID_ROWS = 400;
export const MAX_PACKAGES = 4;
const MAX_MONEY_KOBO = 1_000_000_000; // ₦10 million

const PER: ExtraPer[] = ['order', 'piece', 'sqft', 'foot', 'position'];

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
function uniqueKey(base: string, taken: Set<string>, fallback: string): string {
  const root = slug(base) || fallback;
  let k = root;
  for (let i = 2; taken.has(k); i++) k = `${root}-${i}`;
  taken.add(k);
  return k;
}

/** "1,500" or "-500" in naira to kobo; empty is null; anything else is undefined. */
function money(v: unknown, allowNegative: boolean): number | null | undefined {
  const raw = String(v ?? '').trim().replace(/[₦\s,]/g, '');
  if (raw === '') return null;
  if (!new RegExp(`^${allowNegative ? '-?' : ''}\\d+(\\.\\d{1,2})?$`).test(raw)) return undefined;
  return Math.round(Number(raw) * 100);
}

function cleanCondition(raw: Condition | null | undefined, who: string, optionKeys: Set<string>, self: string | null, valuesOf: Map<string, Set<string>>, mode: PricingMode): Condition | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Condition = {};
  for (const [k, vals] of Object.entries(raw)) {
    if (!Array.isArray(vals) || !vals.length) continue;
    if (k === self) throw new ProductError(`${who} cannot depend on itself.`);
    if (k === 'size' && mode === 'size') { out[k] = vals.map(String); continue; }
    if (!optionKeys.has(k)) throw new ProductError(`${who} depends on an option that no longer exists. Open it and choose again.`);
    const known = valuesOf.get(k)!;
    const good = vals.map(String).filter((v) => known.has(v));
    if (!good.length) throw new ProductError(`${who} depends on choices that no longer exist. Open it and choose again.`);
    out[k] = good;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A option that needs another that needs the first can never be shown. */
function findCycle(options: ProductOption[]): string | null {
  const deps = new Map(options.map((o) => [o.key, Object.keys(o.only_if ?? {}).filter((k) => k !== 'size')]));
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (k: string, trail: string[]): string | null => {
    if (state.get(k) === 1) return [...trail, k].join(' → ');
    if (state.get(k) === 2) return null;
    state.set(k, 1);
    for (const d of deps.get(k) ?? []) { const c = visit(d, [...trail, k]); if (c) return c; }
    state.set(k, 2);
    return null;
  };
  for (const o of options) { const c = visit(o.key, []); if (c) return c; }
  return null;
}

export function cleanOptionsV2(input: unknown, mode: PricingMode, existing: ProductOption[] = []): ProductOption[] {
  if (!Array.isArray(input)) throw new ProductError('The options could not be read. Reload the page and try again.');
  if (input.length > MAX_OPTIONS) throw new ProductError(`A product can have up to ${MAX_OPTIONS} options.`);
  const rawOptions = input as OptionIn[];
  const oldBy = new Map(existing.map((o) => [o.key, o]));

  // Pass 1: keys, so conditions can point at options that come later in the list.
  const taken = new Set<string>();
  const keyOf: string[] = [];
  for (const raw of rawOptions) {
    const label = clean(raw?.label, 40);
    if (!label) throw new ProductError('Every option needs a name, such as "Finish" or "Paper".');
    keyOf.push(raw.key && /^[a-z0-9_-]{1,48}$/.test(raw.key) && !taken.has(raw.key) ? (taken.add(raw.key), raw.key) : uniqueKey(label, taken, 'option'));
  }
  const optionKeys = new Set(keyOf);
  const valuesOf = new Map<string, Set<string>>();
  const valueLists: string[][] = [];
  rawOptions.forEach((raw, i) => {
    const vt = new Set<string>();
    const list: string[] = [];
    for (const c of raw.choices ?? []) {
      const cl = clean(c?.label, 40);
      if (!cl) { list.push(''); continue; }
      const v = c.value && /^[a-z0-9_-]{1,48}$/.test(c.value) && !vt.has(c.value) ? (vt.add(c.value), c.value) : uniqueKey(cl, vt, 'choice');
      list.push(v);
    }
    valueLists.push(list);
    valuesOf.set(keyOf[i], vt);
  });

  const hasPositions = rawOptions.some((o) => o.positions);
  const out: ProductOption[] = [];
  rawOptions.forEach((raw, i) => {
    const key = keyOf[i];
    const label = clean(raw.label, 40);
    const kind: OptionKind = raw.kind === 'tick' || raw.kind === 'split' ? raw.kind : 'pick';
    const prior = oldBy.get(key);
    const choices: OptionChoice[] = [];
    const idx: number[] = [];
    (raw.choices ?? []).forEach((c, j) => { if (valueLists[i][j]) idx.push(j); });
    if (idx.length > MAX_CHOICES) throw new ProductError(`"${label}" has more than ${MAX_CHOICES} choices.`);
    const minChoices = kind === 'pick' ? 2 : 1;
    if (idx.length < minChoices) throw new ProductError(kind === 'pick' ? `"${label}" needs at least two choices. An option with one choice is not a choice.` : `"${label}" needs at least one choice.`);
    if (raw.drives && kind !== 'pick') throw new ProductError(`"${label}" is a ${kind === 'tick' ? 'tick-box' : 'count'} option, so it cannot pick the price table. Only "choose one" options can.`);

    let defaultFromIndex: string | undefined;
    for (const j of idx) {
      const c = raw.choices[j];
      const value = valueLists[i][j];
      const cl = clean(c.label, 40);
      const who = `"${cl}" in "${label}"`;
      const choice: OptionChoice = { value, label: cl };
      const note = clean(c.note, 120);
      if (note) choice.note = note;
      if (c.swatch && /^#[0-9a-fA-F]{6}$/.test(c.swatch)) choice.swatch = c.swatch;
      if (c.hidden) choice.hidden = true;

      const amount = money(c.amount, true);
      const setup = money(c.setup, false);
      const cost = money(c.cost, false);
      if (amount === undefined) throw new ProductError(`The extra price for ${who} must be an amount in naira, like 2000 (or -500 for a saving).`);
      if (setup === undefined) throw new ProductError(`The one-time setup charge for ${who} must be an amount in naira, like 8000.`);
      if (cost === undefined) throw new ProductError(`The cost for ${who} must be an amount in naira, like 900.`);
      for (const [n, what] of [[amount, 'extra price'], [setup, 'setup charge'], [cost, 'cost']] as const) if (n != null && Math.abs(n) > MAX_MONEY_KOBO) throw new ProductError(`The ${what} for ${who} looks like a typo.`);
      const per = (PER as string[]).includes(String(c.per)) ? (c.per as ExtraPer) : 'order';
      if ((per === 'sqft' || per === 'foot') && mode !== 'area') throw new ProductError(`"Per square foot" and "per foot" charges only make sense for products priced by the square foot (${who}).`);
      if (per === 'position' && !hasPositions) throw new ProductError(`"Per print position" needs an option marked as the print positions (${who}).`);
      let pct: number | null = null;
      if (String(c.percent ?? '').trim() !== '') {
        pct = Number(String(c.percent).replace('%', ''));
        if (!Number.isFinite(pct) || pct < -90 || pct > 300) throw new ProductError(`The percentage for ${who} must be between -90 and 300.`);
      }
      let by: OptionChoice['by'];
      if (c.by && c.by.key) {
        const amounts: Record<string, number> = {};
        for (const [k, v] of Object.entries(c.by.amounts ?? {})) {
          const m = money(v, true);
          if (m === undefined) throw new ProductError(`An amount for ${who} must be in naira, like 1500.`);
          if (m != null) amounts[k] = m;
        }
        if (c.by.key !== 'size' && !optionKeys.has(c.by.key)) throw new ProductError(`The prices for ${who} depend on an option that no longer exists.`);
        by = { key: c.by.key, amounts };
      }
      const anyPrice = (amount != null && amount !== 0) || (setup != null && setup > 0) || (pct != null && pct !== 0) || (by ? Object.keys(by.amounts).length > 0 : false);
      if (amount != null && amount !== 0 && !by) { choice.extra_kobo = amount; choice.extra_per = per; }
      if (by) { choice.by = by; if (Object.keys(by.amounts).length || per !== 'order') choice.extra_per = per; }
      if (setup) choice.setup_kobo = setup;
      if (pct) choice.percent = pct;
      if (cost != null) { choice.cost_kobo = cost; choice.cost_per = (PER as string[]).includes(String(c.costPer)) ? (c.costPer as ExtraPer) : per; }

      // Waiting for a price, or a placeholder, only when that is what is stored.
      const was = prior?.choices.find((x) => x.value === value);
      const priceChanged = !was || was.extra_kobo !== choice.extra_kobo || was.setup_kobo !== choice.setup_kobo || was.percent !== choice.percent || JSON.stringify(was.by ?? null) !== JSON.stringify(choice.by ?? null);
      if (c.unpriced && !anyPrice) choice.unpriced = true;
      if (c.provisional && was?.provisional && !priceChanged && !choice.unpriced) choice.provisional = true;

      const cond = cleanCondition(c.only_if, who, optionKeys, key, valuesOf, mode);
      if (cond) choice.only_if = cond;
      for (const [f, v] of [['min_qty', c.min_qty], ['max_qty', c.max_qty]] as const) {
        if (String(v ?? '').trim() === '') continue;
        const n = Math.trunc(Number(v));
        if (!(n >= 1 && n <= MAX_PIECES)) throw new ProductError(`"At least / at most" for ${who} must be a whole number of pieces.`);
        choice[f] = n;
      }
      if (choice.min_qty && choice.max_qty && choice.min_qty > choice.max_qty) throw new ProductError(`${who} has a smallest quantity bigger than its largest.`);
      if (c.price_like) {
        if (!raw.drives) throw new ProductError(`${who} shares another choice's price table, which only works for options that pick the price table.`);
        const target = raw.choices.findIndex((x, n) => valueLists[i][n] === c.price_like);
        if (target < 0 || c.price_like === value || raw.choices[target]?.price_like) throw new ProductError(`${who} can only share the price table of another choice that has its own.`);
        choice.price_like = c.price_like;
      }
      for (const f of ['w_in', 'h_in'] as const) {
        if (String(c[f] ?? '').trim() === '') continue;
        const n = Number(c[f]);
        if (!(n > 0 && n <= 400)) throw new ProductError(`The ${f === 'w_in' ? 'width' : 'height'} of ${who} must be a number of inches.`);
        choice[f] = n;
      }
      choices.push(choice);
      if (j === raw.defaultIndex) defaultFromIndex = value;
    }

    // Defaults
    let def: string;
    if (kind === 'tick') {
      const wanted = raw.defaultIndexes ? raw.defaultIndexes.map((j) => valueLists[i][j]).filter(Boolean) : String(raw.default ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      def = choices.map((c) => c.value).filter((v) => wanted.includes(v)).join(',');
    } else if (kind === 'split') {
      const parts = raw.defaultCounts
        ? idx.map((j) => `${valueLists[i][j]}:${Math.trunc(Number(raw.defaultCounts![j])) || 0}`)
        : String(raw.default ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const ok = parts.filter((p) => choices.some((c) => c.value === p.split(':')[0]) && Number(p.split(':')[1]) > 0);
      def = ok.join(',') || `${choices[0].value}:1`;
    } else {
      const auto = (raw.auto ?? []).filter((a) => String(a.min_qty).trim() !== '' && a.value);
      def = defaultFromIndex ?? choices.find((c) => c.value === raw.default)?.value ?? choices[0].value;
      if (auto.length && !choices.some((c) => c.value === 'auto')) def = choices[0].value;
    }

    const opt: ProductOption = { key, label, default: def, choices };
    const help = clean(raw.help, 140);
    if (help) opt.help = help;
    if (kind !== 'pick') opt.kind = kind;
    if (raw.special) opt.group = 'special';
    if (raw.drives) opt.drives = true;
    if (raw.positions) {
      if (kind !== 'tick') throw new ProductError(`"${label}" can only be the print positions if it is a tick-box option.`);
      opt.role = 'positions';
    }
    const cond = cleanCondition(raw.only_if, `"${label}"`, optionKeys, key, valuesOf, mode);
    if (cond) opt.only_if = cond;
    if (raw.auto?.length) {
      if (kind !== 'pick') throw new ProductError(`"Best for the quantity" only works for "choose one" options ("${label}").`);
      const auto = raw.auto.filter((a) => String(a.min_qty).trim() !== '').map((a) => ({ min_qty: Math.trunc(Number(a.min_qty)), value: a.value }));
      for (const a of auto) {
        if (!(a.min_qty >= 1 && a.min_qty <= MAX_PIECES)) throw new ProductError(`The quantity where "${label}" changes must be a whole number.`);
        if (!choices.some((c) => c.value === a.value && c.value !== 'auto')) throw new ProductError(`"${label}" switches to a choice that does not exist.`);
      }
      if (auto.length && !choices.some((c) => c.value === 'auto')) throw new ProductError(`"${label}" needs a choice called "Best for your quantity" for the automatic rule to use.`);
      if (auto.length) opt.auto = auto.sort((a, b) => a.min_qty - b.min_qty);
    }
    out.push(opt);
  });

  const cycle = findCycle(out);
  if (cycle) throw new ProductError(`Some options wait for each other and could never show: ${cycle.split(' → ').map((k) => out.find((o) => o.key === k)?.label ?? k).join(' → ')}.`);
  const drivers = out.filter((o) => o.drives);
  if (drivers.length > MAX_DRIVERS) throw new ProductError(`Up to ${MAX_DRIVERS} options can pick the price table. More would make a grid too big to fill in.`);
  const rows = gridRows(out).length;
  if (rows > MAX_GRID_ROWS) throw new ProductError(`The options that pick the price table make ${rows} rows. Keep it to ${MAX_GRID_ROWS} or fewer by sharing tables ("prices like...") or using add-ons instead.`);
  if (out.filter((o) => o.role === 'positions').length > 2) throw new ProductError('At most two options can be print positions (for example, one for T-shirts and one for bags).');
  return out;
}

export type OptionsSaveReport = { stray: number; summary: string };

export async function saveOptionsV2(productId: string, input: unknown, actor: Actor, opts: { dryRun?: boolean } = {}): Promise<OptionsSaveReport> {
  const p = await one<{ pricing_mode: PricingMode; name: string; options: ProductOption[] }>('select pricing_mode, name, options from products where id = $1 and not system', [productId]);
  if (!p) throw new ProductError('We could not find that product.');
  const options = cleanOptionsV2(input, p.pricing_mode, p.options ?? []);
  // A package that names a choice that is gone would never price.
  const pk = await one<{ packages: Package[] }>('select packages from products where id = $1', [productId]);
  const broken = (pk?.packages ?? []).filter((g) => Object.entries(g.set).some(([k, v]) => {
    const o = options.find((x) => x.key === k);
    return !o || String(v).split(',').filter(Boolean).some((x) => !o.choices.some((c) => c.value === x));
  }));
  if (broken.length) throw new ProductError(`The ${broken.map((b) => `"${b.label}"`).join(' and ')} package uses a choice you are removing. Change the package first (Options and packages, Packages).`);
  await inTx(opts.dryRun, async (q) => {
    await q.query('update products set options = $2 where id = $1', [productId, JSON.stringify(options)]);
    await logHistory(q, actor, { id: productId, name: p.name }, 'options', `${p.name}: options saved (${options.map((o) => o.label).join(', ') || 'none'}).`, { options: options.map((o) => ({ key: o.key, choices: o.choices.map((c) => c.value) })) });
  });
  const stray = opts.dryRun ? 0 : (await loadGrid(productId)).orphans.length;
  return { stray, summary: `${p.name}: options saved.` };
}

// ---------- Packages ----------
type PackageIn = { key?: string; label: string; tagline?: string; badge?: string; set: Record<string, string> };

export function cleanPackages(input: unknown, options: ProductOption[]): Package[] {
  if (!Array.isArray(input)) throw new ProductError('The packages could not be read. Reload the page and try again.');
  if (input.length > MAX_PACKAGES) throw new ProductError(`A product can have up to ${MAX_PACKAGES} packages.`);
  const taken = new Set<string>();
  const out: Package[] = [];
  for (const raw of input as PackageIn[]) {
    const label = clean(raw?.label, 24);
    if (!label) throw new ProductError('Every package needs a name, such as "Standard" or "Premium".');
    const key = raw.key && /^[a-z0-9_-]{1,32}$/.test(raw.key) && !taken.has(raw.key) ? (taken.add(raw.key), raw.key) : uniqueKey(label, taken, 'package');
    const set: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.set ?? {})) {
      const o = options.find((x) => x.key === k);
      if (!o) throw new ProductError(`The "${label}" package uses an option that no longer exists.`);
      const kind = o.kind ?? 'pick';
      if (kind === 'split') continue; // counts are the customer's to choose
      const vals = String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (kind === 'pick') {
        if (v === undefined || v === null || v === '') continue; // "leave as is"
        if (!o.choices.some((c) => c.value === v)) throw new ProductError(`The "${label}" package picks a choice that does not exist in "${o.label}".`);
        set[k] = String(v);
      } else {
        const bad = vals.find((x) => !o.choices.some((c) => c.value === x));
        if (bad) throw new ProductError(`The "${label}" package ticks a choice that does not exist in "${o.label}".`);
        set[k] = o.choices.map((c) => c.value).filter((x) => vals.includes(x)).join(',');
      }
    }
    if (!Object.keys(set).length) throw new ProductError(`The "${label}" package does not set anything. Choose at least one option for it.`);
    const pkg: Package = { key, label, set };
    const tagline = clean(raw.tagline, 70);
    const badge = clean(raw.badge, 18);
    if (tagline) pkg.tagline = tagline;
    if (badge) pkg.badge = badge;
    out.push(pkg);
  }
  return out;
}

export async function savePackages(productId: string, input: unknown, actor: Actor) {
  const p = await one<{ name: string; options: ProductOption[] }>('select name, options from products where id = $1 and not system', [productId]);
  if (!p) throw new ProductError('We could not find that product.');
  const packages = cleanPackages(input, p.options ?? []);
  await tx(async (q) => {
    await q.query('update products set packages = $2 where id = $1', [productId, JSON.stringify(packages)]);
    await logHistory(q, actor, { id: productId, name: p.name }, 'options', `${p.name}: packages saved (${packages.map((g) => g.label).join(', ') || 'none'}).`, { packages });
  });
}

// ---------- Quantity rule ----------
export async function saveQuantityRule(productId: string, input: { custom: boolean; min: string; max: string }, actor: Actor, opts: { dryRun?: boolean } = {}) {
  const p = await one<{ name: string; pricing_mode: PricingMode }>('select name, pricing_mode from products where id = $1 and not system', [productId]);
  if (!p) throw new ProductError('We could not find that product.');
  if (p.pricing_mode !== 'tier') throw new ProductError('Only products priced by quantity can take a quantity between the steps.');
  const num = (v: string, what: string): number | null => {
    if (String(v ?? '').trim() === '') return null;
    const n = Math.trunc(Number(v));
    if (!(n >= 1 && n <= MAX_QUANTITY)) throw new ProductError(`The ${what} must be a whole number between 1 and ${MAX_QUANTITY.toLocaleString('en-US')}.`);
    return n;
  };
  const min = num(input.min, 'smallest order');
  const max = num(input.max, 'largest online order');
  if (min != null && max != null && min > max) throw new ProductError('The smallest order cannot be bigger than the largest.');
  const rule: QuantityRule = { custom: !!input.custom, min, max };
  await inTx(opts.dryRun, async (q) => {
    await q.query('update products set qty_custom = $2, qty_min = $3, qty_max = $4 where id = $1', [productId, rule.custom, rule.min, rule.max]);
    await logHistory(q, actor, { id: productId, name: p.name }, 'options', `${p.name}: ${rule.custom ? `customers may type their own quantity${rule.min ? ` from ${rule.min.toLocaleString('en-US')}` : ''}${rule.max ? ` up to ${rule.max.toLocaleString('en-US')}` : ''}` : 'customers pick from the quantity steps only'}.`, rule);
  });
}


// ---------- Sizes (products priced by size) ----------
export type SizeIn = { key?: string; label: string; w_in: string | number; h_in: string | number };

/** The sizes of a product priced by size. Prices live in the grid, one column per size; a size that is taken away takes its prices with it. */
export async function saveSizesOnly(productId: string, rows: unknown, actor: Actor): Promise<{ removedPrices: number }> {
  const p = await one<{ name: string; pricing_mode: PricingMode }>('select name, pricing_mode from products where id = $1 and not system', [productId]);
  if (!p) throw new ProductError('We could not find that product.');
  if (p.pricing_mode !== 'size') throw new ProductError('This product is not priced by size.');
  if (!Array.isArray(rows) || rows.length === 0) throw new ProductError('Add at least one size.');
  if (rows.length > 12) throw new ProductError('Up to 12 sizes are allowed.');
  const keys = new Set<string>();
  const sizes: { key: string; label: string; w_in: number; h_in: number }[] = [];
  for (const r of rows as SizeIn[]) {
    const label = clean(r.label, 50);
    if (!label) throw new ProductError('Every size needs a name, such as "A4" or "12 × 16 in".');
    const w = Number(r.w_in);
    const h = Number(r.h_in);
    if (!(w > 0 && w <= 400 && h > 0 && h <= 400)) throw new ProductError(`Give the width and height of "${label}" in inches. They are used to check that a customer's file is sharp enough.`);
    const key = r.key && /^[a-z0-9_-]{1,48}$/.test(r.key) && !keys.has(r.key) ? (keys.add(r.key), r.key) : uniqueKey(label, keys, 'size');
    sizes.push({ key, label, w_in: w, h_in: h });
  }
  return tx(async (q) => {
    await q.query('update products set sizes = $2 where id = $1', [productId, JSON.stringify(sizes)]);
    const gone = await q.query<{ id: string }>('delete from price_rules where product_id = $1 and size_key is not null and not (size_key = any($2::text[])) returning id', [productId, sizes.map((s) => s.key)]);
    await logHistory(q, actor, { id: productId, name: p.name }, 'options', `${p.name}: sizes saved (${sizes.map((s) => s.label).join(', ')}).${gone.length ? ` ${gone.length} price${gone.length === 1 ? '' : 's'} removed with the sizes taken away.` : ''}`, { sizes, removedPrices: gone.length });
    return { removedPrices: gone.length };
  });
}
