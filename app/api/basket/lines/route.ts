import { NextResponse } from 'next/server';
import { addToBasket, viewOf } from '@/lib/basket';
import { ipOf, limited } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

const STARTED = ['home', 'product', 'link', 'panel', 'reorder', 'basket'];

/** Put a product in the basket. The browser says what the customer chose; the server works out the price. */
export async function POST(req: Request) {
  if (limited(`basket:${ipOf(req)}`, 60)) return NextResponse.json({ error: 'Too many changes. Wait a moment.' }, { status: 429 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b.slug !== 'string') return NextResponse.json({ error: 'Missing product.' }, { status: 400 });
  const r = await addToBasket({
    slug: b.slug,
    quantity: Number(b.quantity),
    config: typeof b.config === 'object' && b.config ? b.config : {},
    sizeKey: typeof b.sizeKey === 'string' ? b.sizeKey : undefined,
    widthFt: b.widthFt ? Number(b.widthFt) : undefined,
    heightFt: b.heightFt ? Number(b.heightFt) : undefined,
    area: typeof b.area === 'string' && b.area ? b.area : null,
    pickup: b.pickup != null ? !!b.pickup : undefined,
    needBy: typeof b.needBy === 'string' && b.needBy ? b.needBy : null,
  }, STARTED.includes(b.startedFrom) ? b.startedFrom : 'product');
  if ('error' in r) return NextResponse.json(r, { status: 422 });
  try { return NextResponse.json({ ...r, view: await viewOf(r.orderId) }); } catch { return NextResponse.json(r); }
}
