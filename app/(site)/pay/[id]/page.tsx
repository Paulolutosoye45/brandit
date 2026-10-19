import { notFound, redirect } from 'next/navigation';
import { one } from '@/lib/db';
import { confirmPayment, getOrder } from '@/lib/orders';
import { demoPayments } from '@/lib/payments';
import { naira } from '@/lib/money';
import { Notice, PageHead } from '@/components/Bits';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Payment (demo)' };

async function simulate(fd: FormData) {
  'use server';
  if (!demoPayments()) return;
  const ref = String(fd.get('ref') ?? '');
  const pay = await one('select * from payments where provider_ref = $1', [ref]);
  if (!pay) return;
  const o = await getOrder(pay.order_id);
  await confirmPayment({ reference: ref, amountKobo: pay.amount_kobo, method: 'demo' });
  redirect(pay.payer_email ? `/pay-link/${o!.public_token}` : `/track/${o!.public_token}`);
}

export default async function DemoPay(
  props: { params: Promise<{ id: string }>; searchParams: Promise<{ ref?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  if (!demoPayments()) notFound();
  const o = await getOrder(params.id);
  if (!o || !searchParams.ref) notFound();
  if (o.status === 'paid' || o.paid_at) redirect(`/track/${o.public_token}`);
  return (
    <>
      <PageHead title="Pay for your order" sub={`Order ${o.code}`} />
      <div className="mx-auto max-w-[560px] px-5 pb-12 grid gap-5">
        <Notice tone="warn"><p className="font-bold">Demo payment</p><p>No Paystack key is set, so no money moves. With a Paystack secret key in the settings, this page is replaced by Paystack&apos;s secure checkout (card, bank transfer and USSD).</p></Notice>
        <div className="card p-6 grid gap-4 shadow-press">
          <div className="flex items-baseline justify-between"><span className="text-muted">Amount</span><span className="font-display font-extrabold text-[40px] leading-none tabular">{naira(o.total_kobo)}</span></div>
          <form action={simulate} className="grid gap-3">
            <input type="hidden" name="ref" value={searchParams.ref} />
            <button className="btn-primary" type="submit">Simulate a successful payment</button>
          </form>
          <a className="btn-secondary" href={`/checkout/${o.id}`}>Go back</a>
        </div>
      </div>
    </>
  );
}
