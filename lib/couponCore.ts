import { naira } from './money';

/** The part of a coupon that decides the discount. Pure, so the checkout page and the server work it out the same way. */
export type CouponRule = {
  kind: 'percent' | 'fixed' | 'free_delivery';
  percent_off: number | null;
  amount_off_kobo: number | null;
  max_discount_kobo: number | null;
  min_subtotal_kobo: number;
};

export type DiscountBase = { subtotalKobo: number; designKobo: number; deliveryKobo: number };

/**
 * How much comes off. Percent and fixed coupons reduce the print price only, never delivery or the design fee,
 * and never by more than the print price. Free-delivery coupons take off the delivery fee and nothing else.
 */
export function discountFor(c: CouponRule, o: DiscountBase): number {
  if (o.subtotalKobo < (c.min_subtotal_kobo ?? 0)) return 0;
  if (c.kind === 'free_delivery') return Math.max(0, o.deliveryKobo);
  let d = 0;
  if (c.kind === 'percent') d = Math.round((o.subtotalKobo * (c.percent_off ?? 0)) / 100);
  else d = c.amount_off_kobo ?? 0;
  if (c.max_discount_kobo != null) d = Math.min(d, c.max_discount_kobo);
  return Math.max(0, Math.min(d, o.subtotalKobo));
}

/** Plain words for what a coupon gives: "10% off (up to ₦5,000)", "₦1,000 off", "Free delivery". */
export function couponLabel(c: CouponRule): string {
  const base = c.kind === 'percent' ? `${c.percent_off}% off` : c.kind === 'fixed' ? `${naira(c.amount_off_kobo ?? 0)} off` : 'Free delivery';
  const cap = c.kind === 'percent' && c.max_discount_kobo ? ` (up to ${naira(c.max_discount_kobo)})` : '';
  const min = c.min_subtotal_kobo > 0 ? `, when you spend ${naira(c.min_subtotal_kobo)} or more` : '';
  return `${base}${cap}${min}`;
}

/** Codes are typed on phones: ignore case, spaces and stray punctuation at the ends. */
export function normalizeCode(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '').replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
}
export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,23}$/;

/** A readable random code, with letters that cannot be mistaken for numbers: BRAND-7KQ4X */
export function randomCode(prefix = 'BRAND'): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = new Uint8Array(5);
  globalThis.crypto.getRandomValues(bytes);
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `${prefix}-${s}`;
}
