import { one, query } from './db';

/*
 * WhatsApp without Meta's fees. The paid WhatsApp Business Platform charges for each message a business sends. Brandit
 * does not use it. A customer who has an email gets every update by email at once. For WhatsApp, the message is written
 * for us and waits in the console under "WhatsApp to send": a person taps one button, WhatsApp opens with the customer's
 * number and the message already typed, and presses send. That is the ordinary WhatsApp Business app, which is free.
 */

/** Messages a customer must act on or needs right now. They always get a WhatsApp nudge, even when an email also went. */
export const URGENT = new Set([
  'file_problem', 'proof_ready', 'pay_link', 'custom_quote_ready', 'out_for_delivery', 'ready_for_pickup', 'rider_nearby',
  'studio_ready', 'studio_changes', 'late_notice', 'late_refund',
]);
/** Reminders and offers. They wait in a separate list and are easy to skip. */
export const OPTIONAL = new Set(['abandoned_nudge', 'reorder_reminder', 'reorder_weekly', 'sample_credit', 'referral_reward', 'review_request']);
/** A message nobody sent within this many days is no longer worth sending. */
export const OUTBOX_DAYS = 3;

export const waDigits = (phone: string | null | undefined) => String(phone ?? '').replace(/\D/g, '');

/** The link that opens WhatsApp with the customer's number and the message already typed. */
export function waLink(phone: string | null | undefined, text: string): string | null {
  const d = waDigits(phone);
  return d.length >= 8 ? `https://wa.me/${d}?text=${encodeURIComponent(text)}` : null;
}

/** Does this message also need a person to send it on WhatsApp? Yes when nothing reached the customer by itself, or it is urgent. */
export const outboxWanted = (template: string, hasPhone: boolean, sentAutomatically: boolean) => hasPhone && (!sentAutomatically || URGENT.has(template));

export type OutboxRow = { id: number; template: string; to_phone: string | null; body: string; created_at: string; status: string; handled_by: string | null; sent_at: string | null; code: string | null; customer_name: string | null };

const COLS = `m.id, m.template, m.to_phone, m.body, m.created_at, m.status, m.handled_by, m.sent_at, o.code, c.name as customer_name`;
const JOIN = `from messages m left join orders o on o.id = m.order_id left join customers c on c.id = o.customer_id`;

export async function outboxList(): Promise<{ now: OutboxRow[]; optional: OutboxRow[]; recent: OutboxRow[] }> {
  const waiting = await query<OutboxRow>(
    `select ${COLS} ${JOIN} where m.audience = 'customer' and m.channel = 'whatsapp_manual' and m.status = 'to_send' and m.created_at > now() - interval '${OUTBOX_DAYS} days' order by m.id`,
  );
  const recent = await query<OutboxRow>(
    `select ${COLS} ${JOIN} where m.audience = 'customer' and m.channel = 'whatsapp_manual' and m.status in ('sent','dismissed') order by coalesce(m.sent_at, m.created_at) desc limit 12`,
  );
  return { now: waiting.filter((m) => !OPTIONAL.has(m.template)), optional: waiting.filter((m) => OPTIONAL.has(m.template)), recent };
}

/** How many messages wait for a person. The little number on the menu. */
export async function outboxCount(): Promise<number> {
  const r = await one<{ n: number }>(`select count(*)::int as n from messages where audience = 'customer' and channel = 'whatsapp_manual' and status = 'to_send' and created_at > now() - interval '${OUTBOX_DAYS} days'`);
  return r?.n ?? 0;
}
