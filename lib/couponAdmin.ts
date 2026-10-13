import { query, one } from './db';
import { CODE_PATTERN, normalizeCode, randomCode } from './couponCore';
import { parseNaira } from './custom';
import { lagosDate } from './time';
import type { Coupon } from './coupons';

export class CouponError extends Error {}

export type NewCoupon = {
  code: string;
  description: string;
  kind: string;
  percent: string;
  amount: string;
  cap: string;
  minSpend: string;
  startsOn: string;
  endsOn: string;
  maxRedemptions: string;
  perCustomer: string;
  firstOrderOnly: boolean;
  productIds: string[];
};

const ymd = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

function intOrNull(v: string, label: string, min = 1, max = 10_000_000): number | null {
  if (!v?.trim()) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new CouponError(`${label} must be a whole number${max < 1_000_000 ? ` from ${min} to ${max.toLocaleString('en-US')}` : min > 0 ? ` of at least ${min}` : ''}.`);
  return n;
}

function dates(startsOn: string, endsOn: string) {
  const starts = startsOn?.trim() ? (ymd.test(startsOn) ? lagosDate(startsOn, '00:00') : null) : undefined;
  const ends = endsOn?.trim() ? (ymd.test(endsOn) ? lagosDate(endsOn, '23:59') : null) : undefined;
  if (starts === null || ends === null) throw new CouponError('Pick the dates from the calendar.');
  if (starts && ends && ends <= starts) throw new CouponError('The last day must come after the first day.');
  return { starts: starts ?? null, ends: ends ?? null };
}

export async function createCoupon(i: NewCoupon, staffId: string | null): Promise<Coupon> {
  const code = normalizeCode(i.code) || randomCode();
  if (!CODE_PATTERN.test(code)) throw new CouponError('A code needs 3 to 24 letters, numbers or dashes, such as WELCOME10.');
  if (await one('select 1 as x from coupons where upper(code) = $1', [code])) throw new CouponError(`The code ${code} already exists. Pick another or leave it empty to make one for you.`);
  if (!['percent', 'fixed', 'free_delivery'].includes(i.kind)) throw new CouponError('Choose what the coupon gives.');

  let percent: number | null = null;
  let amount: number | null = null;
  let cap: number | null = null;
  if (i.kind === 'percent') {
    percent = intOrNull(i.percent, 'The percentage', 1, 100);
    if (percent == null) throw new CouponError('Enter the percentage off, from 1 to 100.');
    if (i.cap?.trim()) { cap = parseNaira(i.cap); if (cap == null || cap <= 0) throw new CouponError('The most it can take off must be an amount in naira, like 5000. Or leave it empty.'); }
  } else if (i.kind === 'fixed') {
    amount = parseNaira(i.amount);
    if (amount == null || amount <= 0) throw new CouponError('Enter the amount off in naira, like 1000.');
  }
  let min = 0;
  if (i.minSpend?.trim()) { const m = parseNaira(i.minSpend); if (m == null) throw new CouponError('The smallest order must be an amount in naira, or empty.'); min = m; }
  const { starts, ends } = dates(i.startsOn, i.endsOn);
  const maxRed = intOrNull(i.maxRedemptions, 'The total number of uses');
  const perCustomer = intOrNull(i.perCustomer, 'Uses per customer', 1, 1000) ?? 1;
  const ids = (i.productIds ?? []).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const description = clean(i.description, 80);

  const r = await one<Coupon>(
    `insert into coupons (code, description, kind, percent_off, amount_off_kobo, max_discount_kobo, min_subtotal_kobo, starts_at, ends_at, max_redemptions, max_per_customer, first_order_only, product_ids, active, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14) returning *`,
    [code, description, i.kind, percent, amount, cap, min, starts?.toISOString() ?? null, ends?.toISOString() ?? null, maxRed, perCustomer, !!i.firstOrderOnly, ids, staffId],
  );
  return r!;
}

export async function setCouponActive(id: string, on: boolean) {
  await query('update coupons set active = $2 where id = $1', [id, on]);
}

/** Dates and limits can change after launch. What the coupon gives cannot, so past redemptions keep their meaning. */
export async function updateCouponLimits(id: string, i: { description: string; endsOn: string; maxRedemptions: string }) {
  const c = await one<Coupon>('select * from coupons where id = $1', [id]);
  if (!c) throw new CouponError('We could not find that coupon.');
  const ends = i.endsOn?.trim() ? (ymd.test(i.endsOn) ? lagosDate(i.endsOn, '23:59') : null) : undefined;
  if (ends === null) throw new CouponError('Pick the last day from the calendar.');
  if (ends && c.starts_at && ends <= new Date(c.starts_at)) throw new CouponError('The last day must come after the first day.');
  const maxRed = intOrNull(i.maxRedemptions, 'The total number of uses');
  await query('update coupons set description = $2, ends_at = $3, max_redemptions = $4 where id = $1', [id, clean(i.description, 80), ends?.toISOString() ?? null, maxRed]);
}

export async function deleteCoupon(id: string) {
  const used = await one<{ n: number }>('select count(*)::int as n from coupon_redemptions where coupon_id = $1', [id]);
  if (used?.n) throw new CouponError('This coupon has been used, so it cannot be deleted. Pause it instead and the history stays.');
  await query('update orders set coupon_id = null, coupon_code = null, discount_kobo = 0 where coupon_id = $1 and status in (\'draft\',\'awaiting_payment\')', [id]);
  try {
    await query('delete from coupons where id = $1', [id]);
  } catch {
    throw new CouponError('This coupon is attached to an order, so it cannot be deleted. Pause it instead.');
  }
}

export type CouponState = 'active' | 'scheduled' | 'ended' | 'paused' | 'used_up';
export function stateOf(c: Pick<Coupon, 'active' | 'starts_at' | 'ends_at' | 'max_redemptions'>, redemptions: number, now = new Date()): CouponState {
  if (!c.active) return 'paused';
  if (c.ends_at && new Date(c.ends_at) < now) return 'ended';
  if (c.starts_at && new Date(c.starts_at) > now) return 'scheduled';
  if (c.max_redemptions != null && redemptions >= c.max_redemptions) return 'used_up';
  return 'active';
}
