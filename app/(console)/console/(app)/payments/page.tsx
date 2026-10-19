import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { can } from '@/lib/permissions';
import { PAY_FILTERS, PAY_STATUS, listPayments, paymentCounts, refundableKobo, type PayFilter } from '@/lib/paymentsAdmin';
import { naira } from '@/lib/money';
import { describeWhen } from '@/lib/time';
import { paystackOn } from '@/lib/payments';
import { Notice } from '@/components/Bits';
import { reconcileAction } from './actions';
import { RefundForm } from './RefundForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Payments' };


export default async function Payments(props: { searchParams: Promise<{ f?: string; q?: string; p?: string; e?: string; ok?: string }> }) {
  const sp = await props.searchParams;
  const staff = await requireStaff('see_payments');
  const canRefund = can(staff.role, 'refund');
  const filter = (PAY_FILTERS.some((x) => x.key === sp.f) ? sp.f : 'attention') as PayFilter;
  const q = (sp.q ?? '').trim().slice(0, 80);
  const [{ rows, total, pages, page }, counts] = await Promise.all([listPayments({ filter, q, page: Number(sp.p) || 1 }), paymentCounts()]);
  const href = (o: { f?: string; p?: number }) => { const u = new URLSearchParams(); if (q) u.set('q', q); u.set('f', o.f ?? filter); if (o.p && o.p > 1) u.set('p', String(o.p)); return `/console/payments?${u}`; };
  return (
    <div className="grid gap-6">
      <div><h1 className="text-[34px]">Payments and refunds</h1><p className="text-muted">Every payment Paystack took, and every refund we sent. Card and bank details are never shown here: Paystack keeps them.</p></div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      {!paystackOn() && <Notice tone="warn">Paystack is not connected on this site yet, so no real payment can arrive and refunds are only recorded.</Notice>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={`card p-4 ${counts && counts.attention > 0 ? 'border-[#E8A98F] bg-bad-tint' : ''}`}><p className="text-[13px] font-bold text-muted">Needs a look</p><p className="font-display text-[30px] font-extrabold leading-tight tabular">{counts?.attention ?? 0}</p></div>
        <div className="card p-4"><p className="text-[13px] font-bold text-muted">Paid, last 30 days</p><p className="font-display text-[30px] font-extrabold leading-tight tabular">{naira(counts?.paid_30d ?? 0)}</p></div>
        <div className="card p-4"><p className="text-[13px] font-bold text-muted">Refunded, last 30 days</p><p className="font-display text-[30px] font-extrabold leading-tight tabular">{naira(counts?.refunded_30d ?? 0)}</p></div>
      </div>
      <form className="flex max-w-[560px] gap-3" role="search">
        <input name="q" defaultValue={q} className="field" placeholder="Order code, payment reference, name or phone" aria-label="Search payments" />
        <input type="hidden" name="f" value={filter} />
        <button className="btn-dark">Search</button>
      </form>
      <nav aria-label="Filter" className="flex flex-wrap gap-2">
        {PAY_FILTERS.map((f) => <Link key={f.key} href={href({ f: f.key })} aria-current={f.key === filter ? 'true' : undefined} className={`inline-flex min-h-[44px] items-center rounded-full border-2 px-4 font-bold ${f.key === filter ? 'border-ink bg-ink text-white' : 'border-line-control bg-surface hover:border-ink'}`}>{f.label}</Link>)}
      </nav>
      {filter === 'attention' && rows.length === 0 && <div className="card border-[#9BD3B3] bg-good-tint p-5 font-bold">✓ Every payment is matched to an order.</div>}
      <ul className="grid gap-3">
        {rows.map((p) => {
          const [label, tone] = PAY_STATUS[p.status] ?? [p.status, 'bg-placeholder text-ink'];
          const left = refundableKobo(p);
          const settled = ['success', 'review', 'amount_mismatch'].includes(p.status);
          return (
            <li key={p.id} className="card grid gap-3 p-4 sm:grid-cols-[1fr_auto]">
              <div className="grid min-w-0 gap-1">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1"><Link href={`/console/orders/${p.code}`} className="font-bold underline">{p.code}</Link><span className={`pill ${tone}`}>{label}</span>{p.refunded_kobo > 0 && p.status !== 'refund' && <span className="pill bg-warn-tint text-warn">{naira(p.refunded_kobo)} refunded</span>}</p>
                <p className="text-[15px] text-muted">{p.customer ?? 'Customer'} · {p.method ?? 'not chosen yet'} · {describeWhen(new Date(p.created_at))}</p>
                {p.payer_email && <p className="text-[14px]">Paid by {p.payer_name || 'someone else'} ({p.payer_email}) through the pay link</p>}
                <p className="break-all text-[13px] text-muted">{p.provider_ref}</p>
                {p.status === 'refund' && <p className="text-[14px]">{p.refund_reason ?? 'No reason recorded (an automatic or older refund)'}{p.staff_name ? ` · sent by ${p.staff_name}` : ''}</p>}
              </div>
              <div className="grid content-start justify-items-start gap-2 sm:justify-items-end">
                <p className="font-display text-[24px] font-extrabold leading-none tabular">{naira(p.amount_kobo)}</p>
                <div className="flex flex-wrap gap-2">
                  {!['success', 'refund', 'superseded'].includes(p.status) && (
                    <form action={reconcileAction}><input type="hidden" name="payment" value={p.id} /><input type="hidden" name="return" value="/console/payments" /><button className="btn-secondary btn-sm">Ask Paystack</button></form>
                  )}
                  {canRefund && settled && left > 0 && <RefundForm paymentId={p.id} leftKobo={left} leftLabel={naira(left)} back="/console/payments" />}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {pages > 1 && (
        <div className="flex items-center justify-between gap-3">
          {page > 1 ? <Link className="btn-secondary btn-sm" href={href({ p: page - 1 })}>← Newer</Link> : <span />}
          <span className="text-muted">Page {page} of {pages} · {total} payments</span>
          {page < pages ? <Link className="btn-secondary btn-sm" href={href({ p: page + 1 })}>Older →</Link> : <span />}
        </div>
      )}
    </div>
  );
}
