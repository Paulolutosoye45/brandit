import { NextResponse } from 'next/server';
import { readReviewPhoto } from '@/lib/reviewPhotos';
import { getStaff } from '@/lib/session';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse('Not found', { status: 404 });
  const size = new URL(req.url).searchParams.get('size') === 'full' ? 'full' : 'thumb';
  const staff = await getStaff().catch(() => null);
  const p = await readReviewPhoto(id, size, !!staff && can(staff.role, 'moderate_photos'));
  if (!p) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(new Uint8Array(p.buf), { headers: { 'Content-Type': p.mime, 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
}
