import { NextResponse } from 'next/server';
import { confirmPayment } from '@/lib/orders';
import { verifyPaystackSignature } from '@/lib/payments';
import { confirmStudioPayment, isStudioRef } from '@/lib/studio/purchases';

export const dynamic = 'force-dynamic';

/** Paystack calls this when a payment succeeds. The signature proves it came from Paystack. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyPaystackSignature(raw, req.headers.get('x-paystack-signature'))) return new NextResponse('Invalid signature', { status: 401 });
  let evt: any;
  try {
    evt = JSON.parse(raw);
  } catch {
    return new NextResponse('Bad request', { status: 400 });
  }
  if (evt?.event === 'charge.success' && evt.data?.reference) {
    const reference = String(evt.data.reference);
    // Brandit Studio payments carry their own reference prefix and are settled by their own, equally checked, code.
    const r = isStudioRef(reference)
      ? await confirmStudioPayment({ reference, amountKobo: Number(evt.data.amount), method: evt.data.channel, raw: evt.data })
      : await confirmPayment({ reference, amountKobo: Number(evt.data.amount), method: evt.data.channel, raw: evt.data });
    if (!r.ok) console.error(`[paystack] payment ${reference} not applied: ${r.reason}`);
  }
  return NextResponse.json({ received: true });
}
