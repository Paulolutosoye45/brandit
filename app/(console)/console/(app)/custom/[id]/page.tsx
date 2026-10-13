import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { effectiveStatus, getById, requestFiles } from '@/lib/custom';
import { getSettings } from '@/lib/settings';
import { naira } from '@/lib/money';
import { Notice } from '@/components/Bits';
import { planOf } from '@/lib/eventPlan';
import { declineAction, quoteAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Custom request' };

const when = (d: string | Date) => new Date(d).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

export default async function CustomDetail(props: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; ok?: string }> }) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireStaff('quote_custom');
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const r = await getById(id);
  if (!r) notFound();
  const [files, s] = await Promise.all([requestFiles(id), getSettings()]);
  const status = effectiveStatus(r);
  const plan = planOf(r);
  const open = r.status === 'new' || r.status === 'quoted';
  const phoneDigits = String(r.phone).replace(/\D/g, '');
  const waText = encodeURIComponent(`Hi ${r.name.split(' ')[0]}, this is Brandit about your custom request ${r.code}.`);

  return (
    <div className="grid gap-6 max-w-[900px]">
      <div>
        <Link href="/console/custom" className="text-[14px] underline text-muted">All custom orders</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3"><h1 className="text-[32px]">{r.title}</h1><span className="pill bg-placeholder text-ink capitalize">{status}</span></div>
        <p className="text-muted">{r.code} · sent {when(r.created_at)}</p>
      </div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}

      <section className="card p-5 grid gap-4" aria-labelledby="ask">
        <h2 id="ask" className="text-[22px]">{plan ? 'Event plan' : 'What the customer asked for'}</h2>
        {plan ? (
          <div className="grid gap-2">
            <p className="text-[17px]"><span className="font-bold">{plan.typeLabel}</span> on {String(plan.date)} · about {plan.guests} guests. We aim to deliver by {r.need_by ? String(r.need_by).slice(0, 10) : 'the day before'}.</p>
            <table className="w-full text-[16px]">
              <caption className="sr-only">Items on the plan</caption>
              <thead><tr className="text-left text-[13px] text-muted"><th className="py-1 font-bold">Item</th><th className="py-1 text-right font-bold">Quantity</th><th className="py-1 pl-3 font-bold">Priced like</th></tr></thead>
              <tbody>
                {plan.items.map((i) => <tr key={i.key} className="border-t border-line"><td className="py-2 pr-3">{i.label}</td><td className="py-2 text-right font-bold tabular">{i.qty} <span className="font-normal text-muted">{i.unit}</span></td><td className="py-2 pl-3 text-muted">{i.slug ?? 'Price by hand'}</td></tr>)}
              </tbody>
            </table>
            {plan.extra && <p><span className="font-bold">Also needed: </span>{plan.extra}</p>}
            {plan.notes && <p><span className="font-bold">Notes: </span>{plan.notes}</p>}
            <p className="text-[14px] text-muted">One price covers everything. After payment it becomes one order, delivered together.</p>
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-[17px]">{r.details}</p>
        )}
        <dl className="grid gap-3 sm:grid-cols-2 text-[15px]">
          {r.product_name && <div><dt className="text-[13px] font-bold text-muted">Like our product</dt><dd>{r.product_name}</dd></div>}
          {r.quantity_text && <div><dt className="text-[13px] font-bold text-muted">How many</dt><dd>{r.quantity_text}</dd></div>}
          {r.size_text && <div><dt className="text-[13px] font-bold text-muted">Size</dt><dd>{r.size_text}</dd></div>}
          {r.budget_kobo != null && <div><dt className="text-[13px] font-bold text-muted">Their budget</dt><dd className="font-bold">{naira(r.budget_kobo)}</dd></div>}
          {r.need_by && <div><dt className="text-[13px] font-bold text-muted">Needed by</dt><dd>{String(r.need_by).slice(0, 10)}</dd></div>}
        </dl>
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Files from the customer">
            {files.map((f) => (
              <li key={f.id}>
                <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-sm2 border border-line bg-paper2" aria-label={`Open ${f.original_name}`}>
                  {f.mime.startsWith('image/') ? <img src={`/api/files/${f.id}`} alt={f.original_name} className="h-24 w-28 object-cover" loading="lazy" /> : <span className="grid h-24 w-28 place-items-center px-2 text-center text-[12px] font-bold">PDF<br />{f.original_name}</span>}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5 grid gap-2" aria-labelledby="who">
        <h2 id="who" className="text-[22px]">Customer</h2>
        <p className="font-bold text-[18px]">{r.name}</p>
        <p className="flex flex-wrap gap-x-5 gap-y-1 text-[16px]">
          <a className="link" href={`tel:${r.phone}`}>{r.phone}</a>
          <a className="link" href={`https://wa.me/${phoneDigits}?text=${waText}`} target="_blank" rel="noreferrer">Message on WhatsApp</a>
          {r.email && <a className="link" href={`mailto:${r.email}`}>{r.email}</a>}
        </p>
      </section>

      {r.order_id && (
        <Notice tone="good">The customer accepted {naira(r.quote_price_kobo)}. {r.order_id && <Link className="underline font-bold" href={`/console/orders?q=${encodeURIComponent(r.order_code ?? '')}`}>See order {r.order_code} in Orders</Link>}</Notice>
      )}
      {r.status === 'declined' && <Notice tone="neutral"><span className="font-bold">Declined.</span> The customer was told: {r.decline_reason}</Notice>}
      {r.status === 'cancelled' && <Notice tone="neutral">The customer cancelled this request, or it was closed after no reply.</Notice>}

      {open && (
        <section className="card p-5 grid gap-4" aria-labelledby="quote-h">
          <div>
            <h2 id="quote-h" className="text-[22px]">{r.status === 'quoted' ? 'Change the price' : 'Send a price'}</h2>
            <p className="text-muted text-[15px]">
              {r.status === 'quoted' && <>You quoted {naira(r.quote_price_kobo)} on {when(r.quoted_at)}{r.quoted_by_name ? ` (${r.quoted_by_name})` : ''}. Sending again replaces it and tells the customer. </>}
              Enter the price the customer sees, {s.prices_include_vat ? 'VAT included' : 'before VAT'}. Delivery is added at checkout from the area they choose.
            </p>
          </div>
          <form action={quoteAction} className="grid gap-4">
            <input type="hidden" name="id" value={id} />
            <div className="grid gap-4 sm:grid-cols-3">
              <div><label className="label" htmlFor="q-price">Price (₦)</label><input id="q-price" name="price" required inputMode="numeric" className="field" defaultValue={r.quote_price_kobo ? String(r.quote_price_kobo / 100) : ''} placeholder="85000" /></div>
              <div><label className="label" htmlFor="q-days">Working days after proof approval</label><input id="q-days" name="days" required type="number" min={1} max={60} className="field" defaultValue={r.quote_days ?? 5} /></div>
              <div><label className="label" htmlFor="q-valid">Price valid for (days)</label><input id="q-valid" name="valid_days" type="number" min={1} max={60} className="field" defaultValue={s.custom_quote_valid_days} /></div>
            </div>
            <div><label className="label" htmlFor="q-note">Note to the customer (optional)</label><textarea id="q-note" name="note" maxLength={600} className="field !py-3 min-h-[100px]" defaultValue={r.quote_note ?? ''} placeholder="What the price includes, the paper or material you will use, anything they should check." /></div>
            <button className="btn-primary self-start">{r.status === 'quoted' ? 'Send the new price' : 'Send price to customer'}</button>
          </form>
        </section>
      )}

      {open && (
        <details className="card p-5">
          <summary className="cursor-pointer font-bold min-h-[44px] flex items-center">We cannot do this one</summary>
          <form action={declineAction} className="grid gap-3 pt-3">
            <input type="hidden" name="id" value={id} />
            <label className="label" htmlFor="d-reason">What do we tell the customer?</label>
            <textarea id="d-reason" name="reason" required minLength={5} maxLength={300} className="field !py-3 min-h-[90px]" placeholder="We do not print on glass yet. We can do it on acrylic if you like." />
            <button className="btn-secondary btn-sm self-start !border-bad !text-bad">Decline and tell the customer</button>
          </form>
        </details>
      )}
    </div>
  );
}
