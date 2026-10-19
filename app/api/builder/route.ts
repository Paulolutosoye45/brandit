import { NextResponse } from 'next/server';
import { listCatalog } from '@/lib/catalog';
import { ipOf, limited } from '@/lib/ratelimit';
import type { QuickProduct } from '@/components/builder/types';

export const dynamic = 'force-dynamic';

/** The products for the picker in the order panel: name, "from" price and photo. Nothing about cost. */
export async function GET(req: Request) {
  if (limited(`builder-list:${ipOf(req)}`, 120)) return NextResponse.json({ error: 'Too many requests. Wait a moment.' }, { status: 429 });
  const cards = await listCatalog();
  const products: QuickProduct[] = cards.map(({ product: p, from, cover, coverAlt, fast }) => ({ slug: p.slug, name: p.name, from, cover, coverAlt, category: p.category, fast }));
  return NextResponse.json({ products }, { headers: { 'Cache-Control': 'no-store' } });
}
