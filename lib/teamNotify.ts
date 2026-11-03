import { one, query } from './db';
import { appUrl, notifyTeam } from './messages';
import { naira } from './money';
import { describeArrival } from './time';
import type { TeamAlert } from './teamAlerts';

/*
 * The emails the team gets when a customer does something that needs a person: pays for an order, sends a custom
 * request or an event plan, or reports a problem. They go to the addresses in Business details (hello@ and sales@ until
 * someone types others). Each is best effort: if the email cannot be sent, the order is still taken and the failed email
 * waits in Messages with a "Try again" button.
 */

const ARTWORK: Record<string, string> = { upload: 'customer file', design: 'Brandit designs it', studio: 'made in Studio' };
const oneLine = (s: unknown, n = 160) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** The email for a paid order. Pure, so the wording can be tested without a database. */
export function orderPaidAlert(o: {
  code: string; totalKobo: number; pickup: boolean; area: string | null; promisedAt: Date | null; speed: string | null;
  couponCode: string | null; customer: { name: string | null; phone: string | null; email: string | null };
  items: { name: string; quantity: number; artwork: string | null }[]; consoleUrl: string; now?: Date;
}): TeamAlert {
  const lines = o.items.map((i) => `${i.quantity.toLocaleString('en-US')} x ${i.name}${i.artwork ? ` (${ARTWORK[i.artwork] ?? i.artwork})` : ''}`);
  const who = [o.customer.name, o.customer.phone, o.customer.email].filter(Boolean).join(' · ') || 'No contact details';
  const first = o.items[0];
  const what = o.items.length > 1 ? `${o.items.length} products` : first ? `${first.quantity.toLocaleString('en-US')} x ${first.name}` : 'an order';
  const arrival = o.promisedAt ? `${o.pickup ? 'Ready for pickup' : 'Arriving'} ${describeArrival(o.promisedAt, o.now ?? new Date())}${o.speed ? ` (${o.speed})` : ''}` : 'Set when the proof is approved';
  return {
    kind: 'order_paid',
    subject: `New order ${o.code}: ${naira(o.totalKobo)} · ${what}`,
    headline: `New paid order ${o.code}: ${naira(o.totalKobo)}.`,
    rows: [
      ['Customer', who],
      ['Order', lines.join('\n') || '-'],
      ['Total', naira(o.totalKobo) + (o.couponCode ? ` (coupon ${o.couponCode})` : '')],
      [o.pickup ? 'Pickup' : 'Delivery', o.pickup ? 'Customer collects' : o.area || 'Area not recorded'],
      ['Timing', arrival],
    ],
    link: o.consoleUrl,
    linkLabel: 'Open the order',
    replyTo: o.customer.email || null,
  };
}

/** Tell the team an order has been paid. Called once, right after the payment is applied. */
export async function notifyTeamOrderPaid(orderId: string): Promise<void> {
  const o = await one<any>(
    `select o.id, o.code, o.total_kobo, o.pickup, o.area, o.promised_at, o.speed, o.coupon_code, c.name, c.phone, c.email
       from orders o left join customers c on c.id = o.customer_id where o.id = $1`, [orderId]);
  if (!o) return;
  const items = await query<any>(
    'select coalesce(i.label, p.name) as name, i.quantity, i.artwork_path from order_items i join products p on p.id = i.product_id where i.order_id = $1 order by i.position, i.id', [orderId]);
  await notifyTeam(orderPaidAlert({
    code: o.code, totalKobo: o.total_kobo, pickup: !!o.pickup, area: o.area ?? null, promisedAt: o.promised_at ? new Date(o.promised_at) : null, speed: o.speed ?? null,
    couponCode: o.coupon_code ?? null, customer: { name: o.name ?? null, phone: o.phone ?? null, email: o.email ?? null },
    items: items.map((i) => ({ name: i.name, quantity: i.quantity, artwork: i.artwork_path ?? null })),
    consoleUrl: `${appUrl()}/console/orders/${o.code}`,
  }), o.id);
}

/** The email for a custom request or an event plan. */
export function customRequestAlert(r: {
  id: string; code: string; event: boolean; title: string; name: string; phone: string; email: string | null;
  quantityText: string | null; sizeText: string | null; budgetKobo: number | null; needBy: string | null; files: number; details: string;
}): TeamAlert {
  const rows: [string, string][] = [
    ['From', [r.name, r.phone, r.email].filter(Boolean).join(' · ')],
    [r.event ? 'Event' : 'What', oneLine(r.title)],
  ];
  if (r.quantityText) rows.push(['Quantity', oneLine(r.quantityText, 80)]);
  if (r.sizeText) rows.push(['Size', oneLine(r.sizeText, 80)]);
  if (r.budgetKobo) rows.push(['Budget', naira(r.budgetKobo)]);
  if (r.needBy) rows.push(['Needed by', String(r.needBy).slice(0, 10)]);
  if (r.files) rows.push(['Files', `${r.files} attached`]);
  if (r.details) rows.push(['Details', r.details.replace(/\r/g, '').trim().slice(0, 600)]);
  return {
    kind: r.event ? 'event_plan' : 'custom_request',
    subject: `${r.event ? 'New event plan' : 'New custom request'} ${r.code}: ${oneLine(r.title, 70)}`,
    headline: r.event ? `A customer sent an event plan (${r.code}). It needs one price for everything.` : `A customer asked for a custom price (${r.code}).`,
    rows,
    link: `${appUrl()}/console/custom/${r.id}`,
    linkLabel: 'Open and send a price',
    replyTo: r.email || null,
  };
}

/** The email for a problem report on a delivered order. */
export function claimOpenedAlert(c: { code: string; kind: string; description: string; customer: { name: string | null; phone: string | null; email: string | null } }): TeamAlert {
  const KIND: Record<string, string> = { wrong_print: 'Wrong print', damaged: 'Damaged', other: 'Other problem' };
  return {
    kind: 'claim_opened',
    subject: `Problem reported on order ${c.code}: ${KIND[c.kind] ?? 'problem'}`,
    headline: `A customer reported a problem with order ${c.code}.`,
    rows: [
      ['Customer', [c.customer.name, c.customer.phone, c.customer.email].filter(Boolean).join(' · ') || '-'],
      ['Problem', KIND[c.kind] ?? c.kind],
      ['They said', oneLine(c.description, 600)],
    ],
    link: `${appUrl()}/console/promise`,
    linkLabel: 'Open the problem',
    replyTo: c.customer.email || null,
  };
}

export async function notifyTeamClaim(claimId: string): Promise<void> {
  const c = await one<any>(
    `select c.kind, c.description, o.id as order_id, o.code, cu.name, cu.phone, cu.email
       from claims c join orders o on o.id = c.order_id left join customers cu on cu.id = o.customer_id where c.id = $1`, [claimId]);
  if (!c) return;
  await notifyTeam(claimOpenedAlert({ code: c.code, kind: c.kind, description: c.description ?? '', customer: { name: c.name ?? null, phone: c.phone ?? null, email: c.email ?? null } }), c.order_id);
}
