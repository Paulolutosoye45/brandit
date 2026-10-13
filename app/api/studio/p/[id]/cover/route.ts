import { NextResponse } from 'next/server';
import { getFile } from '@/lib/storage';
import { getCustomer } from '@/lib/session';
import { one } from '@/lib/db';
import { STUDIO_ID } from '@/lib/studio/route';

export const dynamic = 'force-dynamic';

/** The picture shown on a design's card in "My designs": the approved version, else the newest finished one. Owner only. */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!STUDIO_ID.test(id)) return new NextResponse('Not found', { status: 404 });
  const me = await getCustomer().catch(() => null);
  if (!me) return new NextResponse('Not found', { status: 404 });
  const row = await one<{ preview_key: string | null }>(
    `select v.preview_key from studio_projects p join studio_versions v on v.project_id = p.id
     where p.id = $1 and p.customer_id = $2 and p.status <> 'purged' and v.status = 'ready' and v.preview_key is not null
     order by (v.id = p.approved_version_id) desc, v.ready_at desc limit 1`,
    [id, me.id],
  );
  if (!row?.preview_key) return new NextResponse('Not found', { status: 404 });
  const buf = await getFile(row.preview_key).catch(() => null);
  if (!buf) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' } });
}
