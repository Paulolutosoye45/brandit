import { query, one } from './db';
import { getSettings } from './settings';
import { getProductById } from './catalog';
import { inspectBuffer } from './inspect';
import { checkArtwork, recommendSize, ALLOWED_MIME, BLEED_IN, type CheckResult } from './accuracy';
import { addBleed, ImageError } from './imageTools';
import { printDims } from './quote';
import { putFile, extFor, getFile } from './storage';
import { getItem, getOrder, recomputeOrder } from './orders';
import { noteReupload } from './jobs';
import type { Product, SizeOption } from './types';

/** Cut-and-trim print: cards, flyers and the like. Garments, frames, banners and ID cards have their own rules. */
export const takesBleed = (p: Pick<Product, 'pricing_mode' | 'check_class' | 'slug'>) => p.pricing_mode === 'tier' && p.check_class === 'print' && p.slug !== 'id-cards';
const bleedOf = (f: { fix_note?: string | null }) => { const m = /^bleed:([\d.]+)$/.exec(f.fix_note ?? ''); return m ? Number(m[1]) : undefined; };

export type UploadKind = 'artwork' | 'proof' | 'qc_photo' | 'claim_photo' | 'review_photo';

export type ArtworkOutcome =
  | { ok: false; error: string }
  | { ok: true; fileId: string; check: CheckResult; widthPx: number | null; heightPx: number | null; suggestion: SizeOption | null; attached: boolean };

/** Store a file and, for artwork, run the accuracy check and attach it to the order when it is usable. */
export async function saveArtwork(orderId: string, f: { name: string; type: string; buf: Buffer }, itemId?: string | null): Promise<ArtworkOutcome> {
  const order = await getOrder(orderId);
  const item = order && (await getItem(orderId, itemId));
  if (!order || !item) return { ok: false, error: 'We could not find that order.' };
  const job = await one('select stage from jobs where order_item_id = $1', [item.id]);
  const open = ['draft', 'awaiting_payment'].includes(order.status) || (job && job.stage === 'file_check');
  if (!open) return { ok: false, error: 'This order is already in production. Message us if the file needs to change.' };
  if (item.artwork_path === 'studio' && !['draft', 'awaiting_payment'].includes(order.status)) {
    return { ok: false, error: 'This line is being made in Brandit Studio. Your design goes on the order as soon as you approve it. Message us if you would like to use your own file instead.' };
  }
  const product = await getProductById(item.product_id);
  if (!product) return { ok: false, error: 'Product not found.' };

  const s = await getSettings();
  const maxBytes = s.max_upload_mb * 1_000_000;
  if (f.buf.length > maxBytes) return { ok: false, error: `This file is larger than ${s.max_upload_mb} MB. Export a smaller copy and upload that.` };
  const facts = await inspectBuffer(f.buf, f.type);
  const dims = printDims(product, item.size_key, item.width_ft, item.height_ft, item.config);
  const check = checkArtwork({ facts, printWIn: dims?.w ?? 1, printHIn: dims?.h ?? 1, cls: product.check_class, thresholds: s.check_thresholds, maxBytes, bleedOffer: takesBleed(product) && !!dims });

  let suggestion: SizeOption | null = null;
  if (product.slug === 'picture-frames' && facts.widthPx && facts.heightPx) {
    suggestion = recommendSize(product.sizes, facts.widthPx, facts.heightPx, s.check_thresholds.photo.pass) ?? recommendSize(product.sizes, facts.widthPx, facts.heightPx, s.check_thresholds.photo.warn);
  }

  if (!ALLOWED_MIME.includes(facts.mime)) return { ok: true, fileId: '', check, widthPx: null, heightPx: null, suggestion, attached: false };

  const key = await putFile(f.buf, extFor(facts.mime));
  const row = await one<{ id: string }>(
    `insert into files (order_id, order_item_id, kind, storage_key, original_name, mime, bytes, width_px, height_px, check_result)
     values ($1,$2,'artwork',$3,$4,$5,$6,$7,$8,$9) returning id`,
    [orderId, item.id, key, f.name.slice(0, 200), facts.mime, f.buf.length, facts.widthPx ?? null, facts.heightPx ?? null, JSON.stringify(check)],
  );
  const attached = check.status !== 'stop';
  if (attached) {
    await query("update order_items set artwork_file_id = $2, artwork_path = 'upload', preview_approved_at = null, studio_tier = null, studio_fee_kobo = 0, studio_project_id = null where id = $1", [item.id, row!.id]);
    if (item.artwork_path === 'studio') await recomputeOrder(orderId);
    await query("insert into events (name, props) values ('upload_passed', $1)", [JSON.stringify({ order: order.code, status: check.status })]);
    if (!['draft', 'awaiting_payment'].includes(order.status)) await noteReupload(orderId, item.id);
  }
  return { ok: true, fileId: row!.id, check, widthPx: facts.widthPx ?? null, heightPx: facts.heightPx ?? null, suggestion, attached };
}

