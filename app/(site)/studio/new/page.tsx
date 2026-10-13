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

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Start a design', robots: { index: false } };

export default async function NewStudioDesign(props: { searchParams: Promise<{ occasion?: string; product?: string; order?: string }> }) {
  const sp = await props.searchParams;
  const c = await requireCustomer(`/studio/new${sp.occasion ? `?occasion=${encodeURIComponent(sp.occasion)}` : ''}`);
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
  const occasions = OCCASIONS.map((o) => ({ id: o.id, label: o.label, blurb: o.blurb, products: o.products }));
  return (
    <div className="mx-auto grid max-w-[860px] gap-6 px-5 py-8">
      <div>
        <Link href="/studio" className="text-[14px] text-muted underline">Brandit Studio</Link>
        <h1 className="mt-1 text-[34px] leading-tight sm:text-[44px]">Start a design</h1>
        <p className="mt-1 max-w-[600px] text-[17px] text-muted">Two quick choices. Next you type your names and dates and see your free sketches.</p>
      </div>
      <NewDesign products={products} occasions={occasions} initialOccasion={sp.occasion ?? null} initialProduct={sp.product ?? null} orderId={sp.order ?? null} />
    </div>
  );
}
