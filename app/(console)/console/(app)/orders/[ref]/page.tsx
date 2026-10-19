import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { can } from '@/lib/permissions';
import { orderDetail } from '@/lib/orderAdmin';
import { PAY_STATUS, refundableKobo } from '@/lib/paymentsAdmin';
import { naira } from '@/lib/money';
import { describeWhen } from '@/lib/time';
import { STAGE_LABEL, type Stage } from '@/lib/types';
import { appUrl } from '@/lib/messages';
import { Notice } from '@/components/Bits';
import { CopyButton } from '@/components/CopyButton';
import { RefundForm } from '../../payments/RefundForm';
import { reconcileAction } from '../../payments/actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Order' };

const ORDER_STATUS: Record<string, string> = { draft: 'Draft (not at checkout yet)', awaiting_payment: 'Waiting for payment', paid: 'Paid', in_production: 'In production', delivered: 'Delivered', cancelled: 'Cancelled', refunded: 'Refunded' };

export default async function OrderPage(props: { params: Promise<{ ref: string }>; searchParams: Promise<{ e?: string; ok?: string }> }) {
  const { ref } = await props.params;
  const sp = await props.searchParams;
  const staff = await requireStaff();
  if (!can(staff.role, 'see_contact') && !can(staff.role, 'dispatch')) await requireStaff('see_contact');
  const d = await orderDetail(decodeURIComponent(ref));
  if (!d) notFound();
  const { o, customer: c } = d;
  const contact = can(staff.role, 'see_contact');
  const addr = o.address as { line1?: string | null; area?: string | null; contact_phone?: string; name?: string } | null;
  const phone = c?.whatsapp_phone ?? c?.phone ?? addr?.contact_phone ?? null;
  const track = `${appUrl()}/track/${o.public_token}`;
  const back = `/console/orders/${o.code}`;
  const canMoney = can(staff.role, 'see_payments');
  const canRefund = can(staff.role, 'refund');
  return (
    <div className="grid max-w-[1000px] gap-7">
      <div><Link href="/console/orders" className="inline-flex min-h-[44px] items-center text-[15px] font-bold text-muted hover:text-ink">← All orders</Link></div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-[34px]">Order {o.code}</h1>
          <p className="text-muted"><span className="pill bg-paper2 text-ink">{ORDER_STATUS[o.status] ?? o.status}</span> · placed {describeWhen(new Date(o.created_at))}{o.paid_at ? ` · paid ${describeWhen(new Date(o.paid_at))}` : ''}{o.staff_built ? ' · built by the team' : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn-secondary btn-sm" href={`/track/${o.public_token}`}>Customer’s tracker</Link>
          {phone && contact && <a className="btn-primary btn-sm" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${String(phone).replace(/\D/g, '')}?text=${encodeURIComponent(`Hi, about your Brandit order ${o.code}. Track it here: ${track}`)}`}>WhatsApp them</a>}
        </div>
      </div>

      {['draft', 'awaiting_payment'].includes(o.status) && (o.staff_built || o.pay_link_at) && (
        <section className="card grid gap-2 border-ink p-5">
          <p className="font-bold">{o.staff_built ? 'This order is waiting for the customer to pay.' : 'The customer made a pay link for this order. It is waiting for whoever they sent it to.'}</p>
          <p className="break-all text-[15px] text-muted">{appUrl()}/pay-link/{o.public_token}</p>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={`${appUrl()}/pay-link/${o.public_token}`} label="Copy the pay link" />
            {phone && contact && <a className="btn-primary btn-sm" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${String(phone).replace(/\D/g, '')}?text=${encodeURIComponent(`Hi ${String(c?.name ?? '').split(' ')[0] || 'there'}, your Brandit order ${o.code} is ready: ${naira(o.total_kobo)}. See exactly what it is and pay here: ${appUrl()}/pay-link/${o.public_token}`)}`}>Send it on WhatsApp</a>}
          </div>
        </section>
      )}

      <section className="grid gap-3" aria-label="Products">
        <h2 className="text-[22px]">What was ordered</h2>
        <ul className="card divide-y divide-line">
          {d.lines.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0"><span className="font-bold">{l.name}</span> × {l.quantity.toLocaleString('en-NG')}<span className="block text-[14px] text-muted">{l.stage ? (l.paused ? 'Waiting on the customer · ' : '') + STAGE_LABEL[l.stage as Stage] : 'Not in production yet'}{l.artwork_path === 'design' ? ' · Brandit designs it' : ''}</span></span>
              <span className="flex items-center gap-3"><span className="font-bold tabular">{naira(l.line_total_kobo)}</span>{l.job_id && <Link className="btn-secondary btn-sm" href={`/console/jobs/${l.job_id}`}>Job</Link>}</span>
            </li>
          ))}
        </ul>
        <dl className="ml-auto grid w-full max-w-[360px] grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[15px]">
          <dt className="text-muted">Products</dt><dd className="text-right tabular">{naira(o.subtotal_kobo)}</dd>
          {o.design_fee_kobo > 0 && <><dt className="text-muted">Design</dt><dd className="text-right tabular">{naira(o.design_fee_kobo)}</dd></>}
          {o.discount_kobo > 0 && <><dt className="text-muted">Coupon {o.coupon_code ?? ''}</dt><dd className="text-right tabular">−{naira(o.discount_kobo)}</dd></>}
          <dt className="text-muted">Delivery{o.pickup ? ' (pickup)' : ''}</dt><dd className="text-right tabular">{naira(o.delivery_fee_kobo)}</dd>
          <dt className="font-bold">Total</dt><dd className="text-right font-bold tabular">{naira(o.total_kobo)}</dd>
        </dl>
      </section>

      <section className="grid gap-3 sm:grid-cols-2" aria-label="Customer and delivery">
        <div className="card grid gap-1 p-5">
          <h2 className="text-[18px]">Customer</h2>
          {c ? <>
            <Link className="font-bold underline" href={`/console/customers/${c.id}`}>{c.name ?? 'No name'}</Link>
            {contact && <p className="text-muted">{c.whatsapp_phone ?? c.phone}{c.email ? ` · ${c.email}` : ''}</p>}
          </> : <p className="text-muted">Not attached yet.</p>}
        </div>
        <div className="card grid gap-1 p-5">
          <h2 className="text-[18px]">{o.pickup ? 'Pickup' : 'Delivery'}</h2>
          {o.pickup ? <p>Customer collects.</p> : <p>{addr?.line1 ?? '—'}{o.area ? `, ${o.area}` : ''}</p>}
          <p className="text-muted">{o.promised_at ? `Promised ${describeWhen(new Date(o.promised_at))}` : 'No arrival time yet'}{o.speed === '24h' ? ' · 24-hour' : ''}{o.delivery_code && contact ? ` · code ${o.delivery_code}` : ''}</p>
        </div>
      </section>

      {canMoney && (
        <section id="money" className="grid gap-3" aria-label="Payments">
          <h2 className="text-[22px]">Payments and refunds</h2>
          {d.payments.length === 0 ? <p className="text-muted">No payment has been started.</p> : (
            <ul className="grid gap-3">
              {d.payments.map((p) => {
                const [label, tone] = PAY_STATUS[p.status] ?? [p.status, 'bg-placeholder text-ink'];
                const left = refundableKobo(p);
                return (
                  <li key={p.id} className="card flex flex-wrap items-start justify-between gap-3 p-4">
                    <div className="grid min-w-0 gap-1"><p className="flex flex-wrap items-center gap-2"><span className={`pill ${tone}`}>{label}</span>{p.refunded_kobo > 0 && p.status !== 'refund' && <span className="pill bg-warn-tint text-warn">{naira(p.refunded_kobo)} refunded</span>}</p><p className="text-[14px] text-muted">{p.method ?? 'not chosen'} · {describeWhen(new Date(p.created_at))}</p>{p.payer_email && <p className="text-[14px]">Paid by {p.payer_name || 'someone else'} ({p.payer_email}) through the pay link</p>}<p className="break-all text-[12px] text-muted">{p.provider_ref}</p>{p.status === 'refund' && <p className="text-[14px]">{p.refund_reason ?? 'No reason recorded'}{p.staff_name ? ` · ${p.staff_name}` : ''}</p>}</div>
                    <div className="grid justify-items-end gap-2">
                      <p className="font-display text-[22px] font-extrabold tabular">{naira(p.amount_kobo)}</p>
                      <div className="flex flex-wrap justify-end gap-2">
                        {!['success', 'refund', 'superseded'].includes(p.status) && <form action={reconcileAction}><input type="hidden" name="payment" value={p.id} /><input type="hidden" name="return" value={back} /><button className="btn-secondary btn-sm">Ask Paystack</button></form>}
                        {canRefund && ['success', 'review', 'amount_mismatch'].includes(p.status) && left > 0 && <RefundForm paymentId={p.id} leftKobo={left} leftLabel={naira(left)} back={back} />}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {d.claims.length > 0 && (
        <section className="grid gap-3"><h2 className="text-[22px]">Problems reported</h2>
          <ul className="card divide-y divide-line">{d.claims.map((x) => <li key={x.id} className="px-4 py-3"><span className="font-bold">{x.kind.replace('_', ' ')}</span> · {x.status === 'open' ? <span className="font-bold text-bad">open</span> : `closed (${x.resolution ?? ''})`}<span className="block text-[14px] text-muted">{x.description}</span></li>)}</ul>
          <Link href="/console/promise" className="text-[15px] font-bold underline">Open the problems desk</Link>
        </section>
      )}

      {d.events.length > 0 && (
        <section className="grid gap-3"><h2 className="text-[22px]">What happened</h2>
          <ol className="card divide-y divide-line">{d.events.map((e, i) => <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-[15px]"><span><span className="font-bold">{STAGE_LABEL[e.to_stage as Stage] ?? e.to_stage}</span>{d.lines.length > 1 ? ` · ${e.product}` : ''}{e.note ? <span className="text-muted"> — {e.note}</span> : null}</span><span className="text-[13px] text-muted">{e.staff ? `${e.staff} · ` : ''}{describeWhen(new Date(e.at))}</span></li>)}</ol>
        </section>
      )}

      {d.messages.length > 0 && contact && (
        <section className="grid gap-3"><div className="flex items-end justify-between gap-3"><h2 className="text-[22px]">Messages sent</h2><Link href="/console/messages" className="text-[15px] font-bold underline">All messages</Link></div>
          <ul className="card divide-y divide-line">{d.messages.map((m) => <li key={m.id} className="px-4 py-3"><p className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted"><span>{m.template.replace(/_/g, ' ')} · {m.channel}</span><span className={m.status === 'failed' ? 'font-bold text-bad' : ''}>{m.status} · {describeWhen(new Date(m.created_at))}</span></p><p className="text-[15px]">{m.body}</p>{m.error && <p className="text-[13px] text-bad">{m.error}</p>}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
