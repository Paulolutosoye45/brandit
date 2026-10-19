import { NextResponse } from 'next/server';
import { kitOwnerId, readAsset } from '@/lib/brandKit';
import { getCustomer, getStaff } from '@/lib/session';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/** A brand-kit file. Only its owner, or staff who work on files and proofs, can open it. */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse('Not found', { status: 404 });
  const size = new URL(req.url).searchParams.get('size') === 'thumb' ? 'thumb' : 'full';
  const a = await readAsset(id, size);
  if (!a) return new NextResponse('Not found', { status: 404 });
  const me = await getCustomer().catch(() => null);
  // The owner, and anyone who joined the owner's company.
  let ok = !!me && (me.id === a.owner || (await kitOwnerId(me.id)) === a.owner);
  if (!ok) {
    const staff = await getStaff().catch(() => null);
    ok = !!staff && (can(staff.role, 'file_review') || can(staff.role, 'send_proof'));
  }
  if (!ok) return new NextResponse('Not found', { status: 404 });
  const safe = a.title.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'file';
  return new NextResponse(new Uint8Array(a.buf), {
    headers: {
      'Content-Type': a.mime,
      'Content-Disposition': `inline; filename="${safe}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
