import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { currentBasket, viewOf } from '@/lib/basket';
import { listProducts, listZones } from '@/lib/catalog';
import { one } from '@/lib/db';
import { naira } from '@/lib/money';
import { Notice } from '@/components/Bits';
import { whatsappOn } from '@/lib/messages';
import { buildOrderAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New order' };

type SP = { e?: string; customer?: string; name?: string; phone?: string; email?: string; area?: string; address?: string; pickup?: string; note?: string };

/**
 * Order from WhatsApp. Build the products in this browser with the same order builder customers use, then put the customer's
 * details here. The order is made and a pay link is ready to send.
 */
export default async function NewOrder(props: { searchParams: Promise<SP> }) {
  const sp = await props.searchParams;
  await requireStaff('build_order');
  const basket = await currentBasket();
  const view = basket ? await viewOf(basket.id) : null;
  const [products, zones] = await Promise.all([listProducts(), listZones()]);
  const known = sp.customer && /^[0-9a-f-]{36}$/.test(sp.customer)
    ? await one<{ name: string | null; phone: string; email: string | null; whatsapp_phone: string | null }>('select name, phone, email, whatsapp_phone from customers where id = $1', [sp.customer])
    : null;
  const val = (k: keyof SP, fallback = '') => (sp[k] ?? fallback) as string;
  const phoneDefault = val('phone', known ? (known.whatsapp_phone ?? known.phone) : '');

  return (
    <div className="grid max-w-[900px] gap-7">
      <div>
        <h1 className="text-[34px]">New order</h1>
        <p className="text-muted">A customer messaged you on WhatsApp? Build their order here, then send them a link to pay. It goes straight into the same queue as every other order.</p>
      </div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}

      <section className="card grid gap-4 p-5" aria-labelledby="s1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="s1" className="text-[22px]">1. What they want</h2>
          <div className="flex flex-wrap gap-2">
            <Link href="/products" target="_blank" className="btn-secondary btn-sm">Add a product (opens in a new tab)</Link>
            <Link href={`/console/orders/new${sp.customer ? `?customer=${sp.customer}` : ''}`} className="btn-ghost btn-sm">Refresh</Link>
          </div>
        </div>
        {!view || view.lines.length === 0 ? (
          <div className="grid gap-3">
            <p className="text-muted">Nothing here yet. Open a product, choose what the customer asked for, and add it. Every choice and price is checked by the same rules as on the website. Then come back to this page.</p>
            <ul className="flex flex-wrap gap-2" aria-label="Products">
              {products.map((p) => <li key={p.id}><Link target="_blank" href={`/products/${p.slug}`} className="inline-flex min-h-[44px] items-center rounded-full border-2 border-line-control bg-surface px-4 font-bold hover:border-ink">{p.name}</Link></li>)}
            </ul>
          </div>
        ) : (
          <ul className="divide-y divide-line rounded-md2 border border-line">
            {view.lines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-bold">{l.name} <span className="font-normal text-muted">× {l.quantity.toLocaleString('en-NG')}{l.sizeLabel ? ` · ${l.sizeLabel}` : ''}</span></p>
                  {l.choices.length > 0 && <p className="text-[14px] text-muted">{l.choices.join(' · ')}</p>}
                  <p className="text-[14px]">{l.ready ? <span className="text-good font-bold">Artwork ready</span> : <span className="text-muted">No artwork yet. Choose below what happens to it.</span>}</p>
                </div>
                <div className="flex items-center gap-3"><span className="font-bold tabular">{naira(l.priceKobo)}</span><Link target="_blank" href={`/products/${l.slug}?line=${l.id}`} className="btn-ghost btn-sm">Change</Link></div>
              </li>
            ))}
            <li className="flex justify-between px-4 py-3 text-[15px]"><span className="text-muted">Products (delivery is added when you choose where it goes)</span><span className="font-bold tabular">{naira(view.subtotalKobo)}</span></li>
          </ul>
        )}
      </section>

      {view && view.lines.length > 0 && (
        <form action={buildOrderAction} className="grid gap-6">
          <section className="card grid gap-4 p-5" aria-labelledby="s2">
            <h2 id="s2" className="text-[22px]">2. Who is it for?</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="label" htmlFor="name">Their name</label><input id="name" name="name" className="field" autoComplete="off" defaultValue={val('name', known?.name ?? '')} required /></div>
              <div><label className="label" htmlFor="phone">WhatsApp number</label><input id="phone" name="phone" className="field" inputMode="tel" placeholder="0803 123 4567" defaultValue={phoneDefault} required /></div>
            </div>
            <div><label className="label" htmlFor="email">Email <span className="font-normal">(optional; for their receipt)</span></label><input id="email" name="email" type="email" className="field" defaultValue={val('email', known?.email ?? '')} /></div>
          </section>

          <section className="card grid gap-4 p-5" aria-labelledby="s3">
            <h2 id="s3" className="text-[22px]">3. Where should it go?</h2>
            <label className="flex min-h-[44px] items-center gap-3"><input type="checkbox" name="pickup" defaultChecked={sp.pickup === '1'} className="h-5 w-5 accent-[#0B1F33]" /><span className="font-bold">They will pick it up</span></label>
            <div>
              <label className="label" htmlFor="area">Area in Lagos</label>
              <select id="area" name="area" className="field" defaultValue={val('area')}>
                <option value="">Choose the area</option>
                {zones.map((z) => <optgroup key={z.id} label={z.name}>{z.areas.map((a) => <option key={a}>{a}</option>)}</optgroup>)}
              </select>
            </div>
            <div><label className="label" htmlFor="address">Street address and a landmark</label><textarea id="address" name="address" className="field !py-3 min-h-[80px]" defaultValue={val('address')} /></div>
          </section>

          {view.lines.some((l) => !l.ready) && (
            <section className="card grid gap-4 p-5" aria-labelledby="s4">
              <h2 id="s4" className="text-[22px]">4. The artwork</h2>
              <ul className="grid gap-3">
                {view.lines.filter((l) => !l.ready).map((l) => (
                  <li key={l.id} className="grid gap-1 sm:grid-cols-[1fr_280px] sm:items-center">
                    <label className="font-bold" htmlFor={`file_${l.id}`}>{l.name}</label>
                    <select id={`file_${l.id}`} name={`file_${l.id}`} className="field" defaultValue="later">
                      <option value="later">The customer sends the file after paying</option>
                      <option value="design">Brandit designs it</option>
                    </select>
                  </li>
                ))}
              </ul>
              <div><label className="label" htmlFor="design_note">What to tell the designer <span className="font-normal">(only if Brandit designs it)</span></label><textarea id="design_note" name="design_note" className="field !py-3 min-h-[80px]" placeholder="Church programme for Sunday, blue and gold, logo coming on WhatsApp" /></div>
              <p className="text-[14px] text-muted">When the customer sends the file after paying, their job waits at the file check and they get a message with a link to upload it.</p>
            </section>
          )}

          <section className="card grid gap-4 p-5" aria-labelledby="s5">
            <h2 id="s5" className="text-[22px]">5. The pay link</h2>
            <div><label className="label" htmlFor="note">A short note on the link <span className="font-normal">(optional)</span></label><input id="note" name="note" className="field" maxLength={200} defaultValue={val('note')} placeholder="Thanks for your order! Pay here and we start straight away." /></div>
            {whatsappOn() && <label className="flex min-h-[44px] items-start gap-3"><input type="checkbox" name="send" className="mt-1 h-5 w-5 accent-[#0B1F33]" /><span>Also send the link from Brandit&apos;s WhatsApp number. <span className="text-muted">You can always send it yourself from the next page.</span></span></label>}
            <button className="btn-dark self-start" type="submit">Build the order and get the pay link</button>
          </section>
        </form>
      )}
    </div>
  );
}
