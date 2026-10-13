import { NextResponse } from 'next/server';
import { saveArtwork, saveSimpleFile } from '@/lib/artwork';
import { getItem, getOrder } from '@/lib/orders';
import { ipOf, limited } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (limited(`upload:${ipOf(req)}`, 40)) return NextResponse.json({ ok: false, error: 'Too many uploads. Wait a moment.' }, { status: 429 });
  if (!/^[0-9a-f-]{36}$/.test(params.id)) return NextResponse.json({ ok: false, error: 'Order not found.' }, { status: 404 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ ok: false, error: 'Choose a file to upload.' }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  const url = new URL(req.url);

  if (url.searchParams.get('as') === 'reference') {
    // Logos and examples for the design brief. Stored on the order, not used as the print file.
    const o = await getOrder(params.id);
    const item = o && (await getItem(params.id));
    if (!o || !item || !['draft', 'awaiting_payment'].includes(o.status)) return NextResponse.json({ ok: false, error: 'Order not found.' }, { status: 404 });
    const r = await saveSimpleFile(params.id, item.id, 'artwork', { name: file.name, type: file.type, buf });
    return NextResponse.json(r, { status: r.ok ? 200 : 422 });
  }

  const r = await saveArtwork(params.id, { name: file.name, type: file.type, buf });
  return NextResponse.json(r, { status: r.ok ? 200 : 422 });
}
