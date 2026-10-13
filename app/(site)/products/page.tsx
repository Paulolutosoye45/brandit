import type { Metadata } from 'next';
import Link from 'next/link';
import { categoriesOf, listCatalog } from '@/lib/catalog';
import { ProductTile } from '@/components/ProductTile';
import { PageHead } from '@/components/Bits';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Products',
  description: 'Business cards, flyers, banners, stickers, T-shirts and more, printed in Lagos. See your price and delivery time before you pay.',
};

export default async function Products(props: { searchParams: Promise<{ c?: string; q?: string }> }) {
  const sp = await props.searchParams;
  const all = await listCatalog();
  const cats = categoriesOf(all);
  const category = cats.includes(sp.c ?? '') ? sp.c! : '';
  const q = (sp.q ?? '').trim().toLowerCase().slice(0, 60);
  const shown = all.filter(({ product: p }) => (!category || p.category === category) && (!q || [p.name, p.blurb, p.category, p.description].some((t) => t.toLowerCase().includes(q))));
  const wa = process.env.NEXT_PUBLIC_WHATSAPP;
  const chip = (active: boolean) => `inline-flex min-h-[44px] shrink-0 items-center rounded-full border-2 px-4 font-bold ${active ? 'border-ink bg-ink text-white' : 'border-line-control bg-surface hover:border-ink'}`;
  const href = (c: string) => `/products${c || q ? '?' : ''}${[c && `c=${encodeURIComponent(c)}`, q && `q=${encodeURIComponent(q)}`].filter(Boolean).join('&')}`;

  return (
    <>
      <PageHead title="What do you need printed?" sub="Pick a product. You will see the price and the delivery time before you pay." />
      <div className="mx-auto grid max-w-[1160px] gap-5 px-5 pb-4">
        <form action="/products" role="search" className="flex gap-2">
          {category && <input type="hidden" name="c" value={category} />}
          <label htmlFor="product-search" className="sr-only">Search products</label>
          <input id="product-search" name="q" type="search" defaultValue={q} placeholder="Search: cards, banners, stickers…" className="field" enterKeyHint="search" />
          <button className="btn-secondary btn-sm shrink-0">Search</button>
        </form>
        {cats.length > 1 && (
          <nav aria-label="Product categories" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
            <Link href={href('')} aria-current={!category ? 'page' : undefined} className={chip(!category)}>All</Link>
            {cats.map((c) => <Link key={c} href={href(c)} aria-current={category === c ? 'page' : undefined} className={chip(category === c)}>{c}</Link>)}
          </nav>
        )}
      </div>
      <div className="mx-auto grid max-w-[1160px] grid-cols-2 gap-3 px-5 sm:gap-4 lg:grid-cols-3">
        {shown.map(({ product: p, from, cover, coverAlt, fast }, i) => (
          <ProductTile key={p.id} slug={p.slug} name={p.name} from={from} blurb={p.blurb} index={i} cover={cover} coverAlt={coverAlt} fast={fast} category={category ? undefined : p.category} />
        ))}
        <Link href="/custom-order" className="group col-span-2 flex flex-col justify-between gap-6 rounded-lg2 border-2 border-dashed sm:col-span-1 border-line-control bg-surface p-6 hover:border-ink">
          <div className="grid gap-2">
            <p className="font-display text-[24px] font-extrabold leading-tight">{shown.length === 0 ? 'Not found? Tell us what you need.' : 'Need something different?'}</p>
            <p className="text-muted">{shown.length === 0 ? 'We may be able to make it. Describe it and we send you a price.' : 'Odd sizes, special paper, bigger quantities. Describe it and a person sends you a price.'}</p>
          </div>
          <span className="btn-secondary btn-sm self-start group-hover:bg-paper2">Ask for a custom price</span>
        </Link>
      </div>
      {shown.length === 0 && (
        <p className="mx-auto mt-6 max-w-[1160px] px-5 text-muted">
          Nothing matches &ldquo;{q || category}&rdquo;. <Link className="link" href="/products">See everything</Link>{wa ? <> or <a className="link" href={`https://wa.me/${wa}?text=${encodeURIComponent('Hi Brandit, I am looking for something specific.')}`}>ask us on WhatsApp</a></> : null}.
        </p>
      )}
    </>
  );
}
