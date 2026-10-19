import { NextResponse } from 'next/server';
import { confirmPayment } from '@/lib/orders';
import { verifyPaystackSignature } from '@/lib/payments';
import { confirmStudioPayment, isStudioRef } from '@/lib/studio/purchases';
import { alertPaymentNotApplied, siteAlert } from '@/lib/siteAlert';

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
    const pay = { reference, amountKobo: Number(evt.data.amount), method: evt.data.channel, raw: evt.data };
    let r: { ok: boolean; reason?: string };
    try {
      r = isStudioRef(reference) ? await confirmStudioPayment(pay) : await confirmPayment(pay);
    } catch (e) {
      // Answer with an error so Paystack sends the notice again later, and tell the owner now.
      await siteAlert({ key: `payment:${reference.slice(0, 40)}`, what: `Paystack told us payment ${reference.slice(0, 40)} succeeded, but saving it failed (${(e as Error).message}). Paystack will try again; check the order if it stays unpaid.`, error: e });
      throw e;
    }
    if (!r.ok) {
      console.error(`[paystack] payment ${reference} not applied: ${r.reason}`);
      await alertPaymentNotApplied(reference, r.reason ?? 'UNKNOWN');
    }
  }
  return NextResponse.json({ received: true });
}
