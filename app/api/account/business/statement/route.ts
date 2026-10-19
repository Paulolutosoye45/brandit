import { NextResponse } from 'next/server';
import { getCustomer } from '@/lib/session';
import { lastMonth, statementCsv, statementFor } from '@/lib/businessAccounts';

export const dynamic = 'force-dynamic';

/** The monthly statement as a CSV file. Only the owner of the company account can download it. */
export async function GET(req: Request) {
  const me = await getCustomer().catch(() => null);
  if (!me) return new NextResponse('Sign in first.', { status: 401 });
  const q = new URL(req.url).searchParams.get('month') ?? '';
  const month = /^\d{4}-\d{2}$/.test(q) ? q : lastMonth();
  const s = await statementFor(me.id, month);
  if (!s) return new NextResponse('Not found', { status: 404 });
  const safe = s.business.replace(/[^\w-]+/g, '_').slice(0, 40) || 'company';
  // The byte-order mark makes Excel read the naira-free text as UTF-8.
  return new NextResponse('﻿' + statementCsv(s), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="brandit-${safe}-${s.month}.csv"`, 'Cache-Control': 'private, no-store' },
  });
}
