import { notFound, redirect } from 'next/navigation';
import { getItem, getOrder } from '@/lib/orders';
import { getProductById, listZones } from '@/lib/catalog';
import { one } from '@/lib/db';
import { PageHead } from '@/components/Bits';
import Link from 'next/link';
import { getCustomer } from '@/lib/session';
import { contactPhone } from '@/lib/identity';
import { formatLocal } from '@/lib/phoneFormat';
import { getSettings } from '@/lib/settings';
import { findCoupon, publicCoupon } from '@/lib/coupons';
import { CheckoutForm } from './CheckoutForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Checkout' };

export default async function Checkout(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(params.id)) notFound();
  const o = await getOrder(params.id);
  const item = o && (await getItem(params.id));
  if (!o || !item) notFound();
  if (!['draft', 'awaiting_payment'].includes(o.status)) redirect(`/track/${o.public_token}`);
  if (!item.artwork_path || (item.artwork_path === 'upload' && !item.preview_approved_at)) redirect(`/order/${o.id}/artwork`);
  const product = (await getProductById(item.product_id))!;
  const [zones, s, me] = await Promise.all([listZones(), getSettings(), getCustomer()]);
  const customReq = o.custom_request_id ? await one<any>('select code, title, quantity_text, quote_days, name, phone, email from custom_requests where id = $1', [o.custom_request_id]) : null;
  const applied = o.coupon_code && !customReq ? await findCoupon(o.coupon_code) : null;
  const meBiz = me?.business_id ? await one<{ name: string; tax_id: string | null }>('select name, tax_id from businesses where id = $1', [me.business_id]) : null;
  const local = (p: string | null | undefined) => (p ? `0${formatLocal(p)}` : '');
  const cust = o.customer_id ? await one('select c.name, c.phone, c.email, b.name as company, b.tax_id from customers c left join businesses b on b.id = c.business_id where c.id = $1', [o.customer_id]) : null;
  const addr = o.address ?? {};
  const sizeLabel = product.sizes.length > 1 ? product.sizes.find((s) => s.key === item.size_key)?.label : null;
  const qtyText = customReq ? (customReq.quantity_text || 'One custom job') : item.width_ft ? `${item.quantity} × ${item.width_ft} × ${item.height_ft} ft` : `${item.quantity.toLocaleString('en-US')}${sizeLabel ? `, ${sizeLabel}` : ''}`;

  return (
    <>
      <PageHead title="Almost there" sub={`Order ${o.code}. Add your details, then pay.`} />
      {!me && (
        <div className="mx-auto max-w-[1160px] px-5 pb-5">
          <p className="rounded-md2 bg-paper2 px-4 py-3 text-[15px]">Have an account? <Link href={`/signin?next=${encodeURIComponent(`/checkout/${o.id}`)}`} className="link">Sign in</Link> and we will fill this in for you. You can also pay as a guest.</p>
        </div>
      )}
      <CheckoutForm
        orderId={o.id}
        quote={{ slug: product.slug, quantity: item.quantity, config: item.config, sizeKey: item.size_key ?? undefined, widthFt: item.width_ft ?? undefined, heightFt: item.height_ft ?? undefined }}
        summary={{ productName: item.label ?? product.name, qtyText, priceKobo: item.line_total_kobo, designKobo: o.design_fee_kobo, designPath: item.artwork_path === 'design' }}
        custom={customReq ? { days: customReq.quote_days, code: customReq.code } : null}
        zones={zones.map((z) => ({ id: z.id, name: z.name, areas: z.areas, feeKobo: z.fee_kobo }))}
        holdExpiresAt={o.hold_expires_at ? new Date(o.hold_expires_at).toISOString() : null}
        vatRate={s.vat_rate}
        pricesIncludeVat={s.prices_include_vat}
        coupon={applied && applied.active ? publicCoupon(applied) : null}
        pickupAddress={s.pickup_address}
        windowsEnabled={s.windows_enabled}
        defaults={{ name: me?.name ?? cust?.name ?? customReq?.name ?? '', phone: local(me ? contactPhone(me) : (cust?.phone ?? customReq?.phone)), email: me?.email ?? cust?.email ?? customReq?.email ?? '', company: meBiz?.name ?? cust?.company ?? '', taxId: meBiz?.tax_id ?? cust?.tax_id ?? '', area: o.area ?? me?.default_area ?? '', address: addr.line1 ?? '', pickup: !!o.pickup, plainPack: !!o.plain_pack, window: o.delivery_window ?? '' }}
      />
    </>
  );
}
