import { NextResponse } from 'next/server';
import { addBleedToLine, undoBleedOnLine } from '@/lib/artwork';
import { ipOf, limited } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Add the 3 mm extra edge to the file on a line, or put the customer's own file back. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (limited(`bleed:${ipOf(req)}`, 30)) return NextResponse.json({ ok: false, error: 'Too many tries. Wait a moment.' }, { status: 429 });
  if (!/^[0-9a-f-]{36}$/.test(params.id)) return NextResponse.json({ ok: false, error: 'Order not found.' }, { status: 404 });
  const b = await req.json().catch(() => null);
  const itemId = typeof b?.itemId === 'string' && /^[0-9a-f-]{36}$/.test(b.itemId) ? b.itemId : null;
  if (!itemId) return NextResponse.json({ ok: false, error: 'Order not found.' }, { status: 404 });
  const r = b?.undo === true ? await undoBleedOnLine(params.id, itemId) : await addBleedToLine(params.id, itemId);
  return NextResponse.json(r, { status: r.ok ? 200 : r.status });
}
