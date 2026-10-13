import { NextResponse } from 'next/server';
import { getOrder, saveCheckout } from '@/lib/orders';
import { initPayment, PaymentsNotConfiguredError } from '@/lib/payments';
import { query, one } from '@/lib/db';
import { ipOf, limited } from '@/lib/ratelimit';
import { getCustomer } from '@/lib/session';
import { rememberLangFor } from '@/lib/lang';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (limited(`checkout:${ipOf(req)}`, 20)) return NextResponse.json({ error: 'Too many tries. Wait a moment.' }, { status: 429 });
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 400 });
  const o0 = await getOrder(params.id);
  if (!o0) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });

  const item = await one('select artwork_path, artwork_file_id, preview_approved_at from order_items where order_id = $1', [params.id]);
  if (item?.artwork_path === 'upload' && !item.preview_approved_at) return NextResponse.json({ error: 'Approve your preview first, so we print exactly what you expect.', redirect: `/order/${params.id}/artwork` }, { status: 409 });
  if (!item?.artwork_path) return NextResponse.json({ error: 'Choose how you want to give us the artwork.', redirect: `/order/${params.id}/artwork` }, { status: 409 });

  const me = await getCustomer();
  const r = await saveCheckout(params.id, {
    name: String(b.name ?? ''), phone: String(b.phone ?? ''), email: String(b.email ?? ''), company: b.company ? String(b.company) : undefined, taxId: b.taxId ? String(b.taxId) : undefined,
    pickup: !!b.pickup, area: b.area ? String(b.area) : undefined, addressLine: b.addressLine ? String(b.addressLine) : undefined, plainPack: !!b.plainPack, window: b.window ? String(b.window) as any : null,
  }, me?.id ?? null);
  if (!r.ok) return NextResponse.json({ error: r.error, field: r.field }, { status: 422 });
  // A code that stopped being valid was taken off. Show the new total and let the customer decide before any money moves.
  if (r.couponMessage) return NextResponse.json({ error: `${r.couponMessage} We took the code off. Check your new total, then pay.`, field: 'coupon', couponRemoved: true }, { status: 422 });
  const o = (await getOrder(params.id))!;
  await rememberLangFor(o.customer_id);
  await query("update payments set status = 'superseded' where order_id = $1 and status = 'pending'", [o.id]);
  try {
    const pay = await initPayment(o, String(b.email).trim().toLowerCase());
    return NextResponse.json({ url: pay.url });
  } catch (e) {
    const notReady = e instanceof PaymentsNotConfiguredError;
    if (!notReady) console.error('[checkout] payment could not start', e);
    return NextResponse.json({ error: notReady ? 'Online payment is not available right now. Message us on WhatsApp and we will help you order.' : 'We could not start your payment. Try again in a moment.' }, { status: notReady ? 503 : 502 });
  }
}
