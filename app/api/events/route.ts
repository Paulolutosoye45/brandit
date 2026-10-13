import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ipOf, limited } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
const ALLOWED = ['product_view', 'campaign_view', 'template_view', 'plan_view'];

export async function POST(req: Request) {
  if (limited(`ev:${ipOf(req)}`, 60)) return NextResponse.json({ ok: false }, { status: 429 });
  const b = await req.json().catch(() => null);
  if (b && ALLOWED.includes(b.name)) await query('insert into events (name, props) values ($1, $2)', [b.name, JSON.stringify({ slug: String(b.slug ?? '').slice(0, 60) })]);
  return NextResponse.json({ ok: true });
}
