import { query, one } from './db';
import { addDays, lagosParts } from './time';
import { lagosDayStart } from './studio/config';
import { listQueue, statusOf } from './jobs';
import type { StaffUser } from './session';
import type { Stage } from './types';

/*
 * What the console shows first thing: the work that is waiting for a person, the orders that might be late, and how the
 * shop did today. Everything here is a read, so opening Today never changes anything.
 */

export type NavCounts = { files: number; claims: number; quotes: number; payments: number };

/** The little numbers on the menu. One query. */
export async function navCounts(): Promise<NavCounts> {
  const r = await one<NavCounts>(
    `select (select count(*)::int from jobs where stage = 'file_check' and not clock_paused) as files,
            (select count(*)::int from claims where status = 'open') as claims,
            (select count(*)::int from custom_requests where status = 'new') as quotes,
            (select count(*)::int from payments where status in ('review','amount_mismatch')) as payments`,
  );
  return r ?? { files: 0, claims: 0, quotes: 0, payments: 0 };
}

export type Need = { key: string; label: string; n: number; href: string; tone: 'bad' | 'warn' | 'info' };
export type DayBar = { ymd: string; orders: number; kobo: number };
export type RiskRow = { jobId: string; code: string; product: string; promisedAt: string | null; status: 'late' | 'at_risk'; stage: Stage };
export type RecentOrder = { id: string; code: string; name: string | null; total_kobo: number; paid_at: string; summary: string };

export type TodayView = {
  ymd: string;
  paidToday: { orders: number; kobo: number };
  paidYesterday: { orders: number; kobo: number };
  week: { orders: number; kobo: number; refundKobo: number };
  baskets: number;
  needs: Need[];
  risks: RiskRow[];
  days: DayBar[];
  recent: RecentOrder[];
};

const PAID = "('paid','in_production','delivered')";

