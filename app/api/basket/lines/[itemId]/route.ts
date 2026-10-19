import { NextResponse } from 'next/server';
import { currentBasket, viewOf } from '@/lib/basket';
import { getItem, removeLine, setDelivery, updateLine } from '@/lib/orders';
import { recheckArtwork } from '@/lib/artwork';
import { ipOf, limited } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

async function mine(itemId: string) {
  if (!/^[0-9a-f-]{36}$/.test(itemId)) return null;
  const b = await currentBasket();
  if (!b) return null;
  const item = await getItem(b.id, itemId);
  return item ? { basket: b, item } : null;
}

/** Change the amount or the choices on one line. If the size changed, the file is checked again at the new size. */
export async function PATCH(req: Request, props: { params: Promise<{ itemId: string }> }) {
  if (limited(`basket:${ipOf(req)}`, 120)) return NextResponse.json({ error: 'Too many changes. Wait a moment.' }, { status: 429 });
  const { itemId } = await props.params;
  const m = await mine(itemId);
  if (!m) return NextResponse.json({ error: 'We could not find that product in your basket.' }, { status: 404 });
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 400 });
  const r = await updateLine(m.basket.id, itemId, {
    quantity: b.quantity != null ? Number(b.quantity) : undefined,
    config: typeof b.config === 'object' && b.config ? b.config : undefined,
    sizeKey: typeof b.sizeKey === 'string' ? b.sizeKey : b.sizeKey === null ? null : undefined,
    widthFt: b.widthFt != null ? Number(b.widthFt) : undefined,
    heightFt: b.heightFt != null ? Number(b.heightFt) : undefined,
  });
  if ('error' in r) return NextResponse.json(r, { status: 422 });
  if (b.area !== undefined || b.pickup !== undefined) {
    const d = await setDelivery(m.basket.id, { area: typeof b.area === 'string' ? b.area : b.area === null ? null : undefined, pickup: b.pickup != null ? !!b.pickup : undefined });
    if ('error' in d) return NextResponse.json(d, { status: 422 });
  }
  const check = r.reset ? await recheckArtwork(m.basket.id, itemId) : null;
  return NextResponse.json({ ok: true, reset: r.reset, check, view: await viewOf(m.basket.id) });
}

export async function DELETE(req: Request, props: { params: Promise<{ itemId: string }> }) {
  if (limited(`basket:${ipOf(req)}`, 120)) return NextResponse.json({ error: 'Too many changes. Wait a moment.' }, { status: 429 });
  const { itemId } = await props.params;
  const m = await mine(itemId);
  if (!m) return NextResponse.json({ error: 'We could not find that product in your basket.' }, { status: 404 });
  const r = await removeLine(m.basket.id, itemId);
  if ('error' in r) return NextResponse.json(r, { status: 422 });
  return NextResponse.json({ ok: true, left: r.left, view: await viewOf(m.basket.id) });
}
