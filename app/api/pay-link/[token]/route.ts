import { NextResponse } from 'next/server';
import { startPayLinkPayment } from '@/lib/payLink';
import { ipOf, limited } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/** Whoever opened a pay link starts paying. Only a name and an email are asked; everything else was decided by the customer. */
export async function POST(req: Request, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (limited(`paylink:${ipOf(req)}`, 20)) return NextResponse.json({ error: 'Too many tries. Wait a moment.' }, { status: 429 });
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 400 });
  const r = await startPayLinkPayment(token, { name: String(b.name ?? ''), email: String(b.email ?? '') });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ url: r.url });
}
