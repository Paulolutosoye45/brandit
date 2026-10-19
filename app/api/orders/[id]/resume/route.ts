import { NextResponse } from 'next/server';
import { one, query } from '@/lib/db';
import { ipOf, limited } from '@/lib/ratelimit';
import { naira } from '@/lib/money';

export const dynamic = 'force-dynamic';

/** Is this order still waiting for its owner, and where do they pick it up? Used by the "continue your order" bar. */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (limited(`resume:${ipOf(req)}`, 60)) return NextResponse.json({ open: false }, { status: 429 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ open: false });
  const o = await one<any>('select o.status, o.subtotal_kobo, o.custom_request_id from orders o where o.id = $1', [id]);
  if (!o || !['draft', 'awaiting_payment'].includes(o.status) || o.custom_request_id) return NextResponse.json({ open: false });
  const lines = await query<any>(
    `select i.quantity, i.artwork_path, i.studio_tier, i.preview_approved_at, i.artwork_file_id, p.name from order_items i join products p on p.id = i.product_id where i.order_id = $1 order by i.position, i.id`, [id]);
  if (lines.length === 0) return NextResponse.json({ open: false });
  const ready = lines.every((l) => l.artwork_path === 'design' || (l.artwork_path === 'studio' && l.studio_tier) || (l.artwork_path === 'upload' && l.preview_approved_at));
  const first = lines[0];
  return NextResponse.json({
    open: true,
    title: lines.length > 1 ? `${lines.length} products in your basket` : `${first.quantity > 1 ? `${first.quantity.toLocaleString('en-US')} × ` : ''}${first.name}`,
    price: naira(o.subtotal_kobo),
    next: lines.length > 1 ? '/basket' : ready ? `/checkout/${id}` : '/basket',
  });
}
