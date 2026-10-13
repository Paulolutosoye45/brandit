import { NextResponse } from 'next/server';
import { runScheduledSweep } from '@/lib/scheduler';
import { isDemo } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  const ok = secret ? req.headers.get('authorization') === `Bearer ${secret}` : isDemo();
  if (!ok) return new NextResponse('Unauthorized', { status: 401 });
  return NextResponse.json(await runScheduledSweep());
}
export const GET = handle;
export const POST = handle;
