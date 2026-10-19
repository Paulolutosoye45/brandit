import { NextResponse } from 'next/server';
import { designFeeOf, getItems, getOrder, identityOf } from '@/lib/orders';
import { validateCoupon, publicCoupon, type Identity } from '@/lib/coupons';
import { zoneForArea } from '@/lib/catalog';
import { getSettings } from '@/lib/settings';
import { normalizePhone } from '@/lib/phone';
import { normalizeCode } from '@/lib/couponCore';
import { query } from '@/lib/db';
import { ipOf, limited } from '@/lib/ratelimit';
import { getCustomer } from '@/lib/session';

export const dynamic = 'force-dynamic';

const open = (o: any) => o && ['draft', 'awaiting_payment'].includes(o.status);

/** Apply a coupon code to an order that is not paid yet. The server decides whether it is valid and what it is worth. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  // A code is a small secret. Guessing at them is slowed down.
  if (limited(`coupon:${ipOf(req)}`, 12, 60_000)) return NextResponse.json({ ok: false, error: 'Too many tries. Wait a minute and try again.' }, { status: 429 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ ok: false, error: 'Order not found.' }, { status: 404 });
  const b = await req.json().catch(() => null);
  const code = normalizeCode(b?.code);
  if (!code) return NextResponse.json({ ok: false, error: 'Type your code first.' }, { status: 422 });
  const o = await getOrder(id);
  const items = o ? await getItems(id) : [];
  if (!open(o) || items.length === 0) return NextResponse.json({ ok: false, error: 'This order can no longer be changed.' }, { status: 409 });

  const s = await getSettings();
  const pickup = b?.pickup != null ? !!b.pickup : !!o!.pickup;
  const zone = pickup ? null : await zoneForArea(b?.area ? String(b.area) : o!.area);
  const design = o!.custom_request_id ? 0 : items.reduce((a, it) => a + designFeeOf(s, it), 0);
  let identity: Identity = await identityOf(o!);
  if (!identity.customerId) {
    // A signed-in customer is who they say they are. A phone or email typed into the form is only a hint.
    const me = await getCustomer().catch(() => null);
    if (me) identity = { customerId: me.id, phone: me.phone, email: me.email };
  }
  if (!identity.customerId) {
    const phone = b?.phone ? normalizePhone(String(b.phone)) : null;
    const email = b?.email ? String(b.email).trim().toLowerCase() : null;
    identity = { phone, email: email && /^[^\s@]+@[^\s@]+$/.test(email) ? email : null };
  }
  const v = await validateCoupon(code, { subtotalKobo: items.reduce((a, it) => a + it.line_total_kobo, 0), designKobo: design, deliveryKobo: zone?.fee_kobo ?? 0, productId: items[0].product_id, lines: items.map((it) => ({ productId: it.product_id, kobo: it.line_total_kobo })), orderId: o!.id, identity, custom: !!o!.custom_request_id });
  if (!v.ok) return NextResponse.json({ ok: false, error: v.message }, { status: 422 });

  await query('update orders set coupon_id = $2, coupon_code = $3 where id = $1', [o!.id, v.coupon.id, v.coupon.code]);
  await query("insert into events (name, props) values ('coupon_applied', $1)", [JSON.stringify({ order: o!.code, coupon: v.coupon.code })]);
  return NextResponse.json({ ok: true, coupon: publicCoupon(v.coupon), discountKobo: v.discountKobo });
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ ok: false }, { status: 404 });
  const o = await getOrder(id);
  if (!open(o)) return NextResponse.json({ ok: false, error: 'This order can no longer be changed.' }, { status: 409 });
  await query('update orders set coupon_id = null, coupon_code = null, discount_kobo = 0 where id = $1', [id]);
  return NextResponse.json({ ok: true });
}
