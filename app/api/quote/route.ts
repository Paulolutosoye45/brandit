import { NextResponse } from 'next/server';
import { makeQuote } from '@/lib/quote';
import { publicQuote } from '@/lib/publicQuote';
import { ipOf, limited } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (limited(`quote:${ipOf(req)}`, 120)) return NextResponse.json({ ok: false, message: 'Too many requests. Wait a moment.' }, { status: 429 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b.slug !== 'string') return NextResponse.json({ ok: false, message: 'Missing product.' }, { status: 400 });
  const q = await makeQuote({
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
  return NextResponse.json(q.ok ? publicQuote(q) : q);
}
