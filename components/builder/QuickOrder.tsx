'use client';
import { useState } from 'react';
import Link from 'next/link';
import { CropMarks } from '@/components/Brand';
import { ProductVisual } from '@/components/ProductVisual';
import { useT } from '@/components/LangProvider';
import { useOrderSheet } from './OrderSheet';
import { haystack, matches as matchWords } from '@/lib/searchTerms';
import type { QuickProduct } from './types';

/**
 * The home page's way in: six products to tap and a search box. A tap opens the Order Builder in a panel, so the customer
 * never leaves the page. Each tile is also a real link to /order/<product>, so it still works before the page has loaded.
 */
export function QuickOrder({ products }: { products: QuickProduct[] }) {
  const tr = useT();
  const { open } = useOrderSheet();
  const [q, setQ] = useState('');
  const tiles = products.slice(0, 6);
  const needle = q.trim().toLowerCase();
  const matches = needle ? products.filter((p) => matchWords(haystack({ slug: p.slug, name: p.name, category: p.category }), needle)).slice(0, 5) : [];
  const go = (slug: string) => { setQ(''); open(slug, { from: 'home' }); };
  return (
    <div className="relative">
      <CropMarks />
      <div className="card relative grid gap-5 rounded-lg2 border-ink p-5 shadow-press sm:p-6" aria-label={tr('Quick order')}>
        <div className="grid gap-1">
          <p className="font-display text-[28px] font-extrabold leading-tight">{tr('What do you need?')}</p>
          <p className="text-[15px] text-muted">{tr('Tap one. You see your price and delivery time first.')}</p>
        </div>
        <form role="search" className="relative" onSubmit={(e) => { e.preventDefault(); if (matches[0]) go(matches[0].slug); }}>
          <label htmlFor="quick-search" className="sr-only">{tr('Search products')}</label>
          <input id="quick-search" className="field" type="search" autoComplete="off" placeholder={tr('Search: flyers, stickers, banners…')} value={q} onChange={(e) => setQ(e.target.value)} />
          {needle && (
            <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md2 border-2 border-ink bg-surface shadow-press" role="listbox" aria-label={tr('Matching products')}>
              {matches.length === 0 ? (
                <li className="px-4 py-3 text-[15px] text-muted">{tr('We did not find that.')} <Link className="link font-bold" href="/custom-order">{tr('Ask for a custom price')}</Link></li>
              ) : matches.map((p) => (
                <li key={p.slug} role="option" aria-selected="false">
                  <button type="button" className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-paper2" onClick={() => go(p.slug)}>
                    <span className="font-bold">{p.name}</span><span className="text-[14px] text-muted">{p.from}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {tiles.map((p) => (
            <li key={p.slug}>
              <a
                href={`/order/${p.slug}`}
                onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; e.preventDefault(); go(p.slug); }}
                className="flex h-full flex-col overflow-hidden rounded-md2 border border-line bg-surface transition-colors hover:border-ink"
              >
                <span className="block aspect-[5/3] w-full bg-paper2"><ProductVisual cover={p.cover} alt="" slug={p.slug} name={p.name} className="h-full w-full" /></span>
                <span className="grid gap-0.5 p-2.5">
                  <span className="text-[15px] font-bold leading-tight">{p.name}</span>
                  <span className="text-[13px] font-bold text-muted">{p.from}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
        <p className="text-center text-[15px]"><Link href="/products" className="link font-bold">{tr('See all products')}</Link></p>
      </div>
    </div>
  );
}
