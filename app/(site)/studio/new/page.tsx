import Link from 'next/link';
import type { Metadata } from 'next';
import { requireCustomer } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import { listCatalog } from '@/lib/catalog';
import { accessFor, runnable } from '@/lib/studio/config';
import { buildSpec, isSpecError } from '@/lib/studio/specs';
import { OCCASIONS } from '@/content/studio';
import { Notice } from '@/components/Bits';
import { NewDesign } from '@/components/studio/NewDesign';
import { lineForStudio } from '@/lib/studio/inOrder';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Start a design', robots: { index: false } };

export default async function NewStudioDesign(props: { searchParams: Promise<{ occasion?: string; product?: string; order?: string; item?: string }> }) {
  const sp = await props.searchParams;
  const back = new URLSearchParams();
  for (const k of ['occasion', 'product', 'order', 'item'] as const) if (sp[k]) back.set(k, sp[k]!);
  const c = await requireCustomer(`/studio/new${back.toString() ? `?${back}` : ''}`);
  const s = await getSettings();
  const access = s.studio_enabled && runnable() ? await accessFor(s, c as any) : { ok: false as const, message: 'Brandit Studio is not open yet.' };
  if (!access.ok) {
    return (
      <div className="mx-auto grid max-w-[720px] gap-4 px-5 py-10">
        <h1 className="text-[34px]">Brandit Studio</h1>
        <Notice tone="warn">{access.message}</Notice>
        <Link href="/studio" className="link w-fit">Back to Studio</Link>
      </div>
    );
  }
  const cards = await listCatalog();
  const products = cards
    .map(({ product: p }) => ({ p, spec: buildSpec(p, { sizeKey: p.sizes[0]?.key ?? null, widthFt: p.pricing_mode === 'area' ? 4 : null, heightFt: p.pricing_mode === 'area' ? 3 : null }, s) }))
    .filter(({ spec }) => !isSpecError(spec))
    .map(({ p }) => ({ slug: p.slug, name: p.name, mode: p.pricing_mode, sizes: p.sizes.map((x) => ({ key: x.key, label: x.label })), staffOnly: p.slug === 'id-cards' }));
  // Started from a line in the basket: the product, size and amount are that line's, and cannot be changed here.
  const uuid = /^[0-9a-f-]{36}$/;
  const line = sp.order && sp.item && uuid.test(sp.order) && uuid.test(sp.item) ? await lineForStudio(c.id, sp.order, sp.item) : null;
  const lineCard = line ? cards.find(({ product: p }) => p.slug === line.slug) : null;
  if (sp.item && (!line || !lineCard || !products.some((p) => p.slug === line.slug))) {
    return (
      <div className="mx-auto grid max-w-[720px] gap-4 px-5 py-10">
        <h1 className="text-[34px]">Brandit Studio</h1>
        <Notice tone="warn">{line ? 'Studio cannot make this product yet. You can upload your own file or ask a Brandit designer instead.' : 'We could not find that product in your basket. Go back to your basket and choose Studio again.'}</Notice>
        <Link href="/basket" className="link w-fit">Back to my basket</Link>
      </div>
    );
  }
  const lineLabel = line && lineCard ? `${line.quantity.toLocaleString('en-NG')} × ${lineCard.product.name}${line.widthFt ? ` · ${line.widthFt} × ${line.heightFt} ft` : ''}` : null;
  const occasions = OCCASIONS.map((o) => ({ id: o.id, label: o.label, blurb: o.blurb, products: o.products }));
  return (
    <div className="mx-auto grid max-w-[860px] gap-6 px-5 py-8">
      <div>
        <Link href="/studio" className="text-[14px] text-muted underline">Brandit Studio</Link>
        <h1 className="mt-1 text-[34px] leading-tight sm:text-[44px]">Start a design</h1>
        <p className="mt-1 max-w-[600px] text-[17px] text-muted">Two quick choices. Next you type your names and dates and see your free sketches.</p>
      </div>
      <NewDesign products={products} occasions={occasions} initialOccasion={sp.occasion ?? null} initialProduct={line ? line.slug : sp.product ?? null} orderId={sp.order ?? null} itemId={line ? sp.item! : null} lineLabel={lineLabel} />
    </div>
  );
}
