import { NextResponse } from 'next/server';
import { getCustomer } from '@/lib/session';
import { exportData } from '@/lib/privacy';

export const dynamic = 'force-dynamic';

export async function GET() {
  const c = await getCustomer();
  if (!c) return new NextResponse('Sign in to download your data.', { status: 401 });
  const data = await exportData(c.id);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="brandit-my-data.json"', 'Cache-Control': 'no-store' },
  });
}
