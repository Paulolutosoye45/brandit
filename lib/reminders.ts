import { one, query, tx } from './db';
import { getSettings } from './settings';
import { appUrl, queueMessage } from './messages';
import { nameSql } from './lines';
import { addDays, dowOf, lagosDate, lagosParts } from './time';
import { inNudgeHours } from './nudge';
import { token } from './password';

/*
 * Repeat reminders turn one-off buyers into regulars.
 *  - Weekly: a church that prints its Sunday programme every week asks for a reminder on Thursday morning. One tap and the same order is in their basket.
 *  - Running low: about 90 days after an order was delivered, once, to people who agreed to hear from us. Never to someone who ordered again since.
 * Every message has a stop link that works without signing in. Nothing goes out at night.
 */
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export const DEFAULT_WEEKDAY = 4; // Thursday
export const REMINDER_HOUR = '08:00';
const BATCH = 50;

export const reorderUrl = (orderToken: string) => `${appUrl()}/reorder/${orderToken}`;
export const stopUrl = (stopToken: string) => `${appUrl()}/reminders/stop/${stopToken}`;

/** The next time, strictly after `from`, that it is `weekday` (1 Monday to 7 Sunday) at 8am in Lagos. */
export function nextWeekly(from: Date, weekday: number, hhmm = REMINDER_HOUR): Date {
  let ymd = lagosParts(from).ymd;
  for (let i = 0; i < 9; i++) {
    const at = lagosDate(ymd, hhmm);
    const dow = dowOf(ymd) === 0 ? 7 : dowOf(ymd);
    if (dow === weekday && at.getTime() > from.getTime()) return at;
    ymd = addDays(ymd, 1);
  }
  return lagosDate(addDays(lagosParts(from).ymd, 7), hhmm);
}

export type Weekly = { id: string; weekday: number; nextAt: string; stopToken: string };

/** The weekly reminders a customer has switched on, by the order they were made from. */
export async function weeklyFor(customerId: string): Promise<Map<string, Weekly>> {
  const rows = await query<any>("select id, source_order_id, weekday, next_at, stop_token from reminders where customer_id = $1 and kind = 'weekly' and active", [customerId]);
  return new Map(rows.map((r) => [r.source_order_id, { id: r.id, weekday: r.weekday, nextAt: new Date(r.next_at).toISOString(), stopToken: r.stop_token }]));
}

export type StartResult = { ok: true; nextAt: Date } | { ok: false; error: string };

/** The customer asks to be reminded every week to order the same again. */
export async function startWeekly(customerId: string, orderToken: string, weekday: number, now = new Date()): Promise<StartResult> {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return { ok: false, error: 'Choose a day of the week.' };
  const o = await one<any>('select id, customer_id, status, custom_request_id from orders where public_token = $1', [orderToken]);
  if (!o || o.customer_id !== customerId) return { ok: false, error: 'We could not find that order.' };
  if (o.custom_request_id) return { ok: false, error: 'A custom order cannot be repeated in one tap, so we cannot remind you about it.' };
  if (!['paid', 'in_production', 'delivered'].includes(o.status)) return { ok: false, error: 'You can ask for a reminder once the order is paid.' };
  const nextAt = nextWeekly(now, weekday);
  // One active reminder per order: choosing another day moves it.
  const moved = await query<{ id: string }>("update reminders set weekday = $3, next_at = $4 where customer_id = $1 and source_order_id = $2 and kind = 'weekly' and active returning id", [customerId, o.id, weekday, nextAt.toISOString()]);
  if (!moved.length) {
    await query("insert into reminders (customer_id, kind, source_order_id, weekday, next_at, stop_token) values ($1,'weekly',$2,$3,$4,$5)", [customerId, o.id, weekday, nextAt.toISOString(), token(18)]);
    // Asking for a reminder is asking to hear from us about it.
    await query('update customers set reminders_ok = true where id = $1', [customerId]);
  }
  await query("insert into events (name, props) values ('reminder_started', $1)", [JSON.stringify({ kind: 'weekly', weekday })]);
  return { ok: true, nextAt };
}

/** Stop one reminder, or every reminder, from the link in a message. No sign-in needed: the link is the proof. */
export async function stopByToken(stopToken: string, all = false): Promise<{ ok: boolean; all: boolean }> {
  if (!/^[\w-]{10,40}$/.test(stopToken)) return { ok: false, all };
  const r = await one<{ id: string; customer_id: string }>('select id, customer_id from reminders where stop_token = $1', [stopToken]);
  if (!r) return { ok: false, all };
  if (all) {
    await query('update reminders set active = false where customer_id = $1 and active', [r.customer_id]);
    await query('update customers set reminders_ok = false where id = $1', [r.customer_id]);
  } else {
    await query('update reminders set active = false where id = $1', [r.id]);
  }
  await query("insert into events (name, props) values ('reminder_stopped', $1)", [JSON.stringify({ all })]);
  return { ok: true, all };
}

