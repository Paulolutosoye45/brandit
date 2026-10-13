import { NextResponse } from 'next/server';
import { one } from '@/lib/db';
import { getFile } from '@/lib/storage';
import { getCustomer, getStaff } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getProject, getProjectByShare, getVersion } from '@/lib/studio/projects';
import { STUDIO_ID } from '@/lib/studio/route';
import { ipOf, limited } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

const nf = () => new NextResponse('Not found', { status: 404 });

/**
 * A picture or file from a design, always decided by who is asking:
 *  - the owner can open the preview of any design, and the print file, PDF and vector file of designs they have unlocked;
 *  - a person with the share link can open the preview of the one design that was shared, and nothing else;
 *  - Brandit staff who check designs can open everything for the design they are checking.
 * Free sketches are only ever served as the small watermarked preview. The raw picture from the image company is never served.
 */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!STUDIO_ID.test(id)) return nf();
  if (limited(`studio:img:${ipOf(req)}`, 600, 60_000)) return new NextResponse('Slow down', { status: 429 });
  const url = new URL(req.url);
  const k = url.searchParams.get('k') ?? 'preview';
  const share = url.searchParams.get('s');
  const v = await getVersion(id);
  if (!v) return nf();
  const p = await getProject(v.project_id);
  if (!p || p.status === 'purged') return nf();

  let role: 'owner' | 'share' | 'staff' | null = null;
  const me = await getCustomer().catch(() => null);
  if (me && me.id === p.customer_id) role = 'owner';
  if (!role && share) {
    const sp = await getProjectByShare(share);
    if (sp && sp.id === p.id && sp.shared_version_id === v.id) role = 'share';
  }
  if (!role) {
    const staff = await getStaff().catch(() => null);
    if (staff && (can(staff.role, 'review_studio') || can(staff.role, 'manage_studio'))) role = 'staff';
  }
  if (!role) return nf();

  let key: string | null = null, mime = 'image/webp', name = 'design';
  if (k === 'preview') {
    if (v.status !== 'ready') return nf();
    key = v.preview_key;
  } else if (role === 'share') {
    return nf();
  } else if (k === 'final' || k === 'pdf') {
    if (v.kind === 'sketch' || v.finish_status !== 'done') return nf();
    key = k === 'final' ? v.final_key : v.pdf_key;
    mime = k === 'final' ? (v.final_mime ?? 'image/png') : 'application/pdf';
    name = `brandit-studio-${p.id.slice(0, 8)}-${v.id.slice(0, 4)}.${k === 'pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg'}`;
  } else if (k === 'svg') {
    if (v.kind === 'sketch' || !v.svg_key) return nf();
    if (role === 'owner') {
      let ok = p.tier === 'premium';
      if (!ok && p.tier === 'standard' && p.vector_paid) {
        const paid = await one<{ raw: any }>("select raw from studio_purchases where project_id = $1 and sku = 'vector' and status = 'paid' order by created_at desc limit 1", [p.id]);
        ok = paid?.raw?.versionId === v.id;
      }
      if (!ok) return nf();
    }
    key = v.svg_key;
    mime = 'image/svg+xml';
    name = `brandit-studio-${p.id.slice(0, 8)}-${v.id.slice(0, 4)}.svg`;
  } else return nf();
  if (!key) return nf();
  const buf = await getFile(key).catch(() => null);
  if (!buf) return nf();
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
  };
  if (k !== 'preview' || url.searchParams.get('dl')) headers['Content-Disposition'] = `${url.searchParams.get('inline') ? 'inline' : 'attachment'}; filename="${name}"`;
  return new NextResponse(new Uint8Array(buf), { headers });
}
