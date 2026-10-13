import Link from 'next/link';
import { ProductVisual } from './ProductVisual';

const TINTS = ['bg-paper2', 'bg-warn-tint', 'bg-paper2', 'bg-placeholder'];

type Props = { slug: string; name: string; from: string; blurb?: string; index?: number; featured?: boolean; fast?: boolean; cover?: string | null; coverAlt?: string; category?: string };

/** One product. The first tile on a page can be featured: bigger, and on ink. */
export function ProductTile({ slug, name, from, blurb, index = 0, featured = false, fast = false, cover = null, coverAlt, category }: Props) {
  const alt = cover ? (coverAlt || name) : '';
  if (featured) {
    return (
      <Link href={`/products/${slug}`} className="on-dark group col-span-2 flex flex-col overflow-hidden rounded-lg2 bg-ink text-white lg:row-span-2">
        <div className={`relative min-h-[240px] flex-1 ${cover ? '' : 'grid place-items-center bg-ink2 p-6'}`}>
          <ProductVisual cover={cover} alt={alt} slug={slug} name={name} size={cover ? 'full' : 'thumb'} className={cover ? 'absolute inset-0 h-full w-full' : 'h-full max-h-[300px] w-full'} />
          {fast && <span className="pill absolute left-4 top-4 bg-accent text-ink">24-hour option</span>}
        </div>
        <div className="grid gap-1 p-6">
          <p className="font-display text-[28px] font-extrabold leading-tight">{name}</p>
          {blurb && <p className="text-[15px] text-on-ink-muted">{blurb}</p>}
          <p className="mt-1 text-[17px] font-bold text-accent">{from}</p>
        </div>
      </Link>
    );
  }
  return (
    <Link href={`/products/${slug}`} className="group flex flex-col overflow-hidden rounded-lg2 border border-line bg-surface transition-colors hover:border-ink">
      <div className={`relative aspect-[4/3] ${cover ? 'bg-paper2' : `grid place-items-center p-3 sm:p-4 ${TINTS[index % TINTS.length]}`}`}>
        <ProductVisual cover={cover} alt={alt} slug={slug} name={name} className="h-full w-full" />
        {fast && <span className="pill absolute left-2 top-2 bg-ink text-white sm:left-3 sm:top-3"><span className="sm:hidden">24-hour</span><span className="hidden sm:inline">24-hour option</span></span>}
      </div>
      <div className="grid gap-0.5 p-3 sm:p-4">
        {category && <p className="hidden text-[12px] font-bold uppercase tracking-wide text-muted sm:block">{category}</p>}
        <p className="text-[16px] font-bold leading-tight sm:text-[18px]">{name}</p>
        {blurb && <p className="hidden text-[14px] leading-snug text-muted sm:block">{blurb}</p>}
        <p className="mt-0.5 text-[14px] font-bold sm:mt-1 sm:text-[15px]">{from}</p>
      </div>
    </Link>
  );
}
