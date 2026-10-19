import { NextResponse } from 'next/server';
import { runDeepHealth } from '@/lib/deepHealth';
import { isDemo } from '@/lib/db';
import { cleanEmail, isEmail } from '@/lib/otp';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * "Can the site do its job?" Closed to the public: it needs the same CRON_SECRET as the scheduler. Safe to call often:
 * the default checks change nothing. ?full=1 starts one unpaid N100 Paystack payment; ?full=1&email=you@x.ng sends one real email.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  const ok = secret ? req.headers.get('authorization') === `Bearer ${secret}` : isDemo();
  if (!ok) return new NextResponse('Unauthorized', { status: 401 });
  const u = new URL(req.url);
  const email = cleanEmail(u.searchParams.get('email') ?? '');
  const r = await runDeepHealth({ full: u.searchParams.get('full') === '1', email: isEmail(email) ? email : undefined });
  return NextResponse.json({ ...r, time: new Date().toISOString() }, { status: r.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
export const GET = handle;
