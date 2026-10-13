import { query, one } from './db';
import { getSettings } from './settings';

/** The two public scores. Hidden until there are enough deliveries for the numbers to mean something. */
export async function scores(days = 30): Promise<{ onTime: number | null; rightFirstTime: number | null; delivered: number; needed: number }> {
  const s = await getSettings();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const base = await one<{ n: number }>("select count(*)::int as n from orders where status = 'delivered' and delivered_at >= $1", [since]);
  const delivered = base?.n ?? 0;
  if (delivered < s.score_min_orders) return { onTime: null, rightFirstTime: null, delivered, needed: s.score_min_orders };
  const t = await one<{ pct: number | null }>(
    `select round(100.0 * count(*) filter (where delivered_at <= promised_at) / nullif(count(*), 0))::int as pct
     from orders where speed = '24h' and status = 'delivered' and delivered_at >= $1`,
    [since],
  );
  const r = await one<{ pct: number | null }>(
    `select round(100.0 * count(*) filter (where not exists (
        select 1 from claims c where c.order_id = o.id and c.kind in ('wrong_print','damaged') and c.resolution in ('reprint','refund')))
       / nullif(count(*), 0))::int as pct
     from orders o where o.status = 'delivered' and o.delivered_at >= $1`,
    [since],
  );
  return { onTime: t?.pct ?? null, rightFirstTime: r?.pct ?? null, delivered, needed: s.score_min_orders };
}

export async function salesByProduct(days = 30) {
  return query<{ name: string; orders: number; revenue: number }>(
    `select p.name, count(*)::int as orders, coalesce(sum(o.total_kobo),0)::int as revenue
     from orders o join order_items i on i.order_id = o.id join products p on p.id = i.product_id
     where o.status in ('paid','in_production','delivered') and o.paid_at >= $1 group by p.name order by revenue desc`,
    [new Date(Date.now() - days * 86_400_000).toISOString()],
  );
}

export async function funnel(days = 30) {
  const rows = await query<{ name: string; n: number }>('select name, count(*)::int as n from events where at >= $1 group by name', [new Date(Date.now() - days * 86_400_000).toISOString()]);
  const get = (k: string) => rows.find((r) => r.name === k)?.n ?? 0;
  return [
    { label: 'Saw a price', n: get('product_view') },
    { label: 'Started an order', n: get('draft_created') },
    { label: 'File passed the check', n: get('upload_passed') },
    { label: 'Added delivery details', n: get('checkout_saved') },
    { label: 'Paid', n: get('paid') },
  ];
}

export async function claimsSummary(days = 30) {
  return query<{ kind: string; n: number; cost: number }>(
    `select kind, count(*)::int as n, coalesce(sum(cost_kobo),0)::int as cost from claims where created_at >= $1 group by kind order by n desc`,
    [new Date(Date.now() - days * 86_400_000).toISOString()],
  );
}

export async function totals(days = 30) {
  const r = await one<{ revenue: number; orders: number }>(
    "select coalesce(sum(total_kobo),0)::int as revenue, count(*)::int as orders from orders where status in ('paid','in_production','delivered') and paid_at >= $1",
    [new Date(Date.now() - days * 86_400_000).toISOString()],
  );
  const refunds = await one<{ v: number }>("select coalesce(-sum(amount_kobo),0)::int as v from payments where status = 'refund' and created_at >= $1", [new Date(Date.now() - days * 86_400_000).toISOString()]);
  return { revenue: r?.revenue ?? 0, orders: r?.orders ?? 0, refunds: refunds?.v ?? 0 };
}