export async function todayView(staff: StaffUser, now = new Date()): Promise<TodayView> {
  const start = lagosDayStart(now);
  const yStart = new Date(start.getTime() - 86_400_000);
  const weekStart = new Date(start.getTime() - 6 * 86_400_000);
  const since14 = new Date(start.getTime() - 13 * 86_400_000);
  const ymd = lagosParts(now).ymd;

  const [sums, baskets, counts, queue, paid14, refunds, recent] = await Promise.all([
    one<{ t_orders: number; t_kobo: number; y_orders: number; y_kobo: number; w_orders: number; w_kobo: number }>(
      `select count(*) filter (where paid_at >= $1)::int as t_orders, coalesce(sum(total_kobo) filter (where paid_at >= $1), 0)::int as t_kobo,
              count(*) filter (where paid_at >= $2 and paid_at < $1)::int as y_orders, coalesce(sum(total_kobo) filter (where paid_at >= $2 and paid_at < $1), 0)::int as y_kobo,
              count(*) filter (where paid_at >= $3)::int as w_orders, coalesce(sum(total_kobo) filter (where paid_at >= $3), 0)::int as w_kobo
       from orders where status in ${PAID} and paid_at >= $4`,
      [start.toISOString(), yStart.toISOString(), weekStart.toISOString(), weekStart.toISOString()],
    ),
    // A basket that got as far as delivery details in the last day and has not paid: a chance to follow up.
    one<{ n: number }>("select count(*)::int as n from orders where status = 'awaiting_payment' and checkout_saved_at >= now() - interval '24 hours'"),
    one<{ files: number; claims: number; quotes: number; payments: number; failed: number; reviews: number; studio: number; proofs: number }>(
      `select (select count(*)::int from jobs where stage = 'file_check' and not clock_paused) as files,
              (select count(*)::int from claims where status = 'open') as claims,
              (select count(*)::int from custom_requests where status = 'new') as quotes,
              (select count(*)::int from payments where status in ('review','amount_mismatch')) as payments,
              (select count(*)::int from messages where status = 'failed' and created_at >= now() - interval '48 hours') as failed,
              (select count(*)::int from reviews where staff_reply is null and rating <= 3) as reviews,
              (select count(*)::int from studio_reviews where status = 'waiting') as studio,
              (select count(*)::int from jobs j where j.stage = 'proof') as proofs`,
    ),
    listQueue(staff),
    query<{ paid_at: string; total_kobo: number }>(`select paid_at, total_kobo from orders where status in ${PAID} and paid_at >= $1`, [since14.toISOString()]),
    one<{ v: number }>("select coalesce(-sum(amount_kobo), 0)::int as v from payments where status = 'refund' and created_at >= $1", [weekStart.toISOString()]),
    query<RecentOrder>(
      `select o.id, o.code, c.name, o.total_kobo, o.paid_at,
              (select string_agg(coalesce(i.label, p.name) || ' × ' || i.quantity, ', ' order by i.position, i.id) from order_items i join products p on p.id = i.product_id where i.order_id = o.id) as summary
       from orders o left join customers c on c.id = o.customer_id where o.status in ${PAID} order by o.paid_at desc limit 8`,
    ),
  ]);

  const risks: RiskRow[] = [];
  for (const j of queue) {
    const st = statusOf({ stage: j.stage, clock_paused: j.clock_paused, promised_at: j.promised_at, at_risk: j.at_risk }, now);
    if (st === 'late' || st === 'at_risk') risks.push({ jobId: j.id, code: j.code, product: j.product_name, promisedAt: j.promised_at ? new Date(j.promised_at).toISOString() : null, status: st, stage: j.stage });
  }
  risks.sort((a, b) => (a.status === b.status ? 0 : a.status === 'late' ? -1 : 1));
  const late = risks.filter((r) => r.status === 'late').length;

  const c = counts ?? { files: 0, claims: 0, quotes: 0, payments: 0, failed: 0, reviews: 0, studio: 0, proofs: 0 };
  const needs: Need[] = [
    { key: 'payments', label: 'payments to look at', n: c.payments, href: '/console/payments', tone: 'bad' },
    { key: 'late', label: 'orders already late', n: late, href: '/console/queue', tone: 'bad' },
    { key: 'risk', label: 'orders at risk of being late', n: risks.length - late, href: '/console/queue', tone: 'warn' },
    { key: 'claims', label: 'problem reports open', n: c.claims, href: '/console/promise', tone: 'warn' },
    { key: 'quotes', label: 'new quote requests', n: c.quotes, href: '/console/custom', tone: 'warn' },
    { key: 'files', label: 'files waiting for a check', n: c.files, href: '/console/queue', tone: 'info' },
    { key: 'studio', label: 'Studio designs waiting for a person', n: c.studio, href: '/console/studio/review', tone: 'info' },
    { key: 'reviews', label: 'unhappy reviews with no reply', n: c.reviews, href: '/console/reviews', tone: 'warn' },
    { key: 'failed', label: 'messages that did not send', n: c.failed, href: '/console/messages', tone: 'bad' },
  ].filter((n) => n.n > 0) as Need[];

  const byDay = new Map<string, DayBar>();
  for (let i = 13; i >= 0; i--) { const d = addDays(ymd, -i); byDay.set(d, { ymd: d, orders: 0, kobo: 0 }); }
  for (const r of paid14) { const b = byDay.get(lagosParts(new Date(r.paid_at)).ymd); if (b) { b.orders++; b.kobo += r.total_kobo; } }

  return {
    ymd,
    paidToday: { orders: sums?.t_orders ?? 0, kobo: sums?.t_kobo ?? 0 },
    paidYesterday: { orders: sums?.y_orders ?? 0, kobo: sums?.y_kobo ?? 0 },
    week: { orders: sums?.w_orders ?? 0, kobo: sums?.w_kobo ?? 0, refundKobo: refunds?.v ?? 0 },
    baskets: baskets?.n ?? 0,
    needs,
    risks: risks.slice(0, 6),
    days: [...byDay.values()],
    recent,
  };
}
