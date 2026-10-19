import { MAX_QUANTITY, PriceError, allowsCustom, priceItem, sameConfig, stepsFor, type PriceRule } from './pricing';
import { choiceStatus, extrasFor, kindOf, resolveSelection, ruleConfig, selectedOf, sellable, type ChoiceStatus, type SelectionOptions } from './options';
import type { Package, Product, ProductOption } from './types';

/*
 * One price, decided in one place. Everything the customer picks goes in; the price and a plain-words breakdown come out.
 * It is a pure function of the product, its price rules and the choices, so the same call powers the shop, the
 * console preview, the price test and the order that is saved. Nothing here reads the database or the clock.
 */

export type EngineProduct = Pick<Product, 'slug' | 'name' | 'pricing_mode' | 'options' | 'sizes' | 'packages' | 'qty_custom' | 'qty_min' | 'qty_max'>;
export type EngineInput = { quantity: number; config?: Record<string, string> | null; sizeKey?: string | null; widthFt?: number; heightFt?: number };
export type EngineOptions = SelectionOptions;

export type PriceLine = {
  kind: 'base' | 'extra' | 'percent';
  label: string;
  detail: string;
  kobo: number;
};

export type Priced = {
  quantity: number;
  config: Record<string, string>;
  effective: Record<string, string>;
  /** What the table was looked up with (auto choices resolved, shared tables swapped in). */
  tableConfig: Record<string, string>;
  sizeKey: string | null;
  notes: string[];
  areaSqft: number | null;
  unitLabel: string;
  baseKobo: number;
  /** Add-ons, setups and percentage charges together. */
  extrasKobo: number;
  totalKobo: number;
  lines: PriceLine[];
  /** What it costs Brandit, or null while any cost is missing. */
  costKobo: number | null;
  basis: 'step' | 'between' | 'above';
  fromStep: number | null;
};

export const sizeKeyFor = (p: Pick<Product, 'pricing_mode' | 'sizes'>, asked?: string | null): string | null =>
  p.pricing_mode === 'size' ? (p.sizes.some((s) => s.key === asked) ? (asked as string) : (p.sizes[0]?.key ?? 'each')) : null;

/**
 * Lets "Best for your quantity" skip a choice that no price table covers. It only looks at which cells exist, never at
 * the quantity, so a method with a table that starts at 50 is still picked for 60 and passed over for 3 by the quantity rule.
 */
function withUsable(product: EngineProduct, rules: PriceRule[], opt: EngineOptions): EngineOptions {
  if (opt.usable) return opt;
  const live = rules.filter((r) => r.active && (r.price_kobo != null || r.rate_per_sqft_kobo != null));
  const like = (key: string, value: string) => product.options.find((o) => o.key === key)?.choices.find((c) => c.value === value)?.price_like ?? value;
  return {
    ...opt,
    usable: (key, value, soFar) => {
      // Only a choice that some price table names can be ruled out: a choice no table mentions does not change the price.
      if (!live.some((r) => r.config?.[key] !== undefined)) return true;
      const v = like(key, value);
      return live.some((r) => {
        const cfg = r.config ?? {};
        if (cfg[key] !== undefined && cfg[key] !== v) return false;
        return Object.entries(cfg).every(([k, rv]) => k === key || soFar[k] === undefined || like(k, soFar[k]) === rv);
      });
    },
  };
}

