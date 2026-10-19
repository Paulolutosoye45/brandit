import { NextResponse } from 'next/server';
import { saveArtwork } from '@/lib/artwork';
import { assetBuffer } from '@/lib/brandKit';
import { getCustomer } from '@/lib/session';
import { ipOf, limited } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Use a file from the signed-in customer's brand kit as the artwork. It goes through exactly the same checks as an upload. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (limited(`kitasset:${ipOf(req)}`, 30)) return NextResponse.json({ ok: false, error: 'Too many tries. Wait a moment.' }, { status: 429 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ ok: false, error: 'Order not found.' }, { status: 404 });
  const me = await getCustomer();
  if (!me) return NextResponse.json({ ok: false, error: 'Sign in to use your brand kit.' }, { status: 401 });
  const b = await req.json().catch(() => null);
  const file = await assetBuffer(me.id, String(b?.assetId ?? ''));
  if (!file) return NextResponse.json({ ok: false, error: 'We could not find that file in your brand kit.' }, { status: 404 });
  const r = await saveArtwork(id, file, typeof b?.itemId === 'string' && /^[0-9a-f-]{36}$/.test(b.itemId) ? b.itemId : null);
  return NextResponse.json(r, { status: r.ok ? 200 : 422 });
}
