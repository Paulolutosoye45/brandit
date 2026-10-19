import { one, query } from './db';
import { nameSql } from './lines';
import { emailOn, receiptEmail, sendEmail } from './email';
import { appUrl } from './messages';
import { naira } from './money';
import { describeArrival } from './time';

/** Email the customer a receipt once they have paid. Best effort: it never holds up or breaks a payment. */
export async function sendReceiptEmail(orderId: string): Promise<'sent' | 'skipped'> {
  if (!emailOn()) return 'skipped';
  const r = await one<any>(
    `select o.code, o.public_token, o.total_kobo, o.promised_at, o.pickup, o.speed, c.email, ${nameSql('o')} as product,
              (select i.quantity from order_items i where i.order_id = o.id order by i.position, i.id limit 1) as quantity,
              (select count(*)::int from order_items i where i.order_id = o.id) as lines, o.coupon_code,
              (select discount_kobo from coupon_redemptions cr where cr.order_id = o.id) as discount_kobo
       from orders o join customers c on c.id = o.customer_id where o.id = $1`, [orderId]);
  if (!r?.email) return 'skipped';
  const lineRows = r.lines > 1 ? await query<any>('select coalesce(i.label, p.name) as name, i.quantity from order_items i join products p on p.id = i.product_id where i.order_id = $1 order by i.position, i.id', [orderId]) : [];
  const arrival = r.promised_at ? `${r.pickup ? 'Ready for pickup' : 'Arriving'} ${describeArrival(new Date(r.promised_at), new Date())}.` : 'We set your arrival time when you approve your proof.';
  await sendEmail({ to: r.email, ...receiptEmail({
    code: r.code, product: r.product, quantity: r.lines > 1 ? null : r.quantity, lines: lineRows, totalNaira: naira(r.total_kobo), arrival,
    trackUrl: `${appUrl()}/track/${r.public_token}`, receiptUrl: `${appUrl()}/invoice/${r.public_token}`,
    couponCode: r.discount_kobo ? r.coupon_code : null, discountNaira: r.discount_kobo ? naira(r.discount_kobo) : null,
  }) });
  return 'sent';
}
