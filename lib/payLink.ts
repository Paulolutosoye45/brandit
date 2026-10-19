import { one, query } from './db';
import { arriveLine, getItems, getOrder, getOrderByToken, isOpen, recomputeOrder } from './orders';
import { viewOf } from './basket';
import { initPayment, PaymentsNotConfiguredError } from './payments';
import { artworkOutstanding } from './lines';
import { studioProblem } from './studio/inOrder';
import { appUrl } from './messages';
import { namesProblem } from './nameList';

/*
 * A pay link lets someone other than the customer pay for an order.
 * In Nigeria the person who orders is often not the person who pays: a church secretary orders and the pastor pays, an
 * assistant orders and the boss pays. The link opens the exact products and the price, and takes the money.
 * The order stays with the person who built it: their name, their delivery, their messages, their tracking.
 * Whoever pays is recorded on the payment, so the receipt and the console can say so.
 */

export const payLinkUrl = (token: string) => `${appUrl()}/pay-link/${token}`;

export type PayLinkLine = { name: string; detail: string; choices: string[]; kobo: number };
export type PayLinkView =
  | {
      state: 'open'; code: string; who: string; note: string | null; business: string | null;
      lines: PayLinkLine[]; printKobo: number; designKobo: number; deliveryKobo: number; discountKobo: number; totalKobo: number; vatKobo: number;
      deliveryText: string; arrival: string | null; designAny: boolean; fileLater: boolean;
    }
  | { state: 'paid'; code: string; who: string }
  | { state: 'closed'; reason: string };

const firstName = (full: unknown) => String(full ?? '').trim().split(/\s+/)[0] || 'Someone';

/** Why this order cannot be paid through a link right now, in words. Null when it can. */
export async function linkBlocker(orderId: string): Promise<string | null> {
  const o = await getOrder(orderId);
  if (!o || !isOpen(o) || o.custom_request_id) return 'This order is no longer open for payment.';
  if (!o.checkout_saved_at || !o.customer_id) return 'The delivery details have not been filled in yet.';
  const lines = await getItems(orderId);
  if (lines.length === 0) return 'This order is empty.';
  if (lines.some((l) => artworkOutstanding(l as any))) return 'Some of the artwork is not settled yet.';
  const list = await namesProblem(orderId);
  if (list) return list;
  if (lines.some((l) => l.artwork_path === 'studio')) {
    const owner = await one<any>('select * from customers where id = $1', [o.customer_id]);
    const problem = await studioProblem(orderId, owner);
    if (problem) return problem;
  }
  return null;
}

/** What the person opening the link sees. Prices and the delivery time are worked out again on the server every time. */
export async function payLinkView(token: string): Promise<PayLinkView | null> {
  if (!/^[\w-]{8,40}$/.test(token)) return null;
  const o0 = await getOrderByToken(token);
  if (!o0) return null;
  const who = firstName(o0.address?.name);
  if (['paid', 'in_production', 'delivered'].includes(o0.status)) return { state: 'paid', code: o0.code, who };
  if (!isOpen(o0) || o0.custom_request_id) return { state: 'closed', reason: 'This order was cancelled or has closed.' };
  const blocked = await linkBlocker(o0.id);
  if (blocked) return { state: 'closed', reason: `${blocked} ${who} can sort it out and send you a fresh link.` };
  const r = await recomputeOrder(o0.id);
  if (!r.ok) return { state: 'closed', reason: `${r.error} ${who} can sort it out and send you a fresh link.` };
  const o = (await getOrder(o0.id))!;
  const view = await viewOf(o.id);
  if (!view) return null;
  const business = o.business_id ? (await one<{ name: string }>('select name from businesses where id = $1', [o.business_id]))?.name ?? null : null;
  const design = view.lines.some((l) => l.artworkPath === 'design' || l.artworkPath === 'studio');
  const later = view.lines.some((l) => l.proof === 'file_later');
  return {
    state: 'open', code: o.code, who, note: o.pay_note ?? null, business,
    lines: view.lines.map((l) => ({
      name: l.name,
      detail: `${l.quantity.toLocaleString('en-US')}${l.sizeLabel ? ` · ${l.sizeLabel}` : ''}`,
      choices: l.choices,
      kobo: l.priceKobo,
    })),
    printKobo: o.subtotal_kobo, designKobo: o.design_fee_kobo, deliveryKobo: o.pickup ? 0 : o.delivery_fee_kobo, discountKobo: o.discount_kobo ?? 0,
    totalKobo: o.total_kobo, vatKobo: o.vat_kobo,
    deliveryText: o.pickup ? 'Pickup (free)' : o.area ? `Delivery to ${o.area}` : 'Delivery',
    arrival: design ? null : o.promised_at ? arriveLine({ speed: o.speed, promisedAt: new Date(o.promised_at), pickup: o.pickup }).replace(/^./, (c) => c.toUpperCase()) : null,
    designAny: design, fileLater: later,
  };
}