/** Staff and customer photos (proofs, finished-job photos, problem photos). Images and PDFs only. */
export async function saveSimpleFile(orderId: string, itemId: string | null, kind: UploadKind, f: { name: string; type: string; buf: Buffer }): Promise<{ ok: true; fileId: string } | { ok: false; error: string }> {
  const facts = await inspectBuffer(f.buf, f.type);
  if (!ALLOWED_MIME.includes(facts.mime)) return { ok: false, error: 'Please use a JPG, PNG or PDF file.' };
  if (f.buf.length > 25_000_000) return { ok: false, error: 'That file is larger than 25 MB.' };
  const key = await putFile(f.buf, extFor(facts.mime));
  const row = await one<{ id: string }>(
    'insert into files (order_id, order_item_id, kind, storage_key, original_name, mime, bytes, width_px, height_px) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id',
    [orderId, itemId, kind, key, f.name.slice(0, 200), facts.mime, f.buf.length, facts.widthPx ?? null, facts.heightPx ?? null],
  );
  return { ok: true, fileId: row!.id };
}

/**
 * The size or choices changed after a file was uploaded, so the same file is checked again against the new print size.
 * A file that no longer passes is taken off the line, and the customer is asked for another.
 */
export async function recheckArtwork(orderId: string, itemId: string): Promise<CheckResult | null> {
  const item = await getItem(orderId, itemId);
  if (!item?.artwork_file_id) return null;
  const file = await one<any>('select * from files where id = $1', [item.artwork_file_id]);
  const product = await getProductById(item.product_id);
  if (!file || !product || file.storage_key === 'deleted.bin') return null;
  const s = await getSettings();
  let buf: Buffer;
  try { buf = await getFile(file.storage_key); } catch { return null; }
  const facts = await inspectBuffer(buf, file.mime);
  const dims = printDims(product, item.size_key, item.width_ft, item.height_ft, item.config);
  const bleedIn = bleedOf(file);
  const check = checkArtwork({ facts, printWIn: dims?.w ?? 1, printHIn: dims?.h ?? 1, cls: product.check_class, thresholds: s.check_thresholds, maxBytes: s.max_upload_mb * 1_000_000, bleedOffer: takesBleed(product) && !!dims && !bleedIn, bleedIn });
  await query('update files set check_result = $2 where id = $1', [file.id, JSON.stringify(check)]);
  if (check.status === 'stop') await query('update order_items set artwork_file_id = null, preview_approved_at = null where id = $1', [item.id]);
  return check;
}

export type BleedOutcome =
  | { ok: true; fileId: string; beforeFileId: string | null; check: CheckResult; widthPx: number | null; heightPx: number | null }
  | { ok: false; error: string; status: number };

/** A line whose artwork can still be changed: not yet paid, or paid and waiting at the file desk. */
async function editableLine(orderId: string, itemId: string) {
  const order = await getOrder(orderId);
  const item = order && (await getItem(orderId, itemId));
  if (!order || !item) return null;
  const job = await one<{ stage: string }>('select stage from jobs where order_item_id = $1', [item.id]);
  const open = ['draft', 'awaiting_payment'].includes(order.status) || job?.stage === 'file_check';
  return { order, item, open };
}

/**
 * "Add the extra edge for me": the customer's file stays as it is, and a copy with a 3 mm mirrored edge becomes the line's artwork.
 * The old file is remembered on the new one, so the customer can see both and go back.
 */
