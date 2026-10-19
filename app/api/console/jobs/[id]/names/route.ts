import { NextResponse } from 'next/server';
import { getStaff } from '@/lib/session';
import { can } from '@/lib/permissions';
import { one } from '@/lib/db';
import { namesCsv, type NameRow } from '@/lib/nameListCore';

export const dynamic = 'force-dynamic';

/** The list of names on one job, as a spreadsheet for whoever prints it. Only staff who work on files or presses can download it. */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const staff = await getStaff().catch(() => null);
  if (!staff || !(can(staff.role, 'file_review') || can(staff.role, 'scan_print') || can(staff.role, 'dispatch'))) return new NextResponse('Not found', { status: 404 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse('Not found', { status: 404 });
  const j = await one<{ code: string; names: NameRow[] | null; press_id: string | null }>(
    'select o.code, i.names, j.press_id from jobs j join orders o on o.id = j.order_id join order_items i on i.id = j.order_item_id where j.id = $1', [id]);
  if (!j || !j.names?.length) return new NextResponse('Not found', { status: 404 });
  if (staff.role === 'partner_press' && j.press_id !== staff.press_id) return new NextResponse('Not found', { status: 404 });
  return new NextResponse('﻿' + namesCsv(j.names), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${j.code}-names.csv"`,
      'cache-control': 'private, no-store',
    },
  });
}
