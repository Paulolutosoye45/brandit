import { query, one, tx } from './db';
import { getSettings } from './settings';
import { appUrl, queueMessage } from './messages';
import { lagosParts } from './time';

/*
 * One friendly reminder for an order that was filled in but not paid.
 *  - Only after the customer gave their details (so we have a number they chose to give us) and only once per order.
 *  - Never at night: messages go out between 8am and 8pm Lagos time, the rest wait for the next morning.
 *  - Never twice in 24 hours to the same person, never to someone who switched reminders off,
 *    and never if they have paid for something newer since.
 *  - The order must still be open. A paid, cancelled or very old (over 2 days) order is left alone.
 */
export const NUDGE_FROM_HOUR = 8;
export const NUDGE_TO_HOUR = 20;
export const NUDGE_MAX_AGE_HOURS = 48;
const BATCH = 50;

export const inNudgeHours = (now: Date) => {
  const h = lagosParts(now).hh;
  return h >= NUDGE_FROM_HOUR && h < NUDGE_TO_HOUR;
};

export async function sendNudges(now = new Date()): Promise<number> {
  const s = await getSettings();
  if (!s.nudge_enabled || !inNudgeHours(now)) return 0;
  const after = Math.max(30, Math.trunc(s.nudge_after_minutes) || 120);
  const rows = await query<any>(
    `select o.id, o.code, o.public_token, coalesce(i.label, p.name) as product, split_part(coalesce(c.name, ''), ' ', 1) as first_name
       from orders o
       join customers c on c.id = o.customer_id
       join order_items i on i.order_id = o.id
       join products p on p.id = i.product_id
      where o.status = 'awaiting_payment' and o.nudged_at is null
        and o.checkout_saved_at <= $1 and o.checkout_saved_at > $2
        and c.nudge_ok and coalesce(c.whatsapp_phone, c.phone) is not null
        and not exists (select 1 from payments y where y.order_id = o.id and y.status = 'success')
        and not exists (select 1 from orders n where n.customer_id = o.customer_id and n.paid_at is not null and n.created_at > o.created_at)
        and not exists (select 1 from orders m where m.customer_id = o.customer_id and m.nudged_at > $3)
      order by o.checkout_saved_at limit ${BATCH}`,
    [new Date(now.getTime() - after * 60_000).toISOString(), new Date(now.getTime() - NUDGE_MAX_AGE_HOURS * 3_600_000).toISOString(), new Date(now.getTime() - 24 * 3_600_000).toISOString()],
  );
  let sent = 0;
  const done = new Set<string>();
  for (const o of rows) {
    // Two orders from one person can both qualify in the same run. Only the first is nudged.
    const who = await one<{ customer_id: string }>('select customer_id from orders where id = $1', [o.id]);
    if (who && done.has(who.customer_id)) continue;
    const ok = await tx(async (q) => {
      const claimed = await q.query("update orders set nudged_at = $2 where id = $1 and nudged_at is null and status = 'awaiting_payment' returning id", [o.id, now.toISOString()]);
      if (!claimed.length) return false;
      await queueMessage(q, {
        orderId: o.id,
        template: 'abandoned_nudge',
        vars: { name: o.first_name || 'there', product: o.product, code: o.code, link: `${appUrl()}/continue/${o.public_token}?src=nudge` },
      });
      await q.query("insert into events (name, props) values ('nudge_sent', $1)", [JSON.stringify({ order: o.code })]);
      return true;
    });
    if (ok) {
      sent++;
      if (who) done.add(who.customer_id);
    }
  }
  return sent;
}

export type NudgeStats = { sent: number; clicked: number; recovered: number; recoveredKobo: number };

/** What the reminders earned in the last N days. "Recovered" = paid after we nudged. */
export async function nudgeStats(days = 30, now = new Date()): Promise<NudgeStats> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const r = await one<any>(
    `select count(*) filter (where nudged_at >= $1)::int as sent,
            count(*) filter (where nudged_at >= $1 and paid_at > nudged_at)::int as recovered,
            coalesce(sum(total_kobo) filter (where nudged_at >= $1 and paid_at > nudged_at), 0)::int as kobo
       from orders where nudged_at is not null`,
    [since],
  );
  const clicks = await one<{ n: number }>("select count(*)::int as n from events where name = 'nudge_clicked' and at >= $1", [since]);
  return { sent: r?.sent ?? 0, clicked: clicks?.n ?? 0, recovered: r?.recovered ?? 0, recoveredKobo: r?.kobo ?? 0 };
}