export async function addBleedToLine(orderId: string, itemId: string): Promise<BleedOutcome> {
  const x = await editableLine(orderId, itemId);
  if (!x) return { ok: false, error: 'We could not find that order.', status: 404 };
  if (!x.open) return { ok: false, error: 'This order is already in production. Message us if the file needs to change.', status: 409 };
  const { item } = x;
  if (item.artwork_path !== 'upload' || !item.artwork_file_id) return { ok: false, error: 'Upload your file first.', status: 422 };
  const file = await one<any>('select * from files where id = $1', [item.artwork_file_id]);
  const product = await getProductById(item.product_id);
  if (!file || !product || file.storage_key === 'deleted.bin') return { ok: false, error: 'We could not find your file.', status: 404 };
  if (bleedOf(file)) return { ok: false, error: 'This file already has the extra edge.', status: 409 };
  const dims = printDims(product, item.size_key, item.width_ft, item.height_ft, item.config);
  if (!takesBleed(product) || !dims) return { ok: false, error: 'This product does not need an extra edge.', status: 422 };
  if (!['image/jpeg', 'image/png'].includes(file.mime)) return { ok: false, error: 'We can add the extra edge to JPG and PNG files. For a PDF, a person checks the edges before printing.', status: 422 };

  const s = await getSettings();
  let bled;
  try { bled = await addBleed(await getFile(file.storage_key), { trimWIn: dims.w, trimHIn: dims.h, bleedIn: BLEED_IN }); }
  catch (e) { return { ok: false, error: e instanceof ImageError ? e.message : 'We could not add the extra edge. Please try again.', status: 422 }; }
  const facts = await inspectBuffer(bled.buf, bled.mime);
  const check = checkArtwork({ facts, printWIn: dims.w, printHIn: dims.h, cls: product.check_class, thresholds: s.check_thresholds, maxBytes: s.max_upload_mb * 1_000_000, bleedIn: BLEED_IN });
  if (check.status === 'stop') return { ok: false, error: check.headline, status: 422 };
  const key = await putFile(bled.buf, extFor(bled.mime));
  const row = await one<{ id: string }>(
    `insert into files (order_id, order_item_id, kind, storage_key, original_name, mime, bytes, width_px, height_px, check_result, original_file_id, fix_note)
     values ($1,$2,'artwork',$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [orderId, item.id, key, String(file.original_name ?? 'artwork').slice(0, 190), bled.mime, bled.buf.length, bled.widthPx, bled.heightPx, JSON.stringify(check), file.id, `bleed:${BLEED_IN}`],
  );
  // The customer looks at the new file and approves it again. A paid order goes back to the desk with a note.
  await query("update order_items set artwork_file_id = $2, preview_approved_at = null where id = $1", [item.id, row!.id]);
  await query("insert into events (name, props) values ('bleed_added', $1)", [JSON.stringify({ order: x.order.code })]);
  if (!['draft', 'awaiting_payment'].includes(x.order.status)) await noteReupload(orderId, item.id);
  return { ok: true, fileId: row!.id, beforeFileId: file.id, check, widthPx: bled.widthPx, heightPx: bled.heightPx };
}

/** Go back to the file the customer uploaded. The copy with the extra edge is cleared away with the next clean-up. */
export async function undoBleedOnLine(orderId: string, itemId: string): Promise<BleedOutcome> {
  const x = await editableLine(orderId, itemId);
  if (!x) return { ok: false, error: 'We could not find that order.', status: 404 };
  if (!x.open) return { ok: false, error: 'This order is already in production. Message us if the file needs to change.', status: 409 };
  const cur = x.item.artwork_file_id ? await one<any>('select * from files where id = $1', [x.item.artwork_file_id]) : null;
  if (!cur?.original_file_id || !bleedOf(cur)) return { ok: false, error: 'There is nothing to undo.', status: 409 };
  const orig = await one<any>('select * from files where id = $1 and order_item_id = $2', [cur.original_file_id, x.item.id]);
  if (!orig || orig.storage_key === 'deleted.bin') return { ok: false, error: 'We could not find your original file. Please upload it again.', status: 404 };
  await query('update order_items set artwork_file_id = $2, preview_approved_at = null where id = $1', [x.item.id, orig.id]);
  await query('update files set delete_after = now() where id = $1', [cur.id]);
  if (!['draft', 'awaiting_payment'].includes(x.order.status)) await noteReupload(orderId, x.item.id);
  const check = await recheckArtwork(orderId, x.item.id);
  return { ok: true, fileId: orig.id, beforeFileId: null, check: check ?? (orig.check_result as CheckResult), widthPx: orig.width_px ?? null, heightPx: orig.height_px ?? null };
}