export type StartPay = { ok: true; url: string } | { ok: false; error: string; status: number };

/** Whoever opened the link pays. Their name and email go on the payment; the order is not changed. */
export async function startPayLinkPayment(token: string, payer: { name: string; email: string }): Promise<StartPay> {
  const name = payer.name.trim().replace(/\s+/g, ' ').slice(0, 80);
  const email = payer.email.trim().toLowerCase();
  if (name.length < 2) return { ok: false, error: 'Tell us your name, so the receipt says who paid.', status: 422 };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'Enter your email address. Paystack sends your receipt there.', status: 422 };
  const view = await payLinkView(token);
  if (!view) return { ok: false, error: 'This link is not valid.', status: 404 };
  if (view.state === 'paid') return { ok: false, error: 'This order has already been paid. Thank you.', status: 409 };
  if (view.state === 'closed') return { ok: false, error: view.reason, status: 409 };
  const o = (await getOrderByToken(token))!;
  await query("update payments set status = 'superseded' where order_id = $1 and status = 'pending'", [o.id]);
  try {
    const pay = await initPayment(o, email);
    await query('update payments set payer_name = $2, payer_email = $3 where provider_ref = $1', [pay.reference, name, email]);
    await query("insert into events (name, props) values ('pay_link_started', $1)", [JSON.stringify({ order: o.code })]);
    return { ok: true, url: pay.url };
  } catch (e) {
    const notReady = e instanceof PaymentsNotConfiguredError;
    if (!notReady) console.error('[pay-link] payment could not start', e);
    return { ok: false, error: notReady ? 'Online payment is not available right now. Please try again later.' : 'We could not start the payment. Try again in a moment.', status: notReady ? 503 : 502 };
  }
}

/** The customer made the link. Records the note and the time, once; asking again hands back the same link. */
export async function makePayLink(orderId: string, note?: string | null): Promise<{ ok: true; url: string; token: string } | { ok: false; error: string }> {
  const blocked = await linkBlocker(orderId);
  if (blocked) return { ok: false, error: blocked };
  const clean = (note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  await query('update orders set pay_note = $2, pay_link_at = coalesce(pay_link_at, now()) where id = $1', [orderId, clean]);
  const o = (await getOrder(orderId))!;
  await query("insert into events (name, props) values ('pay_link_made', $1)", [JSON.stringify({ order: o.code })]);
  return { ok: true, url: payLinkUrl(o.public_token), token: o.public_token };
}

/** Who paid, for the console and the receipt. Null when the customer paid for themselves. */
export async function payerOf(orderId: string): Promise<{ name: string; email: string } | null> {
  const p = await one<{ payer_name: string | null; payer_email: string | null }>(
    "select payer_name, payer_email from payments where order_id = $1 and status = 'success' and amount_kobo > 0 and payer_email is not null order by created_at limit 1",
    [orderId],
  );
  return p?.payer_email ? { name: p.payer_name ?? '', email: p.payer_email } : null;
}
