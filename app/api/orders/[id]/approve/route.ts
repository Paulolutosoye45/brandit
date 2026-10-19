import { NextResponse } from 'next/server';
import { approveLine, getOrder } from '@/lib/orders';

export const dynamic = 'force-dynamic';

/** The customer confirms: "this is what will print." The time is stored on the line they approved. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const b = await req.json().catch(() => null);
  const itemId = typeof b?.itemId === 'string' && /^[0-9a-f-]{36}$/.test(b.itemId) ? b.itemId : new URL(req.url).searchParams.get('item');
  const r = await approveLine(params.id, itemId && /^[0-9a-f-]{36}$/.test(itemId) ? itemId : null);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const o = (await getOrder(params.id))!;
  return NextResponse.json({ ok: true, itemId: r.itemId, next: o.paid_at ? `/track/${o.public_token}` : `/checkout/${o.id}` });
}
