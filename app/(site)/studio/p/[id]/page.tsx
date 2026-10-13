import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireCustomer } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import { listCatalog, getProduct, quantitySteps } from '@/lib/catalog';
import { buildSpec, isSpecError } from '@/lib/studio/specs';
import { STUDIO_ID } from '@/lib/studio/route';
import { projectView } from '@/lib/studio/view';
import { kick } from '@/lib/studio/worker';
import { Workspace } from '@/components/studio/Workspace';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your design', robots: { index: false } };

export default async function DesignPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!STUDIO_ID.test(id)) notFound();
  const c = await requireCustomer(`/studio/p/${id}`);
  const view = await projectView(c, id);
  if (!view) notFound();
  if (view.working) kick();
  const s = await getSettings();
  const prod = await getProduct(view.product.slug);
  const quantities = prod ? await quantitySteps(prod.id) : [];
  const cards = view.tier === 'premium' ? await listCatalog() : [];
  const adapt = cards
    .map(({ product: p }) => ({ p, spec: buildSpec(p, { sizeKey: p.sizes[0]?.key ?? null, widthFt: p.pricing_mode === 'area' ? 4 : null, heightFt: p.pricing_mode === 'area' ? 3 : null }, s) }))
    .filter(({ p, spec }) => !isSpecError(spec) && p.slug !== 'id-cards')
    .map(({ p }) => ({ slug: p.slug, name: p.name, mode: p.pricing_mode, sizes: p.sizes.map((x) => ({ key: x.key, label: x.label })) }));
  return (
    <div className="mx-auto grid max-w-[1160px] gap-6 px-5 py-6">
      <div>
        <Link href="/studio/projects" className="text-[14px] text-muted underline">My designs</Link>
      </div>
      <Workspace initial={view} quantities={quantities} adaptProducts={adapt} safePct={s.studio_safe_margin_pct} paid={sp.paid ?? null} />
    </div>
  );
}
