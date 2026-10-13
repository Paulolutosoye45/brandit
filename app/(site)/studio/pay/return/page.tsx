import { redirect } from 'next/navigation';
import { one } from '@/lib/db';
import { verifyWithPaystack } from '@/lib/payments';
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
  if (pu.status === 'pending') {
    const v = await verifyWithPaystack(ref);
    if (v?.paid) await confirmStudioPayment({ reference: ref, amountKobo: v.amountKobo, method: v.method, raw: v.raw });
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
