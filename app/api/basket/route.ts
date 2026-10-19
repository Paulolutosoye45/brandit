import { NextResponse } from 'next/server';
import { currentBasket, viewOf } from '@/lib/basket';

export const dynamic = 'force-dynamic';

/** What is in this browser's basket: the count for the badge, and the lines. */
export async function GET() {
  const b = await currentBasket();
  const view = b ? await viewOf(b.id) : null;
  return NextResponse.json({ count: view?.count ?? 0, view }, { headers: { 'Cache-Control': 'no-store' } });
}
