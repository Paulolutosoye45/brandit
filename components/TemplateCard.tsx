import Link from 'next/link';
import { TemplatePreview } from './TemplatePreview';
import { naira } from '@/lib/money';
import type { Template } from '@/lib/templates';

/** One template in a gallery: a picture of the style, its name, and the all-in price to start. */
export function TemplateCard({ t, totalKobo }: { t: Template; totalKobo: number | null }) {
  return (
    <Link href={`/templates/${t.slug}`} className="group flex flex-col overflow-hidden rounded-lg2 border border-line bg-surface transition-colors hover:border-ink">
      <div className="relative aspect-[4/5] overflow-hidden bg-paper2">
        {t.image_key ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/template-images/${t.id}`} alt={`${t.title} sample`} className="h-full w-full object-cover" loading="lazy" decoding="async" />
        ) : (
          <TemplatePreview look={t.look} title={t.title} />
        )}
        {t.category && <span className="pill absolute left-2 top-2 bg-surface/95 text-ink">{t.category}</span>}
      </div>
      <div className="grid gap-0.5 p-3 sm:p-4">
        <p className="text-[16px] font-bold leading-tight sm:text-[18px]">{t.title}</p>
        <p className="text-[13px] text-muted sm:text-[14px]">{t.includes}</p>
        {totalKobo != null && <p className="mt-0.5 text-[14px] font-bold sm:text-[15px]">From {naira(totalKobo)} with design</p>}
      </div>
    </Link>
  );
}
