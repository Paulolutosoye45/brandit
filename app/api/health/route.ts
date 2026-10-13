import { NextResponse } from 'next/server';
import { query, isDemo } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** For load balancers and uptime monitors. Says whether the site and its database are up. Reveals nothing private. */
export async function GET() {
  try {
    await query('select 1');
    return NextResponse.json({ ok: true, db: 'up', mode: isDemo() ? 'demo' : 'live', time: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, db: 'down' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
