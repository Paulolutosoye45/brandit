import { notFound, redirect } from 'next/navigation';
import { getItems, getOrder } from '@/lib/orders';
import { getProductById, listZones } from '@/lib/catalog';
import { one } from '@/lib/db';
import { PageHead } from '@/components/Bits';
import { getCustomer } from '@/lib/session';
import { contactPhone } from '@/lib/identity';
import { formatLocal } from '@/lib/phoneFormat';
import { getSettings } from '@/lib/settings';
import { findCoupon, publicCoupon } from '@/lib/coupons';
import { authMethods, signInAvailable } from '@/lib/authconfig';
import { viewOf } from '@/lib/basket';
import { artworkOutstanding } from '@/lib/lines';
import { CheckoutForm, type CheckoutLine } from './CheckoutForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Checkout' };

export default async function Checkout(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(params.id)) notFound();
  const o = await getOrder(params.id);
  const items = o ? await getItems(params.id) : [];
  if (!o) notFound();
  if (!['draft', 'awaiting_payment'].includes(o.status)) redirect(`/track/${o.public_token}`);
  if (items.length === 0) redirect('/products');
  // Every product needs its artwork settled before anyone pays. One product goes straight to its artwork; several go to the basket, which says which.
  const waiting = items.filter((it) => artworkOutstanding(it as any));
  if (waiting.length > 0) {
    if (o.custom_request_id) redirect(`/order/${o.id}/artwork`);
    if (items.length === 1) {
      const p = (await getProductById(items[0].product_id))!;
      redirect(`/products/${p.slug}?line=${items[0].id}`);
    }
    redirect('/basket');
  }
  const [zones, s, me, view] = await Promise.all([listZones(), getSettings(), getCustomer(), viewOf(o.id)]);
  const customReq = o.custom_request_id ? await one<any>('select code, title, quantity_text, quote_days, name, phone, email from custom_requests where id = $1', [o.custom_request_id]) : null;
  const applied = o.coupon_code && !customReq ? await findCoupon(o.coupon_code) : null;
  const meBiz = me?.business_id ? await one<{ name: string; tax_id: string | null }>('select name, tax_id from businesses where id = $1', [me.business_id]) : null;
  const local = (p: string | null | undefined) => (p ? `0${formatLocal(p)}` : '');
  const cust = o.customer_id ? await one('select c.name, c.phone, c.email, b.name as company, b.tax_id from customers c left join businesses b on b.id = c.business_id where c.id = $1', [o.customer_id]) : null;
  // A returning customer's last delivery address is where they most likely want this one.
  const last = me && !o.address?.line1 ? await one<{ address: any; area: string | null }>("select address, area from orders where customer_id = $1 and id <> $2 and address is not null and (address->>'line1') is not null order by created_at desc limit 1", [me.id, o.id]) : null;
  const addr = o.address?.line1 ? o.address : (last?.address ?? {});

  const lines: CheckoutLine[] = [];
  for (const it of items) {
    const p = (await getProductById(it.product_id))!;
    const lv = view?.lines.find((l) => l.id === it.id);
    const sizeLabel = p.sizes.length > 1 ? p.sizes.find((x) => x.key === it.size_key)?.label : null;
    const qtyText = customReq ? (customReq.quantity_text || 'One custom job') : it.width_ft ? `${it.quantity} × ${it.width_ft} × ${it.height_ft} ft` : `${it.quantity.toLocaleString('en-US')}${sizeLabel ? `, ${sizeLabel}` : ''}`;
    lines.push({
      id: it.id, productId: it.product_id, slug: p.slug, name: it.label ?? p.name, qtyText, choices: customReq ? [] : (lv?.choices ?? []),
      priceKobo: it.line_total_kobo, designKobo: lv?.designKobo ?? 0, designPath: it.artwork_path === 'design' || it.artwork_path === 'studio', studioPath: it.artwork_path === 'studio',
      quote: { slug: p.slug, quantity: it.quantity, config: it.config, sizeKey: it.size_key ?? undefined, widthFt: it.width_ft ?? undefined, heightFt: it.height_ft ?? undefined },
    });
  }

  const m = authMethods();
  const needSignIn = !me && signInAvailable();
  return (
    <>
      <PageHead title={needSignIn ? 'Nearly there' : 'Almost there'} sub={`Order ${o.code}. ${needSignIn ? 'Sign in, then pay.' : 'Check your details, then pay.'}`} />
      <CheckoutForm
        key={me ? 'in' : 'out'}
        orderId={o.id}
        lines={lines}
        custom={customReq ? { days: customReq.quote_days, code: customReq.code } : null}
        zones={zones.map((z) => ({ id: z.id, name: z.name, areas: z.areas, feeKobo: z.fee_kobo }))}
        holdExpiresAt={o.hold_expires_at ? new Date(o.hold_expires_at).toISOString() : null}
        vatRate={s.vat_rate}
        pricesIncludeVat={s.prices_include_vat}
        coupon={applied && applied.active ? publicCoupon(applied) : null}
        pickupAddress={s.pickup_address}
        windowsEnabled={s.windows_enabled}
        signIn={needSignIn ? { google: m.google, email: m.email, demo: m.demo } : null}
        defaults={{ name: me?.name ?? cust?.name ?? customReq?.name ?? '', phone: local(me ? contactPhone(me) : (cust?.phone ?? customReq?.phone)), email: me?.email ?? cust?.email ?? customReq?.email ?? '', company: meBiz?.name ?? cust?.company ?? '', taxId: meBiz?.tax_id ?? cust?.tax_id ?? '', area: o.area ?? me?.default_area ?? last?.area ?? '', address: addr.line1 ?? '', pickup: !!o.pickup, plainPack: !!o.plain_pack, window: o.delivery_window ?? '' }}
      />
    </>
  );
}
