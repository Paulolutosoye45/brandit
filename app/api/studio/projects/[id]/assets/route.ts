import { addAsset, removeAsset } from '@/lib/studio/projects';
import { bad, customerOr401, good, jsonBody, openOr403, STUDIO_ID } from '@/lib/studio/route';
import { assetView } from '@/lib/studio/view';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Add the customer's photo or logo. It is cleaned of hidden phone data, checked, and kept only for the retention period. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!STUDIO_ID.test(id)) return bad('Not found', 404);
  const who = await customerOr401(req, 'upload', 30, 10 * 60_000);
  if ('res' in who) return who.res;
  const closed = await openOr403(who.c);
  if (closed) return closed;
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const kind = String(form?.get('kind') ?? '');
  if (kind !== 'photo' && kind !== 'logo') return bad('Choose whether this is a photo or a logo.');
  if (!(file instanceof File) || file.size === 0) return bad('Choose a picture first.');
  const r = await addAsset(who.c, id, kind, { name: file.name || kind, buf: Buffer.from(await file.arrayBuffer()) });
  if (!r.ok) return bad(r.error, r.code === 'blocked' ? 422 : 422, { code: r.code });
  return good({ asset: assetView(r.asset), palette: r.palette ?? null });
}

export async function DELETE(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!STUDIO_ID.test(id)) return bad('Not found', 404);
  const who = await customerOr401(req, 'upload', 60);
  if ('res' in who) return who.res;
  const b = await jsonBody(req);
  const kind = String(b?.kind ?? '');
  if (kind !== 'photo' && kind !== 'logo') return bad('Choose whether this is a photo or a logo.');
  return (await removeAsset(who.c, id, kind)) ? good() : bad('We could not remove that picture.');
}
