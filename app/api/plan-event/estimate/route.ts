import { NextResponse } from 'next/server';
import { estimatePlan } from '@/lib/eventPlan';
import { ipOf, limited } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/** A rough print price for the items on the plan. Public and cheap, but still rate-limited. */
export async function POST(req: Request) {
  if (limited(`planq:${ipOf(req)}`, 90, 60_000)) return NextResponse.json({ ok: false }, { status: 429 });
  const body = await req.json().catch(() => null);
  const items = Array.isArray(body?.items) ? body.items.slice(0, 12).map((i: any) => ({ key: String(i?.key ?? ''), qty: Number(i?.qty) })) : [];
  return NextResponse.json({ ok: true, ...(await estimatePlan(items)) });
}
