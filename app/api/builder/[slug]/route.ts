import { NextResponse } from 'next/server';
import { builderData } from '@/lib/builderData';
import { ipOf, limited } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/** What the Order Builder needs for one product, for the panel that opens on the home page and from the header. */
export async function GET(req: Request, props: { params: Promise<{ slug: string }> }) {
  if (limited(`builder:${ipOf(req)}`, 120)) return NextResponse.json({ error: 'Too many requests. Wait a moment.' }, { status: 429 });
  const { slug } = await props.params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const lineId = new URL(req.url).searchParams.get('line');
  const d = await builderData(slug, { lineId: lineId && /^[0-9a-f-]{36}$/.test(lineId) ? lineId : null });
  if (!d) return NextResponse.json({ error: 'We could not find that product.' }, { status: 404 });
  return NextResponse.json(d, { headers: { 'Cache-Control': 'no-store' } });
}
