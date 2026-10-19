import type { PricingMode, ProductOption } from './types';
import { surchargeKobo } from './options';

export type PriceRule = {
  config: Record<string, string>;
  quantity: number | null;
  size_key: string | null;
  price_kobo: number | null;
  rate_per_sqft_kobo: number | null;
  min_area_sqft: number | null;
  active: boolean;
  /** What this cell costs Brandit (per square foot for area prices). Optional; the console uses it for margins. */
  cost_kobo?: number | null;
};

export type ItemInput = {
  quantity: number;
  config: Record<string, string>;
  sizeKey?: string;
  widthFt?: number;
  heightFt?: number;
  /** Allow a quantity between the steps (and past the last one), within these limits. */
  custom?: { min: number | null; max: number | null };
};

export type PriceResult = {
  totalKobo: number;
  areaSqft: number | null;
  unitLabel: string;
  /** What the base price costs us, when the rule records it. */
  costKobo: number | null;
  /** step: an exact quantity in the table. between/above: worked out from the step below. */
  basis: 'step' | 'between' | 'above';
  /** The step the price was worked out from (for between/above). */
  fromStep: number | null;
};

export class PriceError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** A rule applies when every option it names matches the customer's choice. An empty config applies to all. */
export function sameConfig(ruleCfg: Record<string, string>, input: Record<string, string>): boolean {
  return Object.entries(ruleCfg ?? {}).every(([k, v]) => input[k] === v);
}

/** The most pieces one line may hold. Flyers, posters and stickers are ordered in the thousands. */
export const MAX_QUANTITY = 10000;
export const MAX_SIDE_FT = 50;

const specificity = (r: PriceRule) => Object.keys(r.config ?? {}).length;

/** Of the rules that apply, the one that names the most options wins (a paper-specific price beats a general one). */
function best<T extends PriceRule>(rules: T[]): T | undefined {
  let top: T | undefined;
  for (const r of rules) if (!top || specificity(r) > specificity(top)) top = r;
  return top;
}

/** The quantity steps that have a price for these choices, each with the rule that prices it. */
export function stepsFor(rulesIn: PriceRule[], config: Record<string, string>): { quantity: number; rule: PriceRule }[] {
  const byQty = new Map<number, PriceRule[]>();
  for (const r of rulesIn) {
    if (!r.active || r.quantity == null || r.price_kobo == null || !sameConfig(r.config, config)) continue;
    byQty.set(r.quantity, [...(byQty.get(r.quantity) ?? []), r]);
  }
  return [...byQty.entries()].sort((a, b) => a[0] - b[0]).map(([quantity, rs]) => ({ quantity, rule: best(rs)! }));
}

/**
 * Whether a quantity that is not one of the steps can be priced. A table with a single pack size (100 cards for one price)
 * is a fixed pack, so only that quantity is offered. A table with two or more steps, or one priced per piece (a step
 * of 1), can be worked out between and beyond its steps.
 */
export const allowsCustom = (steps: { quantity: number }[]): boolean => steps.length > 1 || (steps.length === 1 && steps[0].quantity === 1);

/**
 * Server-side price for one line. Three modes cover every product:
 *  tier: quantity steps (cards, flyers, posters, stickers, tees). A quantity between steps is priced at the per-piece
 *        price of the step below, but never more than the next step up, so ordering more is never dearer.
 *  area: by the square foot (flex banners)
 *  size: per piece by size (frames, roll-ups)
 */
