import { one } from './db';
import { emailOn, receiptEmail, sendEmail } from './email';
import { appUrl } from './messages';
import { naira } from './money';
import { describeArrival } from './time';

/** Email the customer a receipt once they have paid. Best effort: it never holds up or breaks a payment. */
export async function sendReceiptEmail(orderId: string): Promise<'sent' | 'skipped'> {
  if (!emailOn()) return 'skipped';
  const r = await one<any>(
    `select o.code, o.public_token, o.total_kobo, o.promised_at, o.pickup, o.speed, c.email, coalesce(i.label, p.name) as product, i.quantity, o.coupon_code,
              (select discount_kobo from coupon_redemptions cr where cr.order_id = o.id) as discount_kobo
       from orders o join customers c on c.id = o.customer_id join order_items i on i.order_id = o.id join products p on p.id = i.product_id where o.id = $1`, [orderId]);
  if (!r?.email) return 'skipped';
  const arrival = r.promised_at ? `${r.pickup ? 'Ready for pickup' : 'Arriving'} ${describeArrival(new Date(r.promised_at), new Date())}.` : 'We set your arrival time when you approve your proof.';
  await sendEmail({ to: r.email, ...receiptEmail({
    code: r.code, product: r.product, quantity: r.quantity, totalNaira: naira(r.total_kobo), arrival,
    trackUrl: `${appUrl()}/track/${r.public_token}`, receiptUrl: `${appUrl()}/invoice/${r.public_token}`,
    couponCode: r.discount_kobo ? r.coupon_code : null, discountNaira: r.discount_kobo ? naira(r.discount_kobo) : null,
  }) });
  return 'sent';
}
