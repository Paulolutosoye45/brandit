import { createProject } from '@/lib/studio/projects';
import { bad, customerOr401, good, jsonBody } from '@/lib/studio/route';

export const dynamic = 'force-dynamic';

/** Start a design: the product, the size and the occasion. Everything else is filled in on the design page. */
export async function POST(req: Request) {
  const who = await customerOr401(req, 'create', 30);
  if ('res' in who) return who.res;
  const b = await jsonBody(req);
  if (!b) return bad('Something went wrong. Try again.');
  const r = await createProject(who.c, {
    productSlug: String(b.productSlug ?? ''),
    sizeKey: b.sizeKey ? String(b.sizeKey) : null,
    widthFt: b.widthFt != null && b.widthFt !== '' ? Number(b.widthFt) : null,
    heightFt: b.heightFt != null && b.heightFt !== '' ? Number(b.heightFt) : null,
    quantity: b.quantity ? Number(b.quantity) : undefined,
    config: b.config && typeof b.config === 'object' ? b.config : undefined,
    occasion: b.occasion ? String(b.occasion) : undefined,
    orderId: b.orderId ? String(b.orderId) : null,
  });
  if (!r.ok) return bad(r.error, r.code === 'off' || r.code === 'invite' || r.code === 'paused' ? 403 : 422, { code: r.code, field: r.field });
  return good({ id: r.project.id, next: `/studio/p/${r.project.id}` });
}
