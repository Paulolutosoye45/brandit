import Link from 'next/link';
import type { Metadata } from 'next';
import { currentBasket, viewOf } from '@/lib/basket';
import { query } from '@/lib/db';
import { PageHead } from '@/components/Bits';
import { OpenOrder } from '@/components/builder/HeaderButtons';
import { naira } from '@/lib/money';
import { BasketLines } from './BasketLines';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your basket', robots: { index: false, follow: false } };

export default async function BasketPage() {
  const b = await currentBasket();
  const view = b ? await viewOf(b.id) : null;
  if (!view || view.lines.length === 0) {
    return (
      <>
        <PageHead title="Your basket" sub="Nothing here yet." />
        <div className="mx-auto grid max-w-[640px] gap-5 px-5 pb-16">
          <div className="card grid gap-4 p-6">
            <p className="text-[18px]">Pick a product, see your price and delivery time, and it appears here.</p>
            <div className="flex flex-wrap gap-3">
              <OpenOrder label="Order now" className="btn-primary" />
              <Link href="/products" className="btn-secondary">See all products</Link>
            </div>
          </div>
        </div>
      </>
    );
  }
  const covers = await query<{ slug: string; cover: string | null }>(
    `select p.slug, (select id from product_images i where i.product_id = p.id order by i.sort, i.created_at limit 1) as cover from products p where p.slug = any($1::text[])`,
    [view.lines.map((l) => l.slug)],
  );
  const coverOf = Object.fromEntries(covers.map((c) => [c.slug, c.cover]));
  const printKobo = view.lines.reduce((a, l) => a + l.priceKobo, 0);
  const designKobo = view.lines.reduce((a, l) => a + l.designKobo, 0);
  const waiting = view.lines.filter((l) => !l.ready);
  return (
    <>
      <PageHead title="Your basket" sub={`${view.lines.length} product${view.lines.length === 1 ? '' : 's'}. Delivery is charged once for the whole order.`} />
      <div className="mx-auto grid max-w-[1160px] items-start gap-8 px-5 pb-28 lg:grid-cols-[1fr_380px] lg:pb-12">
        <BasketLines
          orderId={view.orderId}
          lines={view.lines.map((l) => ({ ...l, cover: coverOf[l.slug] ?? null }))}
        />
        <aside className="card grid gap-4 p-6 shadow-press lg:sticky lg:top-[84px]" aria-label="Basket total">
          <dl className="grid gap-2 text-[16px] tabular">
            <div className="flex justify-between gap-3"><dt>Print</dt><dd>{naira(printKobo)}</dd></div>
            {designKobo > 0 && <div className="flex justify-between gap-3"><dt>Design fee</dt><dd>{naira(designKobo)}</dd></div>}
            <div className="flex justify-between gap-3"><dt>Delivery</dt><dd className="text-right text-muted">Added at checkout</dd></div>
            <div className="mt-1 flex items-baseline justify-between border-t border-line pt-3"><dt className="font-bold">Subtotal</dt><dd className="font-display text-[30px] font-extrabold leading-none">{naira(printKobo + designKobo)}</dd></div>
          </dl>
          {waiting.length > 0 ? (
            <>
              <p role="status" className="rounded-md2 bg-warn-tint px-4 py-3 text-[15px]"><b>{waiting.length === 1 ? `${waiting[0].name} still needs its artwork.` : `${waiting.length} products still need their artwork.`}</b> Finish {waiting.length === 1 ? 'it' : 'them'}, then check out.</p>
              <Link href={`/products/${waiting[0].slug}?line=${waiting[0].id}`} className="btn-primary w-full">Finish {waiting[0].name}</Link>
            </>
          ) : (
            <Link href={`/checkout/${view.orderId}`} className="btn-primary w-full">Check out</Link>
          )}
          <OpenOrder label="Add another product" className="btn-secondary btn-sm w-full" />
          <p className="text-center text-[13px] text-muted">You see the delivery fee and your arrival time before you pay.</p>
        </aside>
      </div>
      {waiting.length === 0 && (
        <div className="no-print fixed inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom))] z-20 flex items-center justify-between gap-3 border-t border-line bg-surface px-4 py-2.5 lg:hidden">
          <div className="min-w-0"><p className="text-[12px] font-bold leading-none text-muted">Subtotal</p><p className="font-display text-[22px] font-extrabold leading-tight tabular">{naira(printKobo + designKobo)}</p></div>
          <Link href={`/checkout/${view.orderId}`} className="btn-primary btn-sm shrink-0">Check out</Link>
        </div>
      )}
    </>
  );
}
