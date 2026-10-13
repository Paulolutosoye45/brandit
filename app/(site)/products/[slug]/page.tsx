import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getProduct, listZones, lowestPriceKobo, productImages, quantitySteps } from '@/lib/catalog';
import { Configurator } from './Configurator';
import { getCustomer } from '@/lib/session';
import { Check } from '@/components/Bits';
import { getSettings } from '@/lib/settings';
import { accessFor, priceOf, runnable } from '@/lib/studio/config';
import { buildSpec, isSpecError } from '@/lib/studio/specs';

export const dynamic = 'force-dynamic';

const base = () => (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const params = await props.params;
  const p = await getProduct(params.slug);
  if (!p || !p.active) notFound(); // before the page streams, so the status is a real 404
  const images = await productImages(p.id);
  const description = (p.description.split('\n')[0] || p.blurb || `${p.name}, printed in Lagos. See your price and delivery time before you pay.`).slice(0, 200);
  const og = images[0] ? [{ url: `/api/product-images/${images[0].id}?size=full`, alt: images[0].alt || p.name }] : undefined;
  return { title: p.name, description, openGraph: { title: p.name, description, images: og }, alternates: { canonical: `/products/${p.slug}` } };
}

export default async function ProductPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const p = await getProduct(params.slug);
  if (!p || !p.active) notFound();
  const [zones, quantities, me, images, low] = await Promise.all([listZones(), quantitySteps(p.id), getCustomer(), productImages(p.id), lowestPriceKobo(p.id)]);
  const st = await getSettings();
  const studioOk = st.studio_enabled && runnable() && p.slug !== 'id-cards' && !isSpecError(buildSpec(p, { sizeKey: p.sizes[0]?.key ?? null, widthFt: p.pricing_mode === 'area' ? 4 : null, heightFt: p.pricing_mode === 'area' ? 3 : null }, st)) && (st.studio_access === 'everyone' || !!me);
  const studioAccess = studioOk ? await accessFor(st, me as any) : null;
  const paras = p.description.split(/\n{2,}/).map((t) => t.trim()).filter(Boolean);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: p.description || p.blurb,
    category: p.category || undefined,
    image: images.map((i) => `${base()}/api/product-images/${i.id}?size=full`),
    brand: { '@type': 'Brand', name: 'Brandit' },
    offers: low ? { '@type': 'Offer', priceCurrency: 'NGN', price: (low / 100).toFixed(2), availability: 'https://schema.org/InStock', url: `${base()}/products/${p.slug}` } : undefined,
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />
      <div className="mx-auto max-w-[1160px] px-5 pt-6 pb-5">
        <Link href="/products" className="text-[15px] font-bold text-muted hover:text-ink inline-flex min-h-[44px] items-center">All products</Link>
        {p.category && <p className="text-[13px] font-bold uppercase tracking-wide text-muted">{p.category}</p>}
        <h1 className="text-[36px] sm:text-[48px] leading-[1.05]">{p.name}</h1>
        <p className="mt-2 text-[18px] text-muted max-w-[640px]">{p.blurb || 'See your price and your delivery time before you pay.'}</p>
      </div>
      {studioAccess?.ok || (studioOk && st.studio_access === 'everyone') ? (
        <div className="mx-auto max-w-[1160px] px-5 pb-4">
          <Link href={`/studio/new?product=${p.slug}`} className="card flex flex-wrap items-center justify-between gap-3 border-2 border-accent bg-accent/20 p-4 hover:border-ink">
            <span><span className="block text-[18px] font-bold">No design yet? Make one with Brandit Studio</span><span className="block text-[15px] text-muted">Type your words, see free sketches, and get a print-ready design from ₦{Math.round(priceOf(st, 'standard') / 100).toLocaleString('en-NG')}.</span></span>
            <span className="btn-secondary btn-sm">Try Studio</span>
          </Link>
        </div>
      ) : null}
      <Configurator
        product={{ slug: p.slug, name: p.name, blurb: p.blurb, mode: p.pricing_mode, options: p.options, sizes: p.sizes.map((s) => ({ key: s.key, label: s.label })), allowCustom: p.allow_custom, images: images.map((i) => ({ id: i.id, alt: i.alt })) }}
        quantities={quantities}
        zones={zones.map((z) => ({ id: z.id, name: z.name, areas: z.areas }))}
        whatsapp={process.env.NEXT_PUBLIC_WHATSAPP ?? null}
        defaultArea={me?.default_area ?? null}
      />
      {(paras.length > 0 || p.highlights.length > 0 || p.allow_custom) && (
        <section className="mx-auto mt-2 grid max-w-[1160px] gap-6 px-5 pb-8 lg:grid-cols-[1fr_400px]" aria-label={`About ${p.name}`}>
          <div className="grid gap-5">
            {paras.length > 0 && (
              <div className="card p-5 sm:p-6 grid gap-3">
                <h2 className="text-[22px]">About this product</h2>
                {paras.map((t, i) => <p key={i} className="text-[17px] leading-relaxed">{t}</p>)}
              </div>
            )}
            {p.highlights.length > 0 && (
              <div className="card p-5 sm:p-6 grid gap-3">
                <h2 className="text-[22px]">Good to know</h2>
                <ul className="grid gap-2">
                  {p.highlights.map((h) => <li key={h} className="flex items-start gap-3 text-[17px]"><span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-good-tint text-good"><Check className="h-3.5 w-3.5" /></span>{h}</li>)}
                </ul>
              </div>
            )}
          </div>
          {p.allow_custom && (
            <div className="card h-fit p-5 sm:p-6 grid gap-3 bg-paper2">
              <h2 className="text-[22px]">Need it different?</h2>
              <p className="text-muted">A different size, a bigger quantity, a special paper? Tell us what you need and a person sends you a price. You pay only if you say yes.</p>
              <Link href={`/custom-order?product=${p.slug}`} className="btn-secondary btn-sm self-start">Ask for a custom price</Link>
            </div>
          )}
        </section>
      )}
    </>
  );
}
