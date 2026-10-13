'use client';
import { useState } from 'react';
import { ProductArt } from './ProductArt';
import { imageUrl } from '@/lib/catalog-urls';

type Img = { id: string; alt: string };

/** The product's photos: one large, the rest as small buttons underneath. With no photos it shows the drawing. */
export function ProductGallery({ images, slug, name }: { images: Img[]; slug: string; name: string; blurb?: string }) {
  const [i, setI] = useState(0);
  if (images.length === 0) {
    return (
      <div className="card overflow-hidden">
        <div className="grid place-items-center bg-paper2 p-5"><ProductArt slug={slug} name={name} className="h-[130px] w-full max-w-[320px]" /></div>
      </div>
    );
  }
  const cur = images[Math.min(i, images.length - 1)];
  return (
    <div className="card overflow-hidden">
      <div className="relative aspect-[4/3] bg-paper2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={cur.id} src={imageUrl(cur.id, 'full')} alt={cur.alt || name} className="absolute inset-0 h-full w-full animate-rise object-cover" fetchPriority={i === 0 ? 'high' : 'auto'} decoding="async" />
      </div>
      {images.length > 1 && (
        <ul className="flex gap-2 overflow-x-auto p-3" aria-label={`Photos of ${name}`}>
          {images.map((im, n) => (
            <li key={im.id} className="shrink-0">
              <button type="button" onClick={() => setI(n)} aria-label={`Show photo ${n + 1} of ${images.length}`} aria-current={n === i} className={`block overflow-hidden rounded-sm2 border-2 ${n === i ? 'border-ink' : 'border-transparent hover:border-line-control'}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl(im.id, 'thumb')} alt="" className="h-16 w-20 object-cover" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
