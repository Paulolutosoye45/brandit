import Link from 'next/link';
import { redirect } from 'next/navigation';
import { one } from '@/lib/db';
import { getCustomer } from '@/lib/session';
import { nameSql } from '@/lib/lines';
import { naira } from '@/lib/money';
import { Notice, PageHead } from '@/components/Bits';
import { reorderFromReminder } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Order the same again', robots: { index: false, follow: false } };

/** Where a reminder takes you. It shows what you ordered before and asks you to confirm; nothing is added until you tap. */
export default async function ReorderPage(props: { params: Promise<{ token: string }>; searchParams: Promise<{ e?: string }> }) {
  const { token } = await props.params;
  const sp = await props.searchParams;
  const me = await getCustomer();
  if (!me) redirect(`/signin?next=${encodeURIComponent(`/reorder/${token}`)}`);
  const o = /^[\w-]{8,40}$/.test(token)
    ? await one<any>(`select o.id, o.code, o.customer_id, o.total_kobo, o.created_at, o.custom_request_id, ${nameSql('o')} as product from orders o where o.public_token = $1 and o.status <> 'draft'`, [token])
    : null;

  if (!o || o.customer_id !== me.id || o.custom_request_id) {
    return (
      <>
        <PageHead title="We could not open that order" sub="This reminder may belong to another account." />
        <div className="mx-auto grid max-w-[620px] gap-4 px-5 pb-12">
          <Notice tone="warn">Sign in with the phone number or email you ordered with, then open the reminder again. Or choose from your own orders.</Notice>
          <Link href="/account" className="btn-primary self-start">Go to my orders</Link>
        </div>
      </>
    );
  }
  const files = await one<{ n: number }>("select count(*)::int as n from order_items where order_id = $1 and (artwork_file_id is not null or artwork_path = 'design')", [o.id]);
  return (
    <>
      <PageHead title="Order the same again?" sub={`Last time: order ${o.code}.`} />
      <div className="mx-auto grid max-w-[620px] gap-4 px-5 pb-16">
        {sp.e && <Notice tone="bad">{sp.e}</Notice>}
        <section className="card grid gap-3 p-6">
          <p className="text-[22px] font-bold leading-tight">{o.product}</p>
          <p className="text-[15px] text-muted">Same choices as before, at today&apos;s prices. You see the price and the delivery time before you pay. Last time it came to {naira(o.total_kobo)}.</p>
          {(files?.n ?? 0) > 0 && <p className="text-[15px]">Your approved artwork is kept, so there is nothing to upload.</p>}
          <form action={reorderFromReminder}>
            <input type="hidden" name="token" value={token} />
            <button className="btn-primary w-full sm:w-auto">Order the same again</button>
          </form>
        </section>
        <p className="text-[14px] text-muted">Want to change something first? <Link href="/products" className="link">Start from the products</Link>.</p>
      </div>
    </>
  );
}
