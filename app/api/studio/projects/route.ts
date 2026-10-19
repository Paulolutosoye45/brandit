import { createProject } from '@/lib/studio/projects';
import { linkStarted, lineForStudio } from '@/lib/studio/inOrder';
import { bad, customerOr401, good, jsonBody } from '@/lib/studio/route';

export const dynamic = 'force-dynamic';

/** Start a design: the product, the size and the occasion. Everything else is filled in on the design page. */
export async function POST(req: Request) {
  const who = await customerOr401(req, 'create', 30);
  if ('res' in who) return who.res;
  const b = await jsonBody(req);
  if (!b) return bad('Something went wrong. Try again.');
  let input = {
    productSlug: String(b.productSlug ?? ''),
    sizeKey: b.sizeKey ? String(b.sizeKey) : null,
    widthFt: b.widthFt != null && b.widthFt !== '' ? Number(b.widthFt) : null,
    heightFt: b.heightFt != null && b.heightFt !== '' ? Number(b.heightFt) : null,
    quantity: b.quantity ? Number(b.quantity) : undefined,
    config: b.config && typeof b.config === 'object' ? b.config : undefined,
    occasion: b.occasion ? String(b.occasion) : undefined,
    orderId: b.orderId ? String(b.orderId) : null,
  };
  // Started from a line in the basket: that line's own choices are the truth, not anything the browser sent.
  const itemId = typeof b.itemId === 'string' && /^[0-9a-f-]{36}$/.test(b.itemId) ? b.itemId : null;
  if (itemId && input.orderId) {
    const line = await lineForStudio(who.c.id, input.orderId, itemId);
    if (!line) return bad('We could not find that line in your basket. Go back to your basket and try again.', 404);
    input = { ...input, productSlug: line.slug, sizeKey: line.sizeKey, widthFt: line.widthFt, heightFt: line.heightFt, quantity: line.quantity, config: line.config };
  }
  const r = await createProject(who.c, input);
  if (!r.ok) return bad(r.error, r.code === 'off' || r.code === 'invite' || r.code === 'paused' ? 403 : 422, { code: r.code, field: r.field });
  if (itemId && r.project.order_id) await linkStarted(r.project.id, itemId);
  return good({ id: r.project.id, next: `/studio/p/${r.project.id}` });
}
