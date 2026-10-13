import { NextResponse } from 'next/server';
import { getTracker } from '@/lib/tracker';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const t = await getTracker(params.token);
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(t, { headers: { 'Cache-Control': 'no-store' } });
}
