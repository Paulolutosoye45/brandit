import { NextResponse } from 'next/server';
import { query, isDemo } from '@/lib/db';
import { dbHint, isStaging } from '@/lib/envcheck';
import { reportError } from '@/lib/errorReport';
import { siteAlert, watchDatabase } from '@/lib/siteAlert';

export const dynamic = 'force-dynamic';

/**
 * For load balancers, uptime monitors and the site owner. Says whether the site and its database are up and, when the
 * database is down, what to do in plain words. It never shows an address, a password or a raw error message.
 */
export async function GET() {
  try {
    await query('select 1');
    if (watchDatabase(true) === 'recovered') void siteAlert({ key: 'database-back', what: 'The Brandit database is answering again. Orders and payments are working.', repeatMinutes: 5 });
    return NextResponse.json({ ok: true, db: 'up', mode: isDemo() ? 'demo' : 'live', site: isStaging(process.env) ? 'staging' : 'production', build: (process.env.RENDER_GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || undefined, time: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    void reportError(e, { routePath: '/api/health', path: '/api/health', method: 'GET' });
    // Only after two minutes of failing, so a one-second blip does not wake anyone. Not in demo mode, where there is nobody to wake.
    if (watchDatabase(false) === 'down' && !isDemo()) void siteAlert({ key: 'database', what: 'The Brandit database is not answering, so the site cannot take orders or payments. Open the Render dashboard, then the brandit-db page, to see if it is restarting.', error: e });
    const problem = dbHint(e) ?? 'The database did not open. The server log (on Vercel: Logs, search "brandit") has the details.';
    return NextResponse.json({ ok: false, db: 'down', problem }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
