import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { revalidatePath } from 'next/cache';
import { one } from '@/lib/db';
import { getBusiness } from '@/lib/business';
import { acceptQuote, cancelByCustomer, effectiveStatus, getByToken, requestFiles } from '@/lib/custom';
import { naira } from '@/lib/money';
import { Notice } from '@/components/Bits';
import { AutoRefresh } from '@/components/AutoRefresh';
import { planOf } from '@/lib/eventPlan';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your custom request', robots: { index: false } };

async function acceptAction(fd: FormData) {
  'use server';
  const tok = String(fd.get('token') ?? '');
  const r = await acceptQuote(tok);
  if (!r.ok) redirect(`/custom-order/${encodeURIComponent(tok)}?e=${encodeURIComponent(r.error)}`);
  if (r.paid) {
    const o = await one<{ public_token: string }>('select public_token from orders where id = $1', [r.orderId]);
    redirect(`/track/${o!.public_token}`);
  }
  redirect(`/checkout/${r.orderId}`);
}

async function cancelAction(fd: FormData) {
  'use server';
  const tok = String(fd.get('token') ?? '');
  const r = await cancelByCustomer(tok);
  revalidatePath(`/custom-order/${tok}`);
  redirect(`/custom-order/${encodeURIComponent(tok)}?${r.ok ? 'ok=' + encodeURIComponent('Request cancelled. You have not been charged anything.') : 'e=' + encodeURIComponent(r.error)}`);
}

const lagos = (d: string | Date) => new Date(d).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const lagosDay = (d: string | Date) => new Date(d).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long' });

