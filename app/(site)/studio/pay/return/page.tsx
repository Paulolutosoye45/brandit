import { redirect } from 'next/navigation';
import { one } from '@/lib/db';
import { checkWithPaystack, paystackOn } from '@/lib/payments';
import { alertPaymentNotApplied, siteAlert } from '@/lib/siteAlert';
import { confirmStudioPayment, isStudioRef } from '@/lib/studio/purchases';
import { PageHead } from '@/components/Bits';
import { AutoRefresh } from '@/components/AutoRefresh';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Confirming your payment' };

/**
 * Where Paystack sends the customer back after paying for Studio. As with orders, we never trust the browser:
 * Paystack is asked directly whether the reference was paid, and the same repeat-safe confirmation runs as in the webhook.
 */
export default async function StudioPayReturn(props: { searchParams: Promise<{ reference?: string; trxref?: string }> }) {
  const sp = await props.searchParams;
  const ref = sp.reference ?? sp.trxref;
  if (!ref || !isStudioRef(ref)) redirect('/studio');
  const pu = await one<{ status: string; project_id: string | null; sku: string }>('select status, project_id, sku from studio_purchases where provider_ref = $1', [ref]);
  if (!pu) redirect('/studio');
  if (pu.status === 'pending' && paystackOn()) {
    const c = await checkWithPaystack(ref);
    if (c.kind === 'paid') {
      const r = await confirmStudioPayment({ reference: ref, amountKobo: c.amountKobo, method: c.method, raw: c.raw });
      if (!r.ok) await alertPaymentNotApplied(ref, r.reason);
    } else if (c.kind === 'error') {
      await siteAlert({ key: 'paystack-check', what: `We could not ask Paystack whether a customer's Studio payment went through (${c.message}). Customers may be waiting on the "Confirming your payment" page.` });
    }
  }
  const again = await one<{ status: string }>('select status from studio_purchases where provider_ref = $1', [ref]);
  if (again?.status === 'paid') redirect(pu.project_id ? `/studio/p/${pu.project_id}?paid=${pu.sku}` : `/studio?paid=${pu.sku}`);
  return (
    <>
      <PageHead title="Confirming your payment" sub="This usually takes a few seconds. Bank transfers can take a little longer. You do not need to pay again." />
      <AutoRefresh seconds={5} />
    </>
  );
}
