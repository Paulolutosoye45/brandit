import { one, query, tx } from './db';
import type { Q } from './db';
import { getSettings } from './settings';
import { appUrl, queueMessage } from './messages';
import { naira } from './money';
import { randomCode } from './couponCore';
import { isDemoEnv } from './envcheck';

/*
 * The sample pack: a small box of Brandit's real work, sent before a customer commits to a big order.
 *  - It is an ordinary product with sample = true. It needs no artwork, so it never waits for a file.
 *  - What the customer pays comes back as a coupon for their first real order, issued when the pack is out for delivery.
 *  - It starts switched off with no price: the owner sets the price and decides what goes in the box, then switches it on.
 *    (The demo site starts with it on, so the flow can be tried.)
 */

export const SAMPLE_SLUG = 'sample-pack';
const EXAMPLE_PRICE_KOBO = 500_000;

type Db = Pick<Q, 'query'>;

/** Adds the sample-pack product once. Safe to run at every start; never changes a product the team has already edited. */
export async function ensureSamplePack(d: Db): Promise<boolean> {
  const demo = isDemoEnv(process.env);
  const made = await d.query<{ id: string }>(
    `insert into products (slug, name, blurb, pricing_mode, options, sizes, check_class, active, sort, description, highlights, category, packages, qty_custom, qty_min, qty_max, allow_custom, sample)
     values ($1,'Sample pack','A small box of our real work: paper, finishes and colour. What you pay comes back as credit on your first order.','tier','[]','[]','print',$2,
       (select coalesce(max(sort), 0) + 1 from products), $3, $4, '', '[]', false, 1, 1, false, true)
     on conflict (slug) do nothing returning id`,
    [
      SAMPLE_SLUG, demo,
      'Not sure which paper or finish to pick? We send you a small box of real Brandit prints, so you can hold them, bend them and compare them before you order.\n\nWhat you pay for the sample pack comes back to you as credit. When the box is on its way we send you a code for the same amount, to use on your first order.',
      ['No artwork needed', 'Delivered like any other order', 'The price comes back as credit on your first order'],
    ],
  );
  if (!made.length) return false;
  const id = made[0].id;
  await d.query("insert into promise_rules (product_id, eligible_24h, standard_days) values ($1,false,3) on conflict do nothing", [id]);
  // On a live site there is no price until the owner enters one, so the pack cannot go on sale by accident.
  if (demo) await d.query('insert into price_rules (product_id, quantity, price_kobo, provisional, active) values ($1,1,$2,true,true)', [id, EXAMPLE_PRICE_KOBO]);
  return true;
}

/** Mark a line as a sample: nothing to print, so it counts as having its artwork settled. */
export async function markSampleLine(q: Db, itemId: string) {
  await q.query(`update order_items set artwork_path = 'upload', design_brief = '{"kind":"sample"}', preview_approved_at = now(), artwork_file_id = null where id = $1`, [itemId]);
}

const firstName = (n: unknown) => String(n ?? '').trim().split(/\s+/)[0] || 'there';

/**
 * Turn what a customer paid for a sample pack into a coupon for their first real order.
 * It happens when the pack leaves for delivery, so the message "your sample pack is on its way" is true.
 * One order gets one coupon, ever: the order is claimed in the same step that makes the coupon.
 */
export async function issueSampleCredits(now = new Date()): Promise<number> {
  const s = await getSettings();
  const days = Math.max(7, Math.min(365, Math.trunc(s.sample_credit_days) || 60));
  const rows = await query<any>(
    `select o.id, o.code, o.customer_id, c.name as cname,
            sum(i.line_total_kobo)::int as kobo
       from orders o
       join customers c on c.id = o.customer_id
       join order_items i on i.order_id = o.id
       join products p on p.id = i.product_id and p.sample
       join jobs j on j.order_item_id = i.id and j.stage in ('out_for_delivery', 'delivered')
      where o.status in ('paid', 'in_production', 'delivered') and o.sample_coupon_id is null and o.customer_id is not null
      group by o.id, o.code, o.customer_id, c.name
      order by o.paid_at limit 20`,
  );
  let n = 0;
  for (const r of rows) {
    if (!(r.kobo > 0)) continue;
    const ok = await tx(async (q) => {
      let couponId: string | null = null;
      let code = '';
      for (let i = 0; i < 6 && !couponId; i++) {
        code = randomCode('SAMPLE');
        const row = await q.query<{ id: string }>(
          `insert into coupons (code, description, kind, amount_off_kobo, min_subtotal_kobo, max_redemptions, max_per_customer, first_order_only, product_ids, active, source, owner_customer_id, ends_at)
           values ($1,$2,'fixed',$3,0,1,1,false,'{}',true,'sample',$4,$5) on conflict do nothing returning id`,
          [code, `Credit from the sample pack on order ${r.code}`, r.kobo, r.customer_id, new Date(now.getTime() + days * 86_400_000).toISOString()],
        );
        couponId = row[0]?.id ?? null;
      }
      if (!couponId) return false;
      const claimed = await q.query('update orders set sample_coupon_id = $2 where id = $1 and sample_coupon_id is null returning id', [r.id, couponId]);
      if (!claimed.length) throw new Error('already credited'); // rolls the coupon back
      await queueMessage(q, { orderId: r.id, template: 'sample_credit', vars: { name: firstName(r.cname), amount: naira(r.kobo), code, days: String(days), link: `${appUrl()}/products` } });
      await q.query("insert into events (name, props) values ('sample_credit_issued', $1)", [JSON.stringify({ order: r.code })]);
      return true;
    }).catch((e) => (String(e?.message) === 'already credited' ? false : Promise.reject(e)));
    if (ok) n++;
  }
  return n;
}

/** Whether an order holds a sample pack, for the console and the customer's order page. */
export async function hasSample(orderId: string): Promise<boolean> {
  const r = await one<{ n: number }>('select count(*)::int as n from order_items i join products p on p.id = i.product_id where i.order_id = $1 and p.sample', [orderId]);
  return (r?.n ?? 0) > 0;
}
