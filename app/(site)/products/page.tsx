import type { Metadata } from 'next';
import Link from 'next/link';
import { categoriesOf, listCatalog } from '@/lib/catalog';
import { getBusiness } from '@/lib/business';
import { getSettings } from '@/lib/settings';
import { runnable } from '@/lib/studio/config';
import { listTemplates, templatePrice } from '@/lib/templates';
import { haystack, matches } from '@/lib/searchTerms';
import { ProductTile } from '@/components/ProductTile';
import { TemplateCard } from '@/components/TemplateCard';
import { PageHead } from '@/components/Bits';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Products',
  description: 'Business cards, flyers, banners, stickers, T-shirts and more, printed in Lagos. See your price and delivery time before you pay.',
};

const GRID = 'grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3';

export default async function Products(props: { searchParams: Promise<{ c?: string; q?: string }> }) {
  const sp = await props.searchParams;
  const [all, settings, biz] = await Promise.all([listCatalog(false, true), getSettings(), getBusiness()]);
  const sample = all.find(({ product }) => product.sample) ?? null;
  const cards = all.filter(({ product }) => !product.sample);
  const cats = categoriesOf(cards);
  const category = cats.includes(sp.c ?? '') ? sp.c! : '';
  const q = (sp.q ?? '').trim().slice(0, 60);
  const shown = cards.filter(({ product: p }) => (!category || p.category === category) && (!q || matches(haystack(p), q)));
  // A search also looks through the ready-made templates, so "church programme" finds both the product and the styles.
  const tplHits = q ? (await listTemplates()).filter((t) => matches(haystack({ slug: '', name: t.title, blurb: t.blurb, category: t.category, description: `${t.includes} ${t.product_name}` }), q)).slice(0, 8) : [];
  const tplPrices = await Promise.all(tplHits.map((t) => templatePrice(t)));
  const studio = settings.studio_enabled && runnable();
  const wa = biz.whatsapp;
  const nothing = shown.length === 0 && tplHits.length === 0;

  const chip = (active: boolean) => `inline-flex min-h-[44px] shrink-0 items-center rounded-full border-2 px-4 font-bold ${active ? 'border-ink bg-ink text-white' : 'border-line-control bg-surface hover:border-ink'}`;
  const href = (c: string) => `/products${c || q ? '?' : ''}${[c && `c=${encodeURIComponent(c)}`, q && `q=${encodeURIComponent(q)}`].filter(Boolean).join('&')}`;
  const tile = (c: (typeof cards)[number], i: number, withCategory: boolean) => (
    <ProductTile key={c.product.id} slug={c.product.slug} name={c.product.name} from={c.from} blurb={c.product.blurb} index={i} cover={c.cover} coverAlt={c.coverAlt} fast={c.fast} category={withCategory ? c.product.category : undefined} />
  );

  // With no filter and no search the products sit under their group names, in the usual order. A filter or a search is one flat list.
  const grouped = !category && !q;
  const groups = grouped
    ? [...cats, ...(cards.some(({ product }) => !product.category.trim()) ? [''] : [])]
        .map((c) => ({ name: c, items: cards.filter(({ product }) => product.category.trim() === c) }))
        .filter((g) => g.items.length > 0)
    : [];

  return (
    <>
      <PageHead title="What do you need printed?" sub="Pick a product. You will see the price and the delivery time before you pay." />
      <div className="mx-auto grid max-w-[1160px] gap-5 px-5 pb-4">
        <form action="/products" role="search" className="flex gap-2">
          {category && <input type="hidden" name="c" value={category} />}
          <label htmlFor="product-search" className="sr-only">Search products and templates</label>
          <input id="product-search" name="q" type="search" defaultValue={q} placeholder="Search: church programme, name tag, banner…" className="field" enterKeyHint="search" />
          <button className="btn-secondary btn-sm shrink-0">Search</button>
        </form>
        {cats.length > 1 && (
          <nav aria-label="Product groups" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
            <Link href={href('')} aria-current={!category ? 'page' : undefined} className={chip(!category)}>All</Link>
            {cats.map((c) => <Link key={c} href={href(c)} aria-current={category === c ? 'page' : undefined} className={chip(category === c)}>{c}</Link>)}
          </nav>
        )}
      </div>

      {sample && !category && !q && (
        <section aria-label="Sample pack" className="mx-auto max-w-[1160px] px-5 pb-6">
          <Link href={`/products/${sample.product.slug}`} className="card group grid gap-1 border-2 border-accent p-5 hover:border-ink sm:grid-cols-[1fr_auto] sm:items-center sm:gap-6 sm:p-6">
            <span className="grid gap-1">
              <span className="font-display text-[22px] font-extrabold leading-tight sm:text-[26px]">Not sure which paper to pick? Try a sample pack.</span>
              <span className="text-[16px] text-muted">A small box of our real work. What you pay comes back as credit on your first order.</span>
            </span>
            <span className="btn-secondary btn-sm justify-self-start group-hover:bg-paper2">{sample.from && /\d/.test(sample.from) ? `See the sample pack · ${sample.from}` : 'See the sample pack'}</span>
          </Link>
        </section>
      )}

      {grouped ? (
        <div className="mx-auto grid max-w-[1160px] gap-8 px-5">
          {groups.map((g) => (
            <section key={g.name || 'more'} aria-labelledby={`g-${g.name || 'more'}`.replace(/\s+/g, '-')}>
              <h2 id={`g-${g.name || 'more'}`.replace(/\s+/g, '-')} className="mb-3 text-[22px] sm:text-[24px]">{g.name || 'More'}</h2>
              <div className={GRID}>{g.items.map((c, i) => tile(c, i, false))}</div>
            </section>
          ))}
        </div>
      ) : shown.length > 0 ? (
        <div className={`mx-auto max-w-[1160px] px-5 ${GRID}`}>{shown.map((c, i) => tile(c, i, !category))}</div>
      ) : null}

      {tplHits.length > 0 && (
        <section aria-labelledby="tpl-hits" className="mx-auto mt-8 max-w-[1160px] px-5">
          <h2 id="tpl-hits" className="mb-3 text-[22px] sm:text-[24px]">Ready-made templates</h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {tplHits.map((t, i) => <TemplateCard key={t.id} t={t} totalKobo={tplPrices[i] ? tplPrices[i]!.printKobo + tplPrices[i]!.designKobo : null} />)}
          </div>
        </section>
      )}

      {nothing && (
        <div className="mx-auto mt-2 grid max-w-[1160px] gap-3 px-5">
          <div className="card grid gap-3 border-2 border-dashed border-line-control p-6">
            <p className="font-display text-[24px] font-extrabold leading-tight">Nothing matches &ldquo;{q || category}&rdquo;. Tell us what you need.</p>
            <p className="text-muted">We may be able to make it. Describe it and a person sends you a price.</p>
            <p className="flex flex-wrap gap-2">
              <Link href="/custom-order" className="btn-primary btn-sm">Ask for a custom price</Link>
              <Link href="/products" className="btn-secondary btn-sm">See everything</Link>
              {wa && <a className="btn-secondary btn-sm" href={`https://wa.me/${wa}?text=${encodeURIComponent('Hi Brandit, I am looking for something specific.')}`}>Ask us on WhatsApp</a>}
            </p>
          </div>
        </div>
      )}

      {!nothing && (
        <section aria-labelledby="other-ways" className="mx-auto mt-10 max-w-[1160px] px-5">
          <h2 id="other-ways" className="mb-3 text-[22px] sm:text-[24px]">Other ways to order</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['/custom-order', 'Something different', 'Odd sizes, special paper, big quantities. Describe it and a person sends you a price.'],
              ['/plan-event', 'Plan an event', 'Tell us about the day once. You get one price for everything that needs printing.'],
              ...(studio ? [['/studio', 'Design with Brandit Studio', 'Tell us about your event or business and get print-ready designs. Two free sketches before you pay.']] : []),
              ['/business', 'For businesses', 'Reorder in one tap, VAT invoices, a shared company brand kit and staff ID cards.'],
            ].map(([to, title, text]) => (
              <li key={to}>
                <Link href={to} className="card group grid h-full content-start gap-1 p-4 hover:border-ink">
                  <span className="text-[17px] font-bold leading-tight">{title}</span>
                  <span className="text-[15px] text-muted">{text}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
