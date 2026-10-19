import { redirect } from 'next/navigation';
import { one } from '@/lib/db';
import { confirmPayment } from '@/lib/orders';
import { checkWithPaystack, paystackOn } from '@/lib/payments';
import { alertPaymentNotApplied, siteAlert } from '@/lib/siteAlert';
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
  if (pay.status !== 'success' && paystackOn()) {
    const c = await checkWithPaystack(ref);
    if (c.kind === 'paid') {
      const r = await confirmPayment({ reference: ref, amountKobo: c.amountKobo, method: c.method, raw: c.raw });
      if (!r.ok) await alertPaymentNotApplied(ref, r.reason);
    } else if (c.kind === 'error') {
      await siteAlert({ key: 'paystack-check', what: `We could not ask Paystack whether a customer's payment went through (${c.message}). Customers may be waiting on the "Confirming your payment" page.` });
    }
  }
  const again = await one('select status from payments where provider_ref = $1', [ref]);
  // Someone who paid through a shared pay link does not get the customer's tracking page. They get a thank-you.
  if (again?.status === 'success') redirect(pay.payer_email ? `/pay-link/${pay.public_token}` : `/track/${pay.public_token}`);
  return (
    <>
      <PageHead title="Confirming your payment" sub="This usually takes a few seconds. Bank transfers can take a little longer. You do not need to pay again." />
      <AutoRefresh seconds={5} />
    </>
  );
}
