import { requireStaff } from '@/lib/session';
import { claimsSummary, funnel, salesByProduct, scores, totals } from '@/lib/reports';
import { query } from '@/lib/db';
import { naira } from '@/lib/money';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reports' };

export default async function Reports() {
  await requireStaff('reports');
  const [t, sc, sales, fn, claims] = await Promise.all([totals(), scores(), salesByProduct(), funnel(), claimsSummary()]);
  const failed = await query<{ n: number }>("select count(*)::int as n from messages where status = 'failed' and created_at > now() - interval '7 days'");
  const maxF = Math.max(1, ...fn.map((f) => f.n));
  const maxS = Math.max(1, ...sales.map((s) => s.revenue));
  return (
    <div className="grid gap-8 max-w-[980px]">
      <div><h1 className="text-[34px]">Reports</h1><p className="text-muted">The last 30 days.</p></div>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {[[naira(t.revenue), 'paid in'], [String(t.orders), 'paid orders'], [naira(t.refunds), 'refunded'], [sc.onTime != null ? `${sc.onTime}%` : '—', sc.onTime != null ? 'on time (24-hour)' : `on-time score after ${sc.needed} deliveries (${sc.delivered} so far)`]].map(([v, l]) => (
          <div key={l} className="card p-4"><p className="font-display font-extrabold text-[30px] leading-none tabular">{v}</p><p className="text-[14px] text-muted mt-1.5">{l}</p></div>
        ))}
      </div>
      <section className="card p-5 grid gap-3"><h2 className="text-[22px]">Where customers drop off</h2>
        {fn.map((f, i) => (
          <div key={f.label} className="grid gap-1"><div className="flex justify-between text-[15px]"><span>{f.label}</span><span className="font-bold tabular">{f.n}{i > 0 && fn[i - 1].n > 0 ? ` · ${Math.round((100 * f.n) / fn[i - 1].n)}% of the step before` : ''}</span></div><div className="h-3 rounded-full bg-line overflow-hidden"><div className="h-full bg-ink" style={{ width: `${(100 * f.n) / maxF}%` }} /></div></div>
        ))}
        <p className="text-[13px] text-muted">&ldquo;Saw a price&rdquo; counts product page views. If many customers stop after the file check, improve the upload guidance.</p>
      </section>
      <section className="card p-5 grid gap-3"><h2 className="text-[22px]">Sales by product</h2>
        {sales.length === 0 && <p className="text-muted">No paid orders yet.</p>}
        {sales.map((s) => (<div key={s.name} className="grid gap-1"><div className="flex justify-between text-[15px]"><span>{s.name} <span className="text-muted">({s.orders})</span></span><span className="font-bold tabular">{naira(s.revenue)}</span></div><div className="h-3 rounded-full bg-line overflow-hidden"><div className="h-full bg-accent" style={{ width: `${(100 * s.revenue) / maxS}%` }} /></div></div>))}
        <p className="text-[13px] text-muted">Margin by product needs your cost sheet. Costs are not entered yet.</p>
      </section>
      <section className="card p-5 grid gap-2"><h2 className="text-[22px]">The Promise, in numbers</h2>
        {claims.length === 0 ? <p className="text-muted">No claims in this period.</p> : claims.map((c) => <p key={c.kind} className="flex justify-between text-[15px]"><span>{c.kind.replace('_', ' ')} · {c.n}</span><span className="font-bold tabular">{naira(c.cost)}</span></p>)}
        {(failed[0]?.n ?? 0) > 0 && <p className="text-bad font-bold text-[15px]">{failed[0].n} messages failed to send this week. Check the WhatsApp and SMS settings.</p>}
      </section>
    </div>
  );
}
