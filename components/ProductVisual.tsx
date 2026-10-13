import { ProductArt } from './ProductArt';
import { imageUrl } from '@/lib/catalog-urls';

/** A product's photo when it has one, the drawn stand-in when it does not. */
export function ProductVisual({ cover, alt, slug, name, className = 'h-full w-full', size = 'thumb', priority = false }: { cover: string | null; alt: string; slug: string; name: string; className?: string; size?: 'thumb' | 'full'; priority?: boolean }) {
  if (!cover) return <ProductArt slug={slug} name={name} className={className} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageUrl(cover, size)} alt={alt} className={`${className} object-cover`} loading={priority ? 'eager' : 'lazy'} decoding="async" fetchPriority={priority ? 'high' : 'auto'} />
  );
}
