import { NextResponse } from 'next/server';
import { one } from '@/lib/db';
import { ipOf, limited } from '@/lib/ratelimit';
import { naira } from '@/lib/money';

export const dynamic = 'force-dynamic';

/** Is this order still waiting for its owner, and where do they pick it up? Used by the "continue your order" bar. */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (limited(`resume:${ipOf(req)}`, 60)) return NextResponse.json({ open: false }, { status: 429 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ open: false });
  const o = await one<any>(
    `select o.status, o.subtotal_kobo, o.custom_request_id, i.quantity, i.artwork_path, i.preview_approved_at, p.name
     from orders o join order_items i on i.order_id = o.id join products p on p.id = i.product_id where o.id = $1`,
    [id],
  );
  if (!o || !['draft', 'awaiting_payment'].includes(o.status) || o.custom_request_id) return NextResponse.json({ open: false });
  const ready = o.artwork_path === 'design' || (o.artwork_path === 'upload' && o.preview_approved_at);
  return NextResponse.json({
    open: true,
    title: `${o.quantity > 1 ? `${o.quantity.toLocaleString('en-US')} × ` : ''}${o.name}`,
    price: naira(o.subtotal_kobo),
    next: ready ? `/checkout/${id}` : `/order/${id}/artwork`,
  });
}
