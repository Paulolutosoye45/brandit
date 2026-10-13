import { query, type Q } from './db';
import { getProduct, getRules, zoneForArea } from './catalog';
import { getSettings } from './settings';
import { priceItem, optionSurcharge, PriceError } from './pricing';
import { promise as makePromise, type PromiseResult, type Reason } from './promise';
import { describeArrival, describeDay, nextWorkingDay, productionDay } from './time';
import type { Product, Zone } from './types';

export type QuoteInput = {
  slug: string;
  quantity: number;
  config?: Record<string, string>;
  sizeKey?: string;
  widthFt?: number;
  heightFt?: number;
  area?: string | null;
  pickup?: boolean;
  needBy?: string | null; // ISO date-time the customer needs it by
};

export type Quote = {
  ok: true;
  product: Product;
  config: Record<string, string>;
  sizeKey: string | null;
  quantity: number;
  priceKobo: number;
  extrasKobo: number;
  unitLabel: string;
  areaSqft: number | null;
  zone: Zone | null;
  deliveryKobo: number;
  tier: '24h' | 'standard';
  reasons: Reason[];
  reasonTexts: string[];
  arriveBy: string;
  arrivalText: string;
  productionDay: string;
  cutoffAt: string;
  countdownMs: number | null;
  slotsLeft: number;
  meetsDeadline: boolean | null;
  printW: number | null;
  printH: number | null;
  promiseResult: PromiseResult;
};
export type QuoteFail = { ok: false; code: string; message: string };

export async function slotsUsedOn(day: string, excludeOrderId?: string, q: Q = { query }): Promise<number> {
  const r = await q.query<{ n: number }>(
    `select count(*)::int as n from orders where speed = '24h' and production_day = $1 and status in ('paid','in_production','delivered')
     and ($2::uuid is null or id <> $2::uuid)`,
    [day, excludeOrderId ?? null],
  );
  return r[0]?.n ?? 0;
}

export function cleanConfig(product: Product, input: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of product.options) {
    const v = input?.[o.key];
    out[o.key] = o.choices.some((c) => c.value === v) ? (v as string) : o.default;
  }
  return out;
}

export function sizeRankOf(product: Product, sizeKey: string | null): number | null {
  if (!sizeKey) return null;
  const i = product.sizes.findIndex((s) => s.key === sizeKey);
  return i < 0 ? null : i;
}

export function printDims(product: Product, sizeKey: string | null, widthFt?: number | null, heightFt?: number | null): { w: number; h: number } | null {
  if (product.pricing_mode === 'area') return widthFt && heightFt ? { w: widthFt * 12, h: heightFt * 12 } : null;
  if (product.pricing_mode === 'size') {
    const s = product.sizes.find((x) => x.key === sizeKey) ?? product.sizes[0];
    return s ? { w: s.w_in, h: s.h_in } : null;
  }
  return product.print_w_in && product.print_h_in ? { w: product.print_w_in, h: product.print_h_in } : null;
}

export async function makeQuote(input: QuoteInput, now: Date = new Date()): Promise<Quote | QuoteFail> {
  const product = await getProduct(input.slug);
  if (!product || !product.active) return { ok: false, code: 'NO_PRODUCT', message: 'We could not find that product.' };
  const { price: priceRules, promise: promiseRule } = await getRules(product.id);
  const config = cleanConfig(product, input.config);
  const sizeKey = product.pricing_mode === 'size' ? (product.sizes.some((s) => s.key === input.sizeKey) ? (input.sizeKey as string) : (product.sizes[0]?.key ?? 'each')) : null;

  let priced;
  try {
    priced = priceItem(product.pricing_mode, priceRules, { quantity: Math.trunc(Number(input.quantity)), config, sizeKey: sizeKey ?? undefined, widthFt: input.widthFt, heightFt: input.heightFt });
  } catch (e) {
    if (e instanceof PriceError) return { ok: false, code: e.code, message: e.message };
    throw e;
  }

  const quantity = Math.trunc(Number(input.quantity));
  const extrasKobo = optionSurcharge(product.options, config, { quantity, areaSqft: priced.areaSqft });
  const settings = await getSettings();
  const zone = await zoneForArea(input.area);
  const pickup = !!input.pickup;
  const day = productionDay(now, settings);
  const used = await slotsUsedOn(day);
  const choices = Object.entries(config).map(([k, v]) => `${k}:${v}`);
  const p = makePromise({
    rule: promiseRule,
    settings,
    zoneEligible24h: zone ? zone.eligible_24h : true,
    pickup,
    quantity,
    totalAreaSqft: priced.areaSqft,
    sizeRank: sizeRankOf(product, sizeKey),
    choices,
    slotsUsed: used,
    now,
  });

  const maxSize = promiseRule.max_size_rank != null ? product.sizes[promiseRule.max_size_rank] : null;
  const reasonTexts = p.reasons.map((r): string => {
    switch (r) {
      case 'PRODUCT': return 'This product is not part of 24-hour printing yet.';
      case 'QUANTITY': return `24-hour printing covers up to ${promiseRule.max_quantity} for this product. Order ${promiseRule.max_quantity} or fewer to qualify.`;
      case 'AREA': return `24-hour printing covers up to ${promiseRule.max_area_sqft} sq ft in total. Bring the total area to ${promiseRule.max_area_sqft} sq ft or less to qualify.`;
      case 'SIZE': return `24-hour printing covers frames up to ${maxSize?.label ?? 'a smaller size'}. Choose that size or smaller to qualify.`;
      case 'FINISH': return 'One of your choices needs extra production time.';
      case 'ZONE': return 'We cannot promise 24-hour delivery to this area yet. Pick up from us, or choose a closer area, to qualify.';
      case 'PAUSED': return '24-hour slots are paused right now. Standard delivery is shown.';
      case 'FULL': return `All 24-hour slots for ${describeDay(day, now)} are taken. Standard delivery is shown.`;
    }
  });

  let meetsDeadline: boolean | null = null;
  if (input.needBy) {
    const nb = new Date(input.needBy);
    if (!isNaN(nb.getTime())) meetsDeadline = p.arriveBy <= nb;
  }

  const startsToday = describeDay(day, now) === 'today';
  return {
    ok: true,
    product,
    config,
    sizeKey,
    quantity,
    priceKobo: priced.totalKobo + extrasKobo,
    extrasKobo,
    unitLabel: priced.unitLabel,
    areaSqft: priced.areaSqft,
    zone,
    deliveryKobo: pickup ? 0 : (zone?.fee_kobo ?? 0),
    tier: p.tier,
    reasons: p.reasons,
    reasonTexts,
    arriveBy: p.arriveBy.toISOString(),
    arrivalText: pickup ? `ready for pickup ${describeArrival(p.arriveBy, now)}` : `arrives ${describeArrival(p.arriveBy, now)}`,
    productionDay: day,
    cutoffAt: p.cutoffAt.toISOString(),
    countdownMs: startsToday && p.tier === '24h' ? Math.max(0, p.cutoffAt.getTime() - now.getTime()) : null,
    slotsLeft: p.slotsLeft,
    meetsDeadline,
    printW: printDims(product, sizeKey, input.widthFt, input.heightFt)?.w ?? null,
    printH: printDims(product, sizeKey, input.widthFt, input.heightFt)?.h ?? null,
    promiseResult: p,
  };
}

export const nextDay = (ymd: string, cal: Parameters<typeof nextWorkingDay>[1]) => nextWorkingDay(ymd, cal);
void query;
