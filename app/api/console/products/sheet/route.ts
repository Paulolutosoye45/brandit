import { NextResponse } from 'next/server';
import { getStaff } from '@/lib/session';
import { can } from '@/lib/permissions';
import { buildSheet, applySheet } from '@/lib/priceSheet';
import { ProductError } from '@/lib/productAdmin';
import { readXlsx, looksLikeXlsx, XlsxError } from '@/lib/xlsxRead';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function allowed() {
  const staff = await getStaff();
  return staff && can(staff.role, 'manage_catalog') ? staff : null;
}

/** The price sheet as a CSV file: every price and add-on, with a column for what each costs. */
export async function GET(req: Request) {
  if (!(await allowed())) return NextResponse.json({ ok: false, error: 'Sign in again to download the price sheet.' }, { status: 403 });
  const slug = new URL(req.url).searchParams.get('product') ?? undefined;
  const { csv } = await buildSheet(slug && /^[a-z0-9-]{1,60}$/.test(slug) ? slug : undefined);
  const stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="brandit-price-sheet${slug ? `-${slug}` : ''}-${stamp}.csv"`,
      'cache-control': 'no-store',
    },
  });
}

/** Upload a filled-in sheet. `mode=check` says what it would change and saves nothing; `mode=apply` saves it. */
export async function POST(req: Request) {
  const staff = await allowed();
  if (!staff) return NextResponse.json({ ok: false, problems: ['Sign in again to upload the price sheet.'] }, { status: 403 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, problems: ['The file did not arrive in one piece. Try again.'] }, { status: 400 });
  }
  const file = form.get('file');
  if (!file || typeof file === 'string' || file.size === 0) return NextResponse.json({ ok: false, problems: ['Choose the price sheet file first.'] }, { status: 400 });
  if (file.size > 2_000_000) return NextResponse.json({ ok: false, problems: ['That file is too big to be a price sheet.'] }, { status: 413 });
  const buf = Buffer.from(await file.arrayBuffer());
  const apply = form.get('mode') === 'apply';
  try {
    // An Excel workbook is read as it is; anything else is read as CSV text.
    const input = looksLikeXlsx(buf) ? readXlsx(buf) : buf.toString('utf8');
    const r = await applySheet(input, { id: staff.id, name: staff.name }, { dryRun: !apply });
    if (r.applied) {
      revalidatePath('/console/products', 'layout');
      revalidatePath('/products', 'layout');
      revalidatePath('/');
    }
    return NextResponse.json(r, { status: r.ok ? 200 : 422 });
  } catch (e) {
    if (e instanceof ProductError || e instanceof XlsxError) return NextResponse.json({ ok: false, problems: [e.message] }, { status: 422 });
    throw e;
  }
}
