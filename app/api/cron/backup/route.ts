import { NextResponse } from 'next/server';
import { runBackupIfDue } from '@/lib/backup';
import { isDemo } from '@/lib/db';

export const dynamic = 'force-dynamic';
// A backup of a growing shop can take a while. Hosts that allow it get the full five minutes.
export const maxDuration = 300;

/** For hosts that call a web address on a schedule (Vercel cron, cron-job.org). Servers that stay running do this by themselves. */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  const ok = secret ? req.headers.get('authorization') === `Bearer ${secret}` : isDemo();
  if (!ok) return new NextResponse('Unauthorized', { status: 401 });
  return NextResponse.json(await runBackupIfDue());
}
export const GET = handle;
export const POST = handle;