export async function reminderByToken(stopToken: string) {
  if (!/^[\w-]{10,40}$/.test(stopToken)) return null;
  return one<{ id: string; kind: 'weekly' | 'running_low'; active: boolean; weekday: number | null; customer_id: string; ok: boolean }>(
    'select r.id, r.kind, r.active, r.weekday, r.customer_id, c.reminders_ok as ok from reminders r join customers c on c.id = r.customer_id where r.stop_token = $1', [stopToken]);
}

const firstName = (n: unknown) => String(n ?? '').trim().split(/\s+/)[0] || 'there';

/** Send the reminders that are due. Safe to run again and again: each reminder is claimed before it is queued. */
export async function sendReminders(now = new Date()): Promise<{ weekly: number; low: number }> {
  const out = { weekly: 0, low: 0 };
  const s = await getSettings();
  if (!s.reminders_enabled || !inNudgeHours(now)) return out;

  // 1. Weekly reminders that are due.
  const due = await query<any>(
    `select r.id, r.weekday, r.next_at, r.stop_token, o.id as order_id, o.public_token, ${nameSql('o')} as product, c.name as cname
       from reminders r join orders o on o.id = r.source_order_id join customers c on c.id = r.customer_id
      where r.active and r.kind = 'weekly' and r.next_at <= $1 and c.reminders_ok and coalesce(c.whatsapp_phone, c.phone) is not null
      order by r.next_at limit ${BATCH}`, [now.toISOString()]);
  for (const r of due) {
    const next = nextWeekly(now, r.weekday);
    const ok = await tx(async (q) => {
      const claimed = await q.query("update reminders set next_at = $3, last_sent_at = $2, sent_count = sent_count + 1 where id = $1 and next_at = $4 and active returning id", [r.id, now.toISOString(), next.toISOString(), r.next_at]);
      if (!claimed.length) return false;
      await queueMessage(q, { orderId: r.order_id, template: 'reorder_weekly', vars: { name: firstName(r.cname), product: r.product, link: reorderUrl(r.public_token), stop: stopUrl(r.stop_token) } });
      return true;
    });
    if (ok) out.weekly++;
  }

  // 2. "Running low?" once per order, for people who agreed to hear from us. Only recent orders, so switching this on does not message the whole history.
  const days = Math.max(14, Math.min(365, Math.trunc(s.reminder_days) || 90));
  const since = new Date(now.getTime() - (days + 30) * 86_400_000).toISOString();
  const before = new Date(now.getTime() - days * 86_400_000).toISOString();
  const month = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const cands = await query<any>(
    `select o.id, o.public_token, o.customer_id, ${nameSql('o')} as product, c.name as cname
       from orders o join customers c on c.id = o.customer_id
      where o.status = 'delivered' and o.delivered_at <= $1 and o.delivered_at > $2 and o.custom_request_id is null
        and c.marketing_opt_in and c.reminders_ok and coalesce(c.whatsapp_phone, c.phone) is not null
        and exists (select 1 from order_items i join products p on p.id = i.product_id where i.order_id = o.id and not p.sample and not p.system)
        and not exists (select 1 from reminders r where r.source_order_id = o.id and r.kind = 'running_low')
        and not exists (select 1 from orders n where n.customer_id = o.customer_id and n.id <> o.id and n.paid_at is not null and n.paid_at > o.delivered_at)
        and not exists (select 1 from reminders r2 where r2.customer_id = o.customer_id and r2.last_sent_at > $3)
      order by o.delivered_at limit ${BATCH}`, [before, since, month]);
  const done = new Set<string>();
  for (const o of cands) {
    if (done.has(o.customer_id)) continue; // two old orders of one person: one reminder
    const stop = token(18);
    const ok = await tx(async (q) => {
      const made = await q.query("insert into reminders (customer_id, kind, source_order_id, next_at, active, stop_token, last_sent_at, sent_count) values ($1,'running_low',$2,$3,false,$4,$3,1) on conflict do nothing returning id", [o.customer_id, o.id, now.toISOString(), stop]);
      if (!made.length) return false;
      await queueMessage(q, { orderId: o.id, template: 'reorder_reminder', vars: { name: firstName(o.cname), product: o.product, link: reorderUrl(o.public_token), stop: stopUrl(stop) } });
      return true;
    });
    if (ok) { out.low++; done.add(o.customer_id); }
  }
  return out;
}
