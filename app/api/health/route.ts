import { NextResponse } from 'next/server';
import { query, isDemo } from '@/lib/db';
import { dbHint } from '@/lib/envcheck';

export const dynamic = 'force-dynamic';

/**
 * For load balancers, uptime monitors and the site owner. Says whether the site and its database are up and, when the
 * database is down, what to do in plain words. It never shows an address, a password or a raw error message.
 */
export async function GET() {
  try {
    await query('select 1');
    return NextResponse.json({ ok: true, db: 'up', mode: isDemo() ? 'demo' : 'live', time: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const problem = dbHint(e) ?? 'The database did not open. The server log (on Vercel: Logs, search "brandit") has the details.';
    return NextResponse.json({ ok: false, db: 'down', problem }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
