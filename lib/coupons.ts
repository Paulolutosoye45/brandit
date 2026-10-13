import { query, one, type Q } from './db';
import { discountFor, couponLabel, normalizeCode, type CouponRule } from './couponCore';
import { naira } from './money';
import { ownerCheck } from './couponOwner';

export type Coupon = CouponRule & {
  id: string;
  code: string;
  description: string;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  max_per_customer: number;
  first_order_only: boolean;
  product_ids: string[];
  active: boolean;
  created_at: string;
  source: 'manual' | 'referral' | 'reward';
  owner_customer_id: string | null;
};

export type Identity = { customerId?: string | null; phone?: string | null; email?: string | null };
export type Context = {
  subtotalKobo: number;
  designKobo: number;
  deliveryKobo: number;
  productId: string;
  orderId?: string | null;
  identity?: Identity;
  now?: Date;
  /** Custom quotes are priced by a person. Codes do not stack on top. */
  custom?: boolean;
};
export type Verdict = { ok: true; coupon: Coupon; discountKobo: number } | { ok: false; message: string };

const NOT_VALID = 'That code is not valid. Check the spelling and try again.';

export async function findCoupon(code: string, q: Pick<Q, 'query'> = { query }): Promise<Coupon | null> {
  const c = normalizeCode(code);
  if (!c) return null;
  const rows = await q.query<any>('select * from coupons where upper(code) = $1', [c]);
  return rows[0] ?? null;
}

/** Every rule in one place. The words are what the customer reads, so each says what to do next. */
export async function validateCoupon(code: string, ctx: Context): Promise<Verdict> {
  const now = ctx.now ?? new Date();
  const coupon = await findCoupon(code);
  if (!coupon || !coupon.active) return { ok: false, message: NOT_VALID };
  if (ctx.custom) return { ok: false, message: 'Coupon codes cannot be used on custom quotes. The price already reflects your job.' };
  const blocked = await ownerCheck(coupon, ctx.identity ?? {});
  if (blocked) return { ok: false, message: blocked };
  if (coupon.starts_at && new Date(coupon.starts_at) > now) return { ok: false, message: 'This code is not active yet.' };
  if (coupon.ends_at && new Date(coupon.ends_at) < now) return { ok: false, message: 'This code has expired.' };
  if (coupon.product_ids.length > 0 && !coupon.product_ids.includes(ctx.productId)) return { ok: false, message: 'This code does not apply to this product.' };
  if (ctx.subtotalKobo < coupon.min_subtotal_kobo) return { ok: false, message: `Spend at least ${naira(coupon.min_subtotal_kobo)} on the print to use this code.` };

  if (coupon.max_redemptions != null) {
    const used = await one<{ n: number }>("select count(*)::int as n from coupon_redemptions where coupon_id = $1 and order_id is distinct from $2::uuid", [coupon.id, ctx.orderId ?? null]);
    if ((used?.n ?? 0) >= coupon.max_redemptions) return { ok: false, message: 'This code has reached its limit. Ask us on WhatsApp if there is another offer.' };
  }

  const id = ctx.identity ?? {};
  const phone = id.phone || null;
  const email = id.email ? id.email.trim().toLowerCase() : null;
  const cid = id.customerId || null;
  if (cid || phone || email) {
    const mine = await one<{ n: number }>(
      `select count(*)::int as n from coupon_redemptions
       where coupon_id = $1 and order_id is distinct from $5::uuid
         and (($2::uuid is not null and customer_id = $2::uuid) or ($3::text is not null and phone = $3::text) or ($4::text is not null and lower(email) = $4::text))`,
      [coupon.id, cid, phone, email, ctx.orderId ?? null],
    );
    if ((mine?.n ?? 0) >= coupon.max_per_customer) return { ok: false, message: coupon.max_per_customer === 1 ? 'You have already used this code.' : 'You have used this code as many times as it allows.' };
    if (coupon.first_order_only) {
      const prior = await one<{ n: number }>(
        `select count(*)::int as n from orders o join customers c on c.id = o.customer_id
         where o.paid_at is not null and o.id is distinct from $4::uuid
           and (($1::uuid is not null and c.id = $1::uuid) or ($2::text is not null and c.phone = $2::text) or ($3::text is not null and lower(c.email) = $3::text))`,
        [cid, phone, email, ctx.orderId ?? null],
      );
      if ((prior?.n ?? 0) > 0) return { ok: false, message: 'This code is for first orders only.' };
    }
  } else if (coupon.first_order_only) {
    // Not signed in and no details yet: allowed for now. It is checked again when they enter their details to pay.
  }

  const discountKobo = discountFor(coupon, ctx);
  if (!(discountKobo > 0)) {
    return { ok: false, message: coupon.kind === 'free_delivery' ? 'There is no delivery fee to take off. Choose delivery to use this code.' : NOT_VALID };
  }
  return { ok: true, coupon, discountKobo };
}

/** What the browser needs to show a discount as the customer changes their area. No limits, no counts. */
export const publicCoupon = (c: Coupon) => ({
  code: c.code,
  label: c.description?.trim() || couponLabel(c),
  rule: { kind: c.kind, percent_off: c.percent_off, amount_off_kobo: c.amount_off_kobo, max_discount_kobo: c.max_discount_kobo, min_subtotal_kobo: c.min_subtotal_kobo },
});

/** Record that a paid order used a coupon. Called inside the payment transaction, so it is all-or-nothing with "paid". */
export async function recordRedemption(q: Q, order: { id: string; coupon_id: string | null; discount_kobo: number; customer_id: string | null }) {
  if (!order.coupon_id || !(order.discount_kobo > 0)) return;
  await q.query(
    `insert into coupon_redemptions (coupon_id, order_id, customer_id, phone, email, discount_kobo)
     select $1::uuid, $2::uuid, $3::uuid, c.phone, lower(c.email), $4::int from (select 1) x left join customers c on c.id = $3::uuid
     on conflict (order_id) do nothing`,
    [order.coupon_id, order.id, order.customer_id, order.discount_kobo],
  );
}

export type CouponStats = { redemptions: number; discountKobo: number; revenueKobo: number };
export async function couponStats(): Promise<Map<string, CouponStats>> {
  const rows = await query<any>(
    `select r.coupon_id, count(*)::int as n, coalesce(sum(r.discount_kobo),0)::int as d, coalesce(sum(o.total_kobo),0)::int as rev
     from coupon_redemptions r join orders o on o.id = r.order_id group by r.coupon_id`,
  );
  return new Map(rows.map((r) => [r.coupon_id, { redemptions: r.n, discountKobo: r.d, revenueKobo: r.rev }]));
}
