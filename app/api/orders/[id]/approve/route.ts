import { NextResponse } from 'next/server';
import { one, query } from '@/lib/db';
import { getItem, getOrder } from '@/lib/orders';

export const dynamic = 'force-dynamic';

/** The customer confirms: "this is what will print." The time is stored on the order item. */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const o = await getOrder(params.id);
  const item = o && (await getItem(params.id));
  if (!o || !item) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  const job = await one('select stage from jobs where order_id = $1', [o.id]);
  const open = ['draft', 'awaiting_payment'].includes(o.status) || job?.stage === 'file_check';
  if (!open) return NextResponse.json({ error: 'This order is already in production.' }, { status: 409 });
  if (!item.artwork_file_id) return NextResponse.json({ error: 'Upload a file first.' }, { status: 400 });
  const f = await one('select check_result from files where id = $1', [item.artwork_file_id]);
  if (f?.check_result?.status === 'stop') return NextResponse.json({ error: 'That file needs fixing before we can print it.' }, { status: 400 });
  await query('update order_items set preview_approved_at = now() where id = $1', [item.id]);
  return NextResponse.json({ ok: true, next: o.paid_at ? `/track/${o.public_token}` : `/checkout/${o.id}` });
}