const plainNaira = (k: number) => `₦${(k / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** The labels of the choices that pick the base price table, in words: "350gsm card, A5". */
function driverWords(options: ProductOption[], effective: Record<string, string>): string {
  return options
    .filter((o) => o.drives && effective[o.key] !== undefined)
    .map((o) => o.choices.find((c) => c.value === effective[o.key])?.label)
    .filter(Boolean)
    .join(', ');
}

export function priceConfigured(product: EngineProduct, rules: PriceRule[], input: EngineInput, opt: EngineOptions = {}): Priced {
  opt = withUsable(product, rules, opt);
  const sizeKey = sizeKeyFor(product, input.sizeKey);
  const asked = Math.trunc(Number(input.quantity));
  const sel = resolveSelection(product.options, { config: input.config, sizeKey, quantity: Number.isFinite(asked) ? asked : 0 }, opt);
  const quantity = sel.quantity ?? asked;
  if (sel.quantity !== null && sel.quantity < 1) throw new PriceError('NO_PIECES', 'Choose how many of each size you need.');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) throw new PriceError('BAD_QUANTITY', `Choose a quantity between 1 and ${MAX_QUANTITY.toLocaleString('en-US')}.`);

  const tableConfig = ruleConfig(sel.active, sel.effective);
  const base = priceItem(product.pricing_mode, rules, {
    quantity,
    config: tableConfig,
    sizeKey: sizeKey ?? undefined,
    widthFt: input.widthFt,
    heightFt: input.heightFt,
    custom: product.pricing_mode === 'tier' && product.qty_custom ? { min: product.qty_min, max: product.qty_max } : undefined,
  });

  const w = Number(input.widthFt);
  const h = Number(input.heightFt);
  const perimeterFt = product.pricing_mode === 'area' && w > 0 && h > 0 ? Math.ceil(2 * (w + h)) * quantity : null;
  const ex = extrasFor(sel.active, sel.effective, { quantity, areaSqft: base.areaSqft, perimeterFt, sizeKey });

  const lines: PriceLine[] = [];
  const words = driverWords(sel.active, sel.effective);
  lines.push({
    kind: 'base',
    label: product.name,
    detail: [
      product.pricing_mode === 'area' ? `${base.areaSqft} sq ft` : product.pricing_mode === 'size' ? `${quantity.toLocaleString('en-US')} × ${product.sizes.find((s) => s.key === sizeKey)?.label ?? ''}`.trim() : `${quantity.toLocaleString('en-US')}`,
      words,
      base.basis !== 'step' && base.fromStep ? `priced like the ${base.fromStep.toLocaleString('en-US')} step` : '',
    ].filter(Boolean).join(' · '),
    kobo: base.totalKobo,
  });
  let extras = 0;
  for (const l of ex.lines) {
    if (!l.kobo) continue;
    lines.push({ kind: 'extra', label: l.label, detail: l.how, kobo: l.kobo });
    extras += l.kobo;
  }
  const subtotal = base.totalKobo + extras;
  for (const p of ex.percents) {
    const kobo = Math.round((subtotal * p.percent) / 100);
    if (!kobo) continue;
    lines.push({ kind: 'percent', label: p.label, detail: `${p.percent > 0 ? '+' : ''}${p.percent}%`, kobo });
    extras += kobo;
  }
  const total = Math.max(0, base.totalKobo + extras);

  let costKobo: number | null = null;
  if (base.costKobo != null && ex.costComplete) {
    costKobo = base.costKobo + ex.lines.reduce((a, l) => a + (l.costKobo ?? 0), 0);
  }

  return {
    quantity,
    config: sel.config,
    effective: sel.effective,
    tableConfig,
    sizeKey,
    notes: sel.notes,
    areaSqft: base.areaSqft,
    unitLabel: base.unitLabel,
    baseKobo: base.totalKobo,
    extrasKobo: extras,
    totalKobo: total,
    lines,
    costKobo,
    basis: base.basis,
    fromStep: base.fromStep,
  };
}

// ---------- Quantity ladder ----------
export type LadderStep = { quantity: number; totalKobo: number; unitKobo: number; savePct: number | null };

/** The price of each quantity step with the current choices, and what each saves per piece against the first step. */
export function ladderFor(product: EngineProduct, rules: PriceRule[], input: EngineInput, opt: EngineOptions = {}): LadderStep[] {
  opt = withUsable(product, rules, opt);
  if (product.pricing_mode !== 'tier') return [];
  const sel = resolveSelection(product.options, { config: input.config, sizeKey: null, quantity: Math.trunc(Number(input.quantity)) || 1 }, opt);
  if (sel.quantity !== null) return []; // garment sizes decide the quantity
  const steps = stepsFor(rules, ruleConfig(sel.active, sel.effective));
  const out: LadderStep[] = [];
  let first: number | null = null;
  for (const s of steps) {
    try {
      const p = priceConfigured(product, rules, { ...input, quantity: s.quantity }, opt);
      const unit = p.totalKobo / s.quantity;
      if (first === null) first = unit;
      const save = first > 0 ? Math.round((1 - unit / first) * 100) : 0;
      out.push({ quantity: s.quantity, totalKobo: p.totalKobo, unitKobo: Math.round(unit), savePct: out.length && save > 0 ? save : null });
    } catch (e) {
      if (!(e instanceof PriceError)) throw e;
    }
  }
  return out;
}

// ---------- Packages ----------
export type PackagePrice = { key: string; label: string; tagline: string; badge: string; totalKobo: number; selected: boolean };

const sameSet = (a: string | undefined, b: string | undefined) => {
  const x = (a ?? '').split(',').filter(Boolean).sort().join(',');
  const y = (b ?? '').split(',').filter(Boolean).sort().join(',');
  return x === y;
};

/** Each package at the current quantity. A package that cannot be built from choices on sale right now is left out. */
export function packagePrices(product: EngineProduct, rules: PriceRule[], input: EngineInput, opt: EngineOptions = {}): PackagePrice[] {
  opt = withUsable(product, rules, opt);
  const out: PackagePrice[] = [];
  const current = resolveSelection(product.options, { config: input.config, sizeKey: sizeKeyFor(product, input.sizeKey), quantity: Math.trunc(Number(input.quantity)) || 1 }, opt);
  for (const pkg of product.packages ?? []) {
    try {
      const wanted = { ...(input.config ?? {}), ...pkg.set };
      const p = priceConfigured(product, rules, { ...input, config: wanted }, opt);
      // A package that had to be changed to fit (a choice was off or unpriced) is not a package we can honestly offer.
      if (p.notes.length) continue;
      const selected = Object.entries(pkg.set).every(([k, v]) => sameSet(current.config[k], v));
      out.push({ key: pkg.key, label: pkg.label, tagline: pkg.tagline ?? '', badge: pkg.badge ?? '', totalKobo: p.totalKobo, selected });
    } catch (e) {
      if (!(e instanceof PriceError)) throw e;
    }
  }
  return out;
}

// ---------- What can be picked right now ----------
export type Availability = {
  /** Quantity steps that have a price with the current choices. */
  quantities: number[];
  choices: Record<string, Record<string, ChoiceStatus>>;
};

/** True when some price cell exists that names this choice, whatever the other choices are. */
function cellExists(rules: PriceRule[], key: string, value: string): boolean {
  return rules.some((r) => r.active && (r.price_kobo != null || r.rate_per_sqft_kobo != null) && r.config?.[key] === value);
}

/**
 * Which quantities and which choices are open with the choices made now.
 * A choice that picks the base price table is open only when the table has a price for it alongside the other choices.
 */
export function availabilityFor(product: EngineProduct, rules: PriceRule[], input: EngineInput, opt: EngineOptions = {}): Availability {
  opt = withUsable(product, rules, opt);
  const sizeKey = sizeKeyFor(product, input.sizeKey);
  const qIn = Math.trunc(Number(input.quantity)) || 1;
  const sel = resolveSelection(product.options, { config: input.config, sizeKey, quantity: qIn }, opt);
  const status = choiceStatus(product.options, sel, { config: input.config, sizeKey, quantity: qIn }, opt, plainNaira);
  const live = rules.filter((r) => r.active);
  const table = ruleConfig(sel.active, sel.effective);

  const custom = product.pricing_mode === 'tier' && product.qty_custom;
  for (const o of sel.active) {
    if (!o.drives) continue;
    const segments = live.some((r) => r.config?.[o.key] !== undefined);
    for (const c of o.choices) {
      const st = status[o.key]?.[c.value];
      if (!st || st.hide) continue;
      if (c.value === 'auto') continue; // "Best for your quantity" has no table of its own: it means whichever choice fits
      const as = c.price_like ?? c.value;
      if (segments && !cellExists(live, o.key, as)) {
        // No price table anywhere for this choice yet.
        if (!opt.preview) st.hide = true;
        else { st.ok = false; st.why = 'No prices entered yet'; }
        continue;
      }
      if (!st.ok) continue;
      // A table exists, but is there a price alongside the other choices made now? Picking this choice can switch other
      // options on or off (a tote has no neckline), so the table is worked out again as if it had been picked.
      const { usable: _skip, ...plain } = opt;
      const asked = resolveSelection(product.options, { config: { ...(input.config ?? {}), ...sel.config, [o.key]: c.value }, sizeKey, quantity: qIn }, plain);
      const trial = { ...ruleConfig(asked.active, asked.effective), [o.key]: as };
      let why: string | null = null;
      if (product.pricing_mode === 'tier') {
        const steps = stepsFor(live, trial);
        if (!steps.length) why = `${c.label} is not offered with your other choices`;
        else if (!steps.some((x) => x.quantity === qIn) && !(custom && allowsCustom(steps) && qIn >= steps[0].quantity)) {
          why = qIn < steps[0].quantity ? `${c.label} is for ${steps[0].quantity.toLocaleString('en-US')} or more` : `${c.label} is not offered at this quantity`;
        }
      } else {
        const has = live.some((r) => sameConfig(r.config, trial) && (product.pricing_mode === 'size' ? r.size_key === (sizeKey ?? 'each') && r.price_kobo != null : r.rate_per_sqft_kobo != null));
        if (!has) why = `${c.label} is not offered with your other choices`;
      }
      if (why) { st.ok = false; st.why = why; }
    }
  }

  const quantities = product.pricing_mode === 'tier' ? stepsFor(live, table).map((s) => s.quantity) : [];
  return { quantities, choices: status };
}

// ---------- The cheapest way to buy ----------
/** The "From ₦X" price: the lowest price among cells that customers can actually buy, and the quantity it is for. */
export function fromPrice(product: Pick<Product, 'pricing_mode' | 'options'>, rules: PriceRule[]): { kobo: number | null; quantity: number | null; ratePerSqft: number | null } {
  const choiceOk = (key: string, value: string) => {
    const o = product.options.find((x) => x.key === key);
    if (!o) return true; // a rule that names an option we no longer have: treat as general
    const c = o.choices.find((x) => x.value === value || x.price_like === value);
    return !!c && sellable(c);
  };
  const usable = rules.filter((r) => r.active && Object.entries(r.config ?? {}).every(([k, v]) => choiceOk(k, v)));
  if (product.pricing_mode === 'area') {
    const rates = usable.map((r) => r.rate_per_sqft_kobo).filter((x): x is number => x != null);
    return { kobo: null, quantity: null, ratePerSqft: rates.length ? Math.min(...rates) : null };
  }
  const priced = usable.filter((r) => r.price_kobo != null);
  if (!priced.length) return { kobo: null, quantity: null, ratePerSqft: null };
  if (product.pricing_mode === 'tier') {
    const q = Math.min(...priced.map((r) => r.quantity ?? Infinity));
    const at = priced.filter((r) => r.quantity === q);
    return { kobo: Math.min(...at.map((r) => r.price_kobo!)), quantity: Number.isFinite(q) ? q : null, ratePerSqft: null };
  }
  return { kobo: Math.min(...priced.map((r) => r.price_kobo!)), quantity: null, ratePerSqft: null };
}

/** What the browser may know about the options: everything a customer can see, and nothing about what it costs us. */
export function publicOptions(options: ProductOption[]): ProductOption[] {
  return options.map((o) => ({
    ...o,
    choices: o.choices
      .filter((c) => sellable(c))
      .map((c) => {
        const { cost_kobo: _a, cost_per: _b, provisional: _c, unpriced: _d, hidden: _e, ...rest } = c;
        return rest;
      }),
  }));
}

export type { Package };
export { kindOf, selectedOf };
