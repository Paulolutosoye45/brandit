import { notFound, redirect } from 'next/navigation';
import { one } from '@/lib/db';
import { demoPayments } from '@/lib/payments';
import { confirmStudioPayment } from '@/lib/studio/purchases';
import { SKU_LABEL, naira, type Sku } from '@/lib/studio/config';
import { Notice, PageHead } from '@/components/Bits';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Payment (demo)' };

async function simulate(fd: FormData) {
  'use server';
  if (!demoPayments()) return;
  const ref = String(fd.get('ref') ?? '');
  const pu = await one<{ amount_kobo: number; project_id: string | null; sku: string }>('select amount_kobo, project_id, sku from studio_purchases where provider_ref = $1', [ref]);
  if (!pu) return;
  await confirmStudioPayment({ reference: ref, amountKobo: pu.amount_kobo, method: 'demo' });
  redirect(pu.project_id ? `/studio/p/${pu.project_id}?paid=${pu.sku}` : `/studio?paid=${pu.sku}`);
}

export default async function StudioDemoPay(props: { params: Promise<{ id: string }>; searchParams: Promise<{ ref?: string }> }) {
  const sp = await props.searchParams;
  const params = await props.params;
  if (!demoPayments()) notFound();
  const pu = await one<{ id: string; amount_kobo: number; status: string; sku: Sku; project_id: string | null }>('select id, amount_kobo, status, sku, project_id from studio_purchases where id = $1 and provider_ref = $2', [params.id, sp.ref ?? '']);
  if (!pu) notFound();
  if (pu.status === 'paid') redirect(pu.project_id ? `/studio/p/${pu.project_id}` : '/studio');
  return (
    <>
      <PageHead title="Pay for Brandit Studio" sub={SKU_LABEL[pu.sku]} />
      <div className="mx-auto max-w-[560px] px-5 pb-12 grid gap-5">
        <Notice tone="warn"><p className="font-bold">Demo payment</p><p>No Paystack key is set, so no money moves. With a Paystack secret key set, this page is replaced by Paystack&apos;s secure checkout (card, bank transfer and USSD).</p></Notice>
        <div className="card p-6 grid gap-4 shadow-press">
          <div className="flex items-baseline justify-between"><span className="text-muted">Amount</span><span className="font-display font-extrabold text-[40px] leading-none tabular">{naira(pu.amount_kobo)}</span></div>
          <form action={simulate} className="grid gap-3">
            <input type="hidden" name="ref" value={sp.ref} />
            <button className="btn-primary" type="submit">Simulate a successful payment</button>
          </form>
          <a className="btn-secondary" href={pu.project_id ? `/studio/p/${pu.project_id}` : '/studio'}>Go back</a>
        </div>
      </div>
    </>
  );
}
