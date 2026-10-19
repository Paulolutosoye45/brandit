import { NextResponse } from 'next/server';
import { getItems, getOrder, saveCheckout } from '@/lib/orders';
import { artworkOutstanding } from '@/lib/lines';
import { makePayLink } from '@/lib/payLink';
import { namesProblem } from '@/lib/nameList';
import { studioProblem } from '@/lib/studio/inOrder';
import { getProductById } from '@/lib/catalog';
import { signInAvailable } from '@/lib/authconfig';
import { initPayment, PaymentsNotConfiguredError } from '@/lib/payments';
import { query } from '@/lib/db';
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

  // Every product in the basket needs its artwork settled before anyone pays.
  const lines = await getItems(params.id);
  if (lines.length === 0) return NextResponse.json({ error: 'Your basket is empty.', redirect: '/products' }, { status: 409 });
  const waiting = lines.find((l) => artworkOutstanding(l as any));
  if (waiting) {
    const p = await getProductById(waiting.product_id);
    return NextResponse.json({ error: lines.length > 1 ? `${p?.name ?? 'A product'} still needs its artwork. Finish it, then pay.` : 'Add your artwork first, so we print exactly what you expect.', redirect: '/basket' }, { status: 409 });
  }

  // A list of names has to add up to the quantity, or the wrong number of pieces would print.
  const listProblem = await namesProblem(params.id);
  if (listProblem) return NextResponse.json({ error: listProblem, redirect: '/basket' }, { status: 409 });

  // Signing in is how a customer pays: a verified email or a Google account. Only when no way to sign in is set up can a guest pay.
  const me = await getCustomer();
  // A Studio design must still be something Studio can make (words in, box ticked, nothing blocked) before money moves.
  if (lines.some((l) => l.artwork_path === 'studio')) {
    const problem = await studioProblem(params.id, me);
    if (problem) return NextResponse.json({ error: problem, redirect: '/basket' }, { status: 409 });
  }
  if (!me && signInAvailable()) return NextResponse.json({ error: 'Sign in to pay. It takes a few seconds and keeps your orders in one place.', field: 'signin' }, { status: 401 });
  const r = await saveCheckout(params.id, {
    name: String(b.name ?? ''), phone: String(b.phone ?? ''), email: String(b.email ?? ''), company: b.company ? String(b.company) : undefined, taxId: b.taxId ? String(b.taxId) : undefined,
    pickup: !!b.pickup, area: b.area ? String(b.area) : undefined, addressLine: b.addressLine ? String(b.addressLine) : undefined, plainPack: !!b.plainPack, window: b.window ? String(b.window) as any : null,
  }, me?.id ?? null);
  if (!r.ok) return NextResponse.json({ error: r.error, field: r.field }, { status: 422 });
  // A code that stopped being valid was taken off. Show the new total and let the customer decide before any money moves.
  if (r.couponMessage) return NextResponse.json({ error: `${r.couponMessage} We took the code off. Check your new total, then pay.`, field: 'coupon', couponRemoved: true }, { status: 422 });
  const o = (await getOrder(params.id))!;
  await rememberLangFor(o.customer_id);
  // "Ask someone else to pay": the details are saved exactly as for paying, then a link is made instead of a payment.
  if (b.share) {
    const link = await makePayLink(o.id, b.note ? String(b.note) : null);
    if (!link.ok) return NextResponse.json({ error: link.error }, { status: 409 });
    return NextResponse.json({ link: link.url, total: o.total_kobo, code: o.code });
  }
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