export function priceItem(mode: PricingMode, rulesIn: PriceRule[], input: ItemInput): PriceResult {
  const rules = rulesIn.filter((r) => r.active);
  const q = input.quantity;
  if (!Number.isInteger(q) || q < 1 || q > MAX_QUANTITY) throw new PriceError('BAD_QUANTITY', `Choose a quantity between 1 and ${MAX_QUANTITY.toLocaleString('en-US')}.`);

  if (mode === 'tier') {
    const steps = stepsFor(rules, input.config);
    const exact = steps.find((s) => s.quantity === q);
    if (exact) {
      return { totalKobo: exact.rule.price_kobo!, areaSqft: null, unitLabel: `${q.toLocaleString('en-US')}`, costKobo: exact.rule.cost_kobo ?? null, basis: 'step', fromStep: null };
    }
    const c = input.custom;
    if (c && allowsCustom(steps)) {
      // The table's first step is the smallest order its prices can honestly cover.
      const min = Math.max(c.min ?? 1, steps[0].quantity);
      const max = Math.min(c.max ?? MAX_QUANTITY, MAX_QUANTITY);
      if (q < min) throw new PriceError('BELOW_MINIMUM', `The smallest order is ${min.toLocaleString('en-US')}.`);
      if (q > max) throw new PriceError('ABOVE_MAXIMUM', `The largest online order is ${max.toLocaleString('en-US')}. For more, ask us for a quote.`);
      let lo: (typeof steps)[number] | undefined;
      let hi: (typeof steps)[number] | undefined;
      for (const s of steps) { if (s.quantity < q) lo = s; else if (!hi) hi = s; }
      if (lo) {
        const unit = lo.rule.price_kobo! / lo.quantity;
        let total = Math.ceil((unit * q) / 100) * 100; // whole naira
        if (hi) total = Math.min(total, hi.rule.price_kobo!);
        const costUnit = lo.rule.cost_kobo != null ? lo.rule.cost_kobo / lo.quantity : null;
        return { totalKobo: total, areaSqft: null, unitLabel: `${q.toLocaleString('en-US')}`, costKobo: costUnit != null ? Math.round(costUnit * q) : null, basis: hi ? 'between' : 'above', fromStep: lo.quantity };
      }
    }
    throw new PriceError('NO_PRICE_FOR_QUANTITY', 'We do not have a price for that quantity yet.');
  }

  if (mode === 'area') {
    const w = Number(input.widthFt);
    const h = Number(input.heightFt);
    if (!(w > 0) || !(h > 0)) throw new PriceError('BAD_SIZE', 'Enter a width and a height in feet.');
    if (w > MAX_SIDE_FT || h > MAX_SIDE_FT) throw new PriceError('TOO_BIG', `Each side can be up to ${MAX_SIDE_FT} ft. For anything bigger, ask us for a quote.`);
    const rule = best(rules.filter((r) => r.rate_per_sqft_kobo != null && sameConfig(r.config, input.config)));
    if (!rule) throw new PriceError('NO_PRICE', 'We do not have a price for this yet.');
    const eachArea = Math.max(Math.ceil(w * h), Math.ceil(Number(rule.min_area_sqft ?? 0)));
    const totalArea = eachArea * q;
    return { totalKobo: totalArea * rule.rate_per_sqft_kobo!, areaSqft: totalArea, unitLabel: `${w} × ${h} ft`, costKobo: rule.cost_kobo != null ? totalArea * rule.cost_kobo : null, basis: 'step', fromStep: null };
  }

  const rule = best(rules.filter((r) => r.size_key === (input.sizeKey ?? 'each') && r.price_kobo != null && sameConfig(r.config, input.config)));
  if (!rule || rule.price_kobo == null) throw new PriceError('NO_PRICE_FOR_SIZE', 'We do not have a price for that size yet.');
  return { totalKobo: rule.price_kobo * q, areaSqft: null, unitLabel: input.sizeKey ?? 'each', costKobo: rule.cost_kobo != null ? rule.cost_kobo * q : null, basis: 'step', fromStep: null };
}

/**
 * What the customer's choices add to the price: once per order, once per piece, once per square foot and so on.
 * Choices without an extra add nothing. (The full breakdown, with conditions and packages, is in priceEngine.)
 */
export function optionSurcharge(options: ProductOption[], config: Record<string, string>, ctx: { quantity: number; areaSqft: number | null; sizeKey?: string | null }): number {
  return Math.round(surchargeKobo(options, config, ctx));
}

/** Short text for a choice button: "+₦2,000", "+₦20 each", "+₦100 per sq ft". Empty when it costs nothing extra. */
export function extraLabel(c: { extra_kobo?: number; extra_per?: string }, fmt: (kobo: number) => string): string {
  if (!c.extra_kobo || c.extra_kobo <= 0) return '';
  return `+${fmt(c.extra_kobo)}${c.extra_per === 'piece' ? ' each' : c.extra_per === 'sqft' ? ' per sq ft' : ''}`;
}

export type OrderTotals = {
  subtotalKobo: number;
  deliveryKobo: number;
  designKobo: number;
  discountKobo: number;
  vatKobo: number;
  totalKobo: number;
};

/**
 * Totals for the order. By default shown prices already include VAT, so VAT is
 * worked out from the total for the invoice. Set pricesIncludeVat false to add it on top.
 */
export function priceOrder(o: {
  itemsKobo: number[];
  deliveryFeeKobo: number;
  pickup: boolean;
  designFeeKobo?: number;
  /** A coupon's discount. It can never take the total below zero. VAT is worked out on what the customer actually pays. */
  discountKobo?: number;
  vatRate: number;
  pricesIncludeVat: boolean;
}): OrderTotals {
  const subtotalKobo = o.itemsKobo.reduce((a, b) => a + b, 0);
  const deliveryKobo = o.pickup ? 0 : o.deliveryFeeKobo;
  const designKobo = o.designFeeKobo ?? 0;
  const gross = subtotalKobo + deliveryKobo + designKobo;
  const discountKobo = Math.max(0, Math.min(Math.round(o.discountKobo ?? 0), gross));
  const base = gross - discountKobo;
  if (o.pricesIncludeVat) {
    const vatKobo = Math.round((base * o.vatRate) / (1 + o.vatRate));
    return { subtotalKobo, deliveryKobo, designKobo, discountKobo, vatKobo, totalKobo: base };
  }
  const vatKobo = Math.round(base * o.vatRate);
  return { subtotalKobo, deliveryKobo, designKobo, discountKobo, vatKobo, totalKobo: base + vatKobo };
}
