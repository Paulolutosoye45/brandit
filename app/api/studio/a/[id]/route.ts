import { NextResponse } from 'next/server';
import { one } from '@/lib/db';
import { getFile } from '@/lib/storage';
import { getCustomer, getStaff } from '@/lib/session';
import { can } from '@/lib/permissions';
import { STUDIO_ID } from '@/lib/studio/route';

export const dynamic = 'force-dynamic';

/** The small copy of a photo or logo the customer added. Only its owner, or staff checking the design, can open it. */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!STUDIO_ID.test(id)) return new NextResponse('Not found', { status: 404 });
  const a = await one<{ customer_id: string; preview_key: string | null }>('select customer_id, preview_key from studio_assets where id = $1', [id]);
  if (!a?.preview_key) return new NextResponse('Not found', { status: 404 });
  const me = await getCustomer().catch(() => null);
  let ok = !!me && me.id === a.customer_id;
  if (!ok) {
    const staff = await getStaff().catch(() => null);
    ok = !!staff && (can(staff.role, 'review_studio') || can(staff.role, 'manage_studio'));
  }
  if (!ok) return new NextResponse('Not found', { status: 404 });
  const buf = await getFile(a.preview_key).catch(() => null);
  if (!buf) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
