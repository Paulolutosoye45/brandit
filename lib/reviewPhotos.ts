import { query, one } from './db';
import { putFile, deleteFile, getFile } from './storage';
import { processImage, ImageError } from './imageTools';

/*
 * Photo reviews. A customer may add a photo of the finished job to a review. It is private to us until a person looks at it
 * and approves it, and it is shown on the website only if the customer also agreed to that, and staff picked the review.
 * Every photo is re-saved by us as a new picture, which removes the location and camera details a phone puts inside it.
 */
export class ReviewError extends Error {}

export const MAX_REVIEW_PHOTO_MB = 8;
export const PENDING_DAYS = 60;

export type ReviewInput = {
  token: string; rating: unknown; body?: unknown; publicOk?: boolean; photoOk?: boolean;
  photo?: { name: string; buf: Buffer } | null;
};
export type ReviewResult = { ok: true; hasPhoto: boolean } | { ok: false; error: string; field?: string };

export async function submitReview(i: ReviewInput): Promise<ReviewResult> {
  const o = await one<{ id: string; status: string }>('select id, status from orders where public_token = $1', [i.token]);
  if (!o) return { ok: false, error: 'We could not find that order.' };
  if (o.status !== 'delivered') return { ok: false, error: 'You can review an order once it has been delivered.' };
  const rating = Math.trunc(Number(i.rating));
  if (!(rating >= 1 && rating <= 5)) return { ok: false, error: 'Choose a rating from 1 to 5.', field: 'rating' };
  const body = typeof i.body === 'string' ? i.body.replace(/\r\n/g, '\n').trim().slice(0, 1000) || null : null;
  if (await one('select 1 as x from reviews where order_id = $1', [o.id])) return { ok: false, error: 'You have already reviewed this order. Thank you!' };

  // The photo is checked and re-saved before anything is stored, so a bad file never costs the customer their review.
  let keys: { full: string; thumb: string } | null = null;
  if (i.photo && i.photo.buf.length > 0) {
    if (i.photo.buf.length > MAX_REVIEW_PHOTO_MB * 1_000_000) return { ok: false, error: `That photo is larger than ${MAX_REVIEW_PHOTO_MB} MB. Choose a smaller one.`, field: 'photo' };
    try {
      const p = await processImage(i.photo.buf, i.photo.name, { fullMax: 1600, thumbMax: 480, minSide: 200, maxBytes: MAX_REVIEW_PHOTO_MB * 1_000_000 });
      keys = { full: await putFile(p.full, 'webp'), thumb: await putFile(p.thumb, 'webp') };
    } catch (e) {
      return { ok: false, error: e instanceof ImageError ? e.message : 'We could not read that photo. Try a JPG or PNG.', field: 'photo' };
    }
  }
  const saved = await query(
    `insert into reviews (order_id, rating, body, public_ok, photo_public_ok, photo_status, photo_key, photo_thumb_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (order_id) do nothing returning id`,
    [o.id, rating, body, !!i.publicOk && !!body, !!i.photoOk && !!keys, keys ? 'pending' : 'none', keys?.full ?? null, keys?.thumb ?? null],
  );
  if (!saved.length && keys) { await deleteFile(keys.full).catch(() => {}); await deleteFile(keys.thumb).catch(() => {}); }
  return { ok: true, hasPhoto: !!keys && saved.length > 0 };
}

export type PendingPhoto = { id: string; rating: number; body: string | null; code: string; product: string; created_at: string; photo_public_ok: boolean };
export async function pendingPhotos(): Promise<PendingPhoto[]> {
  return query<PendingPhoto>(
    `select r.id, r.rating, r.body, o.code, r.created_at, r.photo_public_ok,
            coalesce((select coalesce(i.label, p.name) from order_items i join products p on p.id = i.product_id where i.order_id = o.id order by i.id limit 1), '') as product
       from reviews r join orders o on o.id = r.order_id where r.photo_status = 'pending' order by r.created_at limit 50`,
  );
}

export async function moderatePhoto(reviewId: string, staffId: string, decision: 'approve' | 'reject'): Promise<void> {
  const r = await one<{ photo_key: string | null; photo_thumb_key: string | null; photo_status: string }>('select photo_key, photo_thumb_key, photo_status from reviews where id = $1', [reviewId]);
  if (!r || r.photo_status !== 'pending') throw new ReviewError('That photo has already been checked.');
  if (decision === 'approve') {
    await query("update reviews set photo_status = 'approved', photo_moderated_at = now(), photo_moderated_by = $2 where id = $1", [reviewId, staffId]);
    return;
  }
  // A photo we do not use is not kept.
  await query("update reviews set photo_status = 'rejected', photo_key = null, photo_thumb_key = null, photo_public_ok = false, photo_moderated_at = now(), photo_moderated_by = $2 where id = $1", [reviewId, staffId]);
  for (const k of new Set([r.photo_key, r.photo_thumb_key])) if (k) await deleteFile(k).catch(() => {});
}

/** Who may see a review photo: everyone if it is approved, agreed to, and picked for the website; staff who moderate, always; the others never. */
export async function readReviewPhoto(id: string, size: 'thumb' | 'full', staff: boolean) {
  const r = await one<{ photo_status: string; photo_public_ok: boolean; featured: boolean; public_ok: boolean; photo_key: string | null; photo_thumb_key: string | null }>(
    'select photo_status, photo_public_ok, featured, public_ok, photo_key, photo_thumb_key from reviews where id = $1', [id]);
  if (!r?.photo_key) return null;
  const isPublic = r.photo_status === 'approved' && r.photo_public_ok && r.featured && r.public_ok;
  if (!isPublic && !staff) return null;
  try { return { buf: await getFile(size === 'thumb' && r.photo_thumb_key ? r.photo_thumb_key : r.photo_key), mime: 'image/webp' }; } catch { return null; }
}

/** Photos nobody checked within two months are removed, and the review stays without them. */
export async function cleanupReviewPhotos(now = new Date()): Promise<number> {
  const old = await query<{ id: string; photo_key: string | null; photo_thumb_key: string | null }>(
    "select id, photo_key, photo_thumb_key from reviews where photo_status = 'pending' and created_at < $1",
    [new Date(now.getTime() - PENDING_DAYS * 86_400_000).toISOString()],
  );
  for (const r of old) {
    await query("update reviews set photo_status = 'rejected', photo_key = null, photo_thumb_key = null, photo_public_ok = false where id = $1", [r.id]);
    for (const k of new Set([r.photo_key, r.photo_thumb_key])) if (k) await deleteFile(k).catch(() => {});
  }
  return old.length;
}

/** Remove a customer's review photos when they delete their account. */
export async function eraseReviewPhotosFor(customerId: string): Promise<string[]> {
  const rows = await query<{ id: string; photo_key: string | null; photo_thumb_key: string | null }>(
    'select r.id, r.photo_key, r.photo_thumb_key from reviews r join orders o on o.id = r.order_id where o.customer_id = $1 and (r.photo_key is not null or r.photo_thumb_key is not null)', [customerId]);
  const keys: string[] = [];
  for (const r of rows) {
    await query("update reviews set photo_status = 'none', photo_key = null, photo_thumb_key = null, photo_public_ok = false where id = $1", [r.id]);
    for (const k of [r.photo_key, r.photo_thumb_key]) if (k) keys.push(k);
  }
  return keys;
}
