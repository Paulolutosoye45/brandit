import { NextResponse } from 'next/server';
import { getStaff } from '@/lib/session';
import { can } from '@/lib/permissions';
import { customersCsv, exportRows, FILTERS, type CustomerFilter } from '@/lib/customers';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** The customer list as a spreadsheet. Only people allowed to export; every download is written to the activity log. */
export async function GET(req: Request) {
  const staff = await getStaff();
  if (!staff || !can(staff.role, 'export_customers')) return new NextResponse('Not allowed.', { status: 403 });
  const u = new URL(req.url);
  const f = (u.searchParams.get('f') ?? 'all') as CustomerFilter;
  const filter = FILTERS.some((x) => x.key === f) ? f : 'all';
  const q = (u.searchParams.get('q') ?? '').slice(0, 80);
  const rows = await exportRows({ q, filter });
  await audit({ id: staff.id, name: staff.name }, { area: 'customer', action: 'export', summary: `Downloaded the customer list (${rows.length} people, filter: ${filter}${q ? `, search: ${q}` : ''})` });
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(customersCsv(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="brandit-customers-${stamp}.csv"`, 'Cache-Control': 'no-store' } });
}
