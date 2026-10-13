import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getTemplate, quantityChoices, templatePrice } from '@/lib/templates';
import { getSettings } from '@/lib/settings';
import { getCustomer } from '@/lib/session';
import { brandKitFor } from '@/lib/brandKit';
import { TemplatePreview } from '@/components/TemplatePreview';
import { TemplateForm } from './TemplateForm';
import { ViewBeacon } from '@/components/ViewBeacon';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const t = await getTemplate((await props.params).slug);
  return t ? { title: t.title, description: t.blurb || `${t.title}: answer a few questions and we design it for you.` } : { title: 'Template' };
}

export default async function TemplatePage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const t = await getTemplate(slug);
  if (!t) notFound();
  const [choices, price, s, me] = await Promise.all([quantityChoices(t), templatePrice(t), getSettings(), getCustomer().catch(() => null)]);
  const kit = me ? await brandKitFor(me.id) : null;
  return (
    <div className="mx-auto max-w-[1160px] px-5 pb-28 pt-8 lg:pb-16">
      <nav aria-label="Breadcrumb" className="mb-4 text-[14px] text-muted"><Link href="/templates" className="link">Templates</Link> <span aria-hidden>›</span> {t.title}</nav>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,420px)_1fr]">
        <div className="grid gap-3 lg:sticky lg:top-24">
          <div className="overflow-hidden rounded-lg2 border border-line bg-paper2">
            <div className={t.look.layout === 'banner' && !t.image_key ? 'aspect-[2/1]' : 'aspect-[4/5]'}>
              {t.image_key ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/template-images/${t.id}?size=full`} alt={`${t.title} sample`} className="h-full w-full object-cover" />
              ) : (
                <TemplatePreview look={t.look} title={t.title} />
              )}
            </div>
          </div>
          <p className="text-[13px] text-muted">{t.image_key ? 'A sample of the style.' : 'A sample of the style, not your final design. A designer makes yours from your answers.'}</p>
        </div>
        <div className="grid gap-6">
          <div className="grid gap-2">
            {t.category && <p className="text-[13px] font-bold uppercase tracking-wide text-muted">{t.category}</p>}
            <ViewBeacon name="template_view" slug={t.slug} />
            <h1 className="text-[36px] leading-[1.05] sm:text-[46px]">{t.title}</h1>
            {t.blurb && <p className="text-[18px] text-muted">{t.blurb}</p>}
            <p className="text-[15px] font-bold">{t.includes}</p>
          </div>
          <TemplateForm
            slug={t.slug}
            productSlug={t.product_slug}
            fields={t.fields}
            quantities={choices}
            defaultQuantity={t.quantity}
            quote={{ slug: t.product_slug, config: t.config, sizeKey: t.size_key ?? undefined, widthFt: t.width_ft ?? undefined, heightFt: t.height_ft ?? undefined }}
            initialPrintKobo={price?.printKobo ?? null}
            designKobo={s.design_fee_kobo}
            hasKit={!!kit}
            signedIn={!!me}
            unit={t.product_slug === 'flex-banners' ? 'banner' : 'copies'}
          />
        </div>
      </div>
    </div>
  );
}
