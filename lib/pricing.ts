import type { PricingMode, ProductOption } from './types';

export type PriceRule = {
  config: Record<string, string>;
  quantity: number | null;
  size_key: string | null;
  price_kobo: number | null;
  rate_per_sqft_kobo: number | null;
  min_area_sqft: number | null;
  active: boolean;
};

export type ItemInput = {
  quantity: number;
  config: Record<string, string>;
  sizeKey?: string;
  widthFt?: number;
  heightFt?: number;
};

export type PriceResult = { totalKobo: number; areaSqft: number | null; unitLabel: string };

export class PriceError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** A rule applies when every option it names matches the customer's choice. An empty config applies to all. */
export function sameConfig(ruleCfg: Record<string, string>, input: Record<string, string>): boolean {
  return Object.entries(ruleCfg ?? {}).every(([k, v]) => input[k] === v);
}

export const MAX_QUANTITY = 5000;
export const MAX_SIDE_FT = 50;

/**
 * Server-side price for one line. Three modes cover every product:
 *  tier: fixed quantity steps (cards, flyers, posters, stickers)
 *  area: by the square foot (flex banners)
 *  size: per piece by size (frames, roll-ups, T-shirts, ID cards)
 */
export function priceItem(mode: PricingMode, rulesIn: PriceRule[], input: ItemInput): PriceResult {
  const rules = rulesIn.filter((r) => r.active);
  const q = input.quantity;
  if (!Number.isInteger(q) || q < 1 || q > MAX_QUANTITY) throw new PriceError('BAD_QUANTITY', 'Choose a quantity between 1 and 5,000.');

  if (mode === 'tier') {
    const rule = rules.find((r) => r.quantity === q && sameConfig(r.config, input.config));
    if (!rule || rule.price_kobo == null) throw new PriceError('NO_PRICE_FOR_QUANTITY', 'We do not have a price for that quantity yet.');
    return { totalKobo: rule.price_kobo, areaSqft: null, unitLabel: `${q.toLocaleString('en-US')}` };
  }

  if (mode === 'area') {
    const w = Number(input.widthFt);
    const h = Number(input.heightFt);
    if (!(w > 0) || !(h > 0)) throw new PriceError('BAD_SIZE', 'Enter a width and a height in feet.');
    if (w > MAX_SIDE_FT || h > MAX_SIDE_FT) throw new PriceError('TOO_BIG', `Each side can be up to ${MAX_SIDE_FT} ft. For anything bigger, ask us for a quote.`);
    const rule = rules.find((r) => r.rate_per_sqft_kobo != null && sameConfig(r.config, input.config));
    if (!rule) throw new PriceError('NO_PRICE', 'We do not have a price for this yet.');
    const eachArea = Math.max(Math.ceil(w * h), Math.ceil(Number(rule.min_area_sqft ?? 0)));
    const totalArea = eachArea * q;
    return { totalKobo: totalArea * rule.rate_per_sqft_kobo!, areaSqft: totalArea, unitLabel: `${w} × ${h} ft` };
  }

  const rule = rules.find((r) => r.size_key === (input.sizeKey ?? 'each') && sameConfig(r.config, input.config));
  if (!rule || rule.price_kobo == null) throw new PriceError('NO_PRICE_FOR_SIZE', 'We do not have a price for that size yet.');
  return { totalKobo: rule.price_kobo * q, areaSqft: null, unitLabel: input.sizeKey ?? 'each' };
}

/**
 * What the customer's choices add to the price. A choice can carry an extra amount: once per order,
 * once per piece, or once per square foot. Choices without an extra add nothing.
 */
export function optionSurcharge(options: ProductOption[], config: Record<string, string>, ctx: { quantity: number; areaSqft: number | null }): number {
  let sum = 0;
  for (const o of options) {
    const c = o.choices.find((x) => x.value === config[o.key]);
    const extra = c?.extra_kobo ?? 0;
    if (!c || !(extra > 0)) continue;
    const per = c.extra_per ?? 'order';
    sum += per === 'piece' ? extra * ctx.quantity : per === 'sqft' ? extra * Math.ceil(ctx.areaSqft ?? 0) : extra;
  }
  return Math.round(sum);
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
