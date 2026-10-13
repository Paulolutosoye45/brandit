import { redirect } from 'next/navigation';
import { one } from '@/lib/db';
import { confirmPayment } from '@/lib/orders';
import { verifyWithPaystack } from '@/lib/payments';
import { isStudioRef } from '@/lib/studio/purchases';
import { PageHead } from '@/components/Bits';
import { AutoRefresh } from '@/components/AutoRefresh';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Confirming your payment' };

/**
 * Where Paystack sends the customer back. We never trust the browser: we ask Paystack directly
 * whether this reference was paid, and apply the same checked, repeat-safe confirmation as the webhook.
 */
export default async function PayReturn(props: { searchParams: Promise<{ reference?: string; trxref?: string }> }) {
  const searchParams = await props.searchParams;
  const ref = searchParams.reference ?? searchParams.trxref;
  if (!ref) redirect('/track');
  if (isStudioRef(ref)) redirect(`/studio/pay/return?reference=${encodeURIComponent(ref)}`);
  const pay = await one('select p.*, o.public_token from payments p join orders o on o.id = p.order_id where p.provider_ref = $1', [ref]);
  if (!pay) redirect('/track');
  if (pay.status !== 'success') {
    const v = await verifyWithPaystack(ref);
    if (v?.paid) await confirmPayment({ reference: ref, amountKobo: v.amountKobo, method: v.method, raw: v.raw });
  }
  const again = await one('select status from payments where provider_ref = $1', [ref]);
  if (again?.status === 'success') redirect(`/track/${pay.public_token}`);
  return (
    <>
      <PageHead title="Confirming your payment" sub="This usually takes a few seconds. Bank transfers can take a little longer. You do not need to pay again." />
      <AutoRefresh seconds={5} />
    </>
  );
}
