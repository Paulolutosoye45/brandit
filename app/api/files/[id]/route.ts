import { NextResponse } from 'next/server';
import { one } from '@/lib/db';
import { getFile } from '@/lib/storage';
import { getStaff } from '@/lib/session';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/**
 * Files are private. You can open one if you are staff, or you hold the order's own link
 * (its tracking token, its order id, or a proof link). Partner presses see only their own jobs' files.
 */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(params.id)) return new NextResponse('Not found', { status: 404 });
  const f = await one<any>('select f.*, o.public_token, o.id as oid, cr.public_token as custom_token from files f left join orders o on o.id = f.order_id left join custom_requests cr on cr.id = f.custom_request_id where f.id = $1', [params.id]);
  if (!f || f.storage_key === 'deleted.bin') return new NextResponse('Not found', { status: 404 });

  const url = new URL(req.url);
  let allowed = false;
  const staff = await getStaff();
  if (staff) {
    if (staff.role === 'partner_press') {
      const j = await one('select press_id from jobs where order_id = $1', [f.order_id]);
      allowed = j?.press_id === staff.press_id;
    } else allowed = can(staff.role, 'file_review') || can(staff.role, 'dispatch') || can(staff.role, 'reply') || can(staff.role, 'claims') || can(staff.role, 'quote_custom');
  }
  const t = url.searchParams.get('t');
  const o = url.searchParams.get('o');
  const p = url.searchParams.get('p');
  if (!allowed && f.oid) {
    if (t && t === f.public_token) allowed = true;
    if (o && o === f.oid) allowed = true;
    if (p) {
      const pr = await one('select 1 as x from proofs where token = $1 and file_id = $2', [p, f.id]);
      if (pr) allowed = true;
    }
  }
  // A customer's own custom-order link opens the reference files they attached.
  const c = url.searchParams.get('c');
  if (!allowed && c && f.custom_token && c === f.custom_token) allowed = true;
  if (!allowed) return new NextResponse('Not found', { status: 404 });

  try {
    const buf = await getFile(f.storage_key);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': f.mime,
        'Content-Disposition': `inline; filename="${String(f.original_name ?? 'file').replace(/[^\w.\- ]/g, '_')}"`,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
