import { NextResponse } from 'next/server';
import { createDraft } from '@/lib/orders';
import { ipOf, limited } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (limited(`draft:${ipOf(req)}`, 30)) return NextResponse.json({ error: 'Too many orders started. Wait a moment.' }, { status: 429 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b.slug !== 'string') return NextResponse.json({ error: 'Missing product.' }, { status: 400 });
  const r = await createDraft({
    slug: b.slug,
    quantity: Number(b.quantity),
    config: typeof b.config === 'object' && b.config ? b.config : {},
    sizeKey: typeof b.sizeKey === 'string' ? b.sizeKey : undefined,
    widthFt: b.widthFt ? Number(b.widthFt) : undefined,
    heightFt: b.heightFt ? Number(b.heightFt) : undefined,
    area: typeof b.area === 'string' ? b.area : null,
    pickup: !!b.pickup,
    needBy: typeof b.needBy === 'string' && b.needBy ? b.needBy : null,
  });
  if ('error' in r) return NextResponse.json(r, { status: 422 });
  return NextResponse.json(r);
}