export default async function CustomStatus(props: { params: Promise<{ token: string }>; searchParams: Promise<{ sent?: string; e?: string; ok?: string }> }) {
  const { token } = await props.params;
  const sp = await props.searchParams;
  if (!/^[\w-]{10,40}$/.test(token)) notFound();
  const r = await getByToken(token);
  if (!r) notFound();
  const status = effectiveStatus(r);
  const files = await requestFiles(r.id);
  const order = r.order_id ? await one<{ id: string; status: string; public_token: string }>('select id, status, public_token from orders where id = $1', [r.order_id]) : null;
  const wa = (await getBusiness()).whatsapp;
  const waHref = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(`Hi Brandit, about my custom request ${r.code}`)}` : null;
  const wating = status === 'new' || status === 'quoted';
  const plan = planOf(r);

  return (
    <div className="mx-auto max-w-[760px] px-5 pt-8 pb-12 grid gap-6">
      {wating && <AutoRefresh seconds={30} />}
      <div>
        <p className="text-[14px] font-bold text-muted">{plan ? 'Event plan' : 'Custom request'} {r.code}</p>
        <h1 className="text-[30px] sm:text-[38px] leading-[1.05]">{r.title}</h1>
      </div>
      {sp.sent && <Notice tone="good"><span className="font-bold">Request sent.</span> Save this page: it is where your price will appear. We also message you on WhatsApp.</Notice>}
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}

      {status === 'new' && (
        <section className="card p-5 grid gap-2" aria-live="polite">
          <p className="pill bg-warn-tint text-warn self-start">Waiting for our price</p>
          <p className="text-[18px] font-bold">A person is looking at your request.</p>
          <p className="text-muted">You asked on {lagos(r.created_at)}. We usually reply within a working day. This page updates by itself when your price is ready.</p>
        </section>
      )}

      {status === 'quoted' && (
        <section className="card p-5 sm:p-6 grid gap-4 border-2 border-ink" aria-labelledby="price-h">
          <p className="pill bg-good-tint text-good self-start">Your price is ready</p>
          <div>
            <h2 id="price-h" className="text-[16px] font-bold text-muted">Our price</h2>
            <p className="font-display text-[44px] font-extrabold leading-none tabular">{naira(r.quote_price_kobo)}</p>
            <p className="mt-1 text-[14px] text-muted">For the whole job. Delivery and any VAT are shown at checkout before you pay.</p>
          </div>
          <dl className="grid gap-2 text-[16px]">
            <div className="flex justify-between gap-4"><dt className="text-muted">Delivered</dt><dd className="font-bold text-right">{r.quote_days} working day{r.quote_days === 1 ? '' : 's'} after you approve your proof</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Price held until</dt><dd className="font-bold text-right">{lagosDay(r.quote_valid_until)}</dd></div>
          </dl>
          {r.quote_note && <div className="rounded-md2 bg-paper2 px-4 py-3"><p className="text-[13px] font-bold text-muted">A note from us</p><p className="whitespace-pre-wrap">{r.quote_note}</p></div>}
          <form action={acceptAction} className="grid gap-2">
            <input type="hidden" name="token" value={token} />
            <button className="btn-primary w-full">Accept and continue to payment</button>
            <p className="text-[13px] text-muted text-center">After you pay, we design or prepare your proof. Nothing prints until you approve it.</p>
          </form>
          {waHref && <a className="btn-secondary btn-sm w-full" href={waHref}>Ask a question or change something</a>}
        </section>
      )}

      {status === 'expired' && (
        <section className="card p-5 grid gap-3">
          <p className="pill bg-warn-tint text-warn self-start">This price has expired</p>
          <p>The price of {naira(r.quote_price_kobo)} was held until {lagosDay(r.quote_valid_until)}. Prices change with paper and material costs, so ask us to refresh it.</p>
          {waHref && <a className="btn-primary self-start" href={waHref}>Ask us to refresh the price</a>}
        </section>
      )}

      {status === 'accepted' && order && (
        <section className="card p-5 grid gap-3">
          {['draft', 'awaiting_payment'].includes(order.status) ? (
            <>
              <p className="pill bg-warn-tint text-warn self-start">Waiting for your payment</p>
              <p className="text-[18px] font-bold">You accepted {naira(r.quote_price_kobo)}. One step left.</p>
              <Link href={`/checkout/${order.id}`} className="btn-primary self-start">Continue to payment</Link>
            </>
          ) : (
            <>
              <p className="pill bg-good-tint text-good self-start">Paid</p>
              <p className="text-[18px] font-bold">Your order is in production.</p>
              <Link href={`/track/${order.public_token}`} className="btn-primary self-start">Track your order</Link>
            </>
          )}
        </section>
      )}

      {status === 'declined' && (
        <section className="card p-5 grid gap-3">
          <p className="pill bg-placeholder text-ink self-start">We cannot take this one</p>
          <p className="whitespace-pre-wrap">{r.decline_reason}</p>
          <div className="flex flex-wrap gap-3"><Link href="/custom-order" className="btn-secondary btn-sm">Send a different request</Link>{waHref && <a className="btn-ghost btn-sm" href={waHref}>Talk to a person</a>}</div>
        </section>
      )}

      {status === 'cancelled' && (
        <section className="card p-5 grid gap-3">
          <p className="pill bg-placeholder text-ink self-start">Cancelled</p>
          <p>This request is closed. You were not charged anything.</p>
          <Link href="/custom-order" className="btn-secondary btn-sm self-start">Start a new request</Link>
        </section>
      )}

      <section className="card p-5 grid gap-3" aria-labelledby="req-h">
        <h2 id="req-h" className="text-[20px]">Your request</h2>
        {plan && (
          <div className="grid gap-2">
            <p className="text-[15px]"><span className="font-bold">{plan.typeLabel}</span> on {lagosDay(`${plan.date}T12:00:00+01:00`)} · about {plan.guests} guests</p>
            <table className="w-full text-[15px]">
              <caption className="sr-only">What you asked us to print</caption>
              <tbody>
                {plan.items.map((i) => <tr key={i.key} className="border-t border-line"><th scope="row" className="py-2 pr-3 text-left font-medium">{i.label}</th><td className="py-2 text-right font-bold tabular">{i.qty} <span className="font-normal text-muted">{i.unit}</span></td></tr>)}
              </tbody>
            </table>
            {plan.extra && <p className="text-[15px]"><span className="font-bold">Also: </span>{plan.extra}</p>}
            {plan.notes && <p className="text-[15px]"><span className="font-bold">Notes: </span>{plan.notes}</p>}
          </div>
        )}
        <dl className="grid gap-3 text-[16px]">
          {r.product_name && <div><dt className="text-[13px] font-bold text-muted">Like our product</dt><dd>{r.product_name}</dd></div>}
          {!plan && <div><dt className="text-[13px] font-bold text-muted">Details</dt><dd className="whitespace-pre-wrap">{r.details}</dd></div>}
          {r.quantity_text && <div><dt className="text-[13px] font-bold text-muted">How many</dt><dd>{r.quantity_text}</dd></div>}
          {r.size_text && <div><dt className="text-[13px] font-bold text-muted">Size</dt><dd>{r.size_text}</dd></div>}
          {r.budget_kobo != null && <div><dt className="text-[13px] font-bold text-muted">Your budget</dt><dd>{naira(r.budget_kobo)}</dd></div>}
          {r.need_by && <div><dt className="text-[13px] font-bold text-muted">{plan ? 'We aim to deliver by' : 'Needed by'}</dt><dd>{lagosDay(`${String(r.need_by).slice(0, 10)}T12:00:00+01:00`)}</dd></div>}
        </dl>
        {files.length > 0 && (
          <div>
            <p className="text-[13px] font-bold text-muted mb-2">Files you sent</p>
            <ul className="flex flex-wrap gap-2">
              {files.map((f) => (
                <li key={f.id}>
                  <a href={`/api/files/${f.id}?c=${token}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-sm2 border border-line bg-paper2" aria-label={`Open ${f.original_name}`}>
                    {f.mime.startsWith('image/') ? <img src={`/api/files/${f.id}?c=${token}`} alt={f.original_name} className="h-20 w-24 object-cover" loading="lazy" /> : <span className="grid h-20 w-24 place-items-center px-2 text-center text-[12px] font-bold">PDF<br />{f.original_name}</span>}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {(status === 'new' || status === 'quoted') && (
        <form action={cancelAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="token" value={token} />
          <button className="btn-ghost btn-sm !text-bad">Cancel this request</button>
          {waHref && <a className="link text-[15px]" href={waHref}>Message us about it</a>}
        </form>
      )}
    </div>
  );
}
