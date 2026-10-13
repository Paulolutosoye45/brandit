import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getOrderByToken, recomputeOrder } from '@/lib/orders';
import { query } from '@/lib/db';
import { PageHead } from '@/components/Bits';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Continue your order', robots: { index: false } };

/**
 * The link in the reminder message. It opens the unpaid order at checkout with a fresh price and a fresh hold on the delivery time.
 * A paid order goes to its tracking page. An order that can no longer be paid says so kindly and offers a fresh start.
 */
export default async function Continue(props: { params: Promise<{ token: string }>; searchParams: Promise<{ src?: string }> }) {
  const { token } = await props.params;
  const sp = await props.searchParams;
  if (!/^[\w-]{8,40}$/.test(token)) notFound();
  const o = await getOrderByToken(token);
  if (!o) notFound();
  if (sp.src === 'nudge') await query("insert into events (name, props) values ('nudge_clicked', $1)", [JSON.stringify({ order: o.code })]).catch(() => {});
  if (!['draft', 'awaiting_payment'].includes(o.status)) {
    if (o.status === 'cancelled') return <Gone />;
    redirect(`/track/${o.public_token}`);
  }
  const r = await recomputeOrder(o.id);
  if (!r.ok) return <Gone note={r.error} />;
  redirect(`/checkout/${o.id}`);
}

function Gone({ note }: { note?: string }) {
  return (
    <>
      <PageHead title="This order has closed" sub={note ?? 'It was not paid in time, so we let it go.'} />
      <div className="mx-auto max-w-[620px] px-5 pb-12 grid gap-4">
        <p className="text-muted">No charge was made. Starting again takes a minute, and you will see today&apos;s price and delivery time first.</p>
        <div className="flex flex-wrap gap-3"><Link href="/products" className="btn-primary">Start a new order</Link><Link href="/custom-order" className="btn-secondary">Ask for a custom price</Link></div>
      </div>
    </>
  );
}
