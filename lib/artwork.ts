import { query, one } from './db';
import { getSettings } from './settings';
import { getProductById } from './catalog';
import { inspectBuffer } from './inspect';
import { checkArtwork, recommendSize, ALLOWED_MIME, type CheckResult } from './accuracy';
import { printDims } from './quote';
import { putFile, extFor } from './storage';
import { getItem, getOrder } from './orders';
import { noteReupload } from './jobs';
import type { SizeOption } from './types';

export type UploadKind = 'artwork' | 'proof' | 'qc_photo' | 'claim_photo' | 'review_photo';

export type ArtworkOutcome =
  | { ok: false; error: string }
  | { ok: true; fileId: string; check: CheckResult; widthPx: number | null; heightPx: number | null; suggestion: SizeOption | null; attached: boolean };

/** Store a file and, for artwork, run the accuracy check and attach it to the order when it is usable. */
export async function saveArtwork(orderId: string, f: { name: string; type: string; buf: Buffer }): Promise<ArtworkOutcome> {
  const order = await getOrder(orderId);
  const item = order && (await getItem(orderId));
  if (!order || !item) return { ok: false, error: 'We could not find that order.' };
  const job = await one('select stage from jobs where order_id = $1', [orderId]);
  const open = ['draft', 'awaiting_payment'].includes(order.status) || (job && job.stage === 'file_check');
  if (!open) return { ok: false, error: 'This order is already in production. Message us if the file needs to change.' };
  const product = await getProductById(item.product_id);
  if (!product) return { ok: false, error: 'Product not found.' };

  const s = await getSettings();
  const maxBytes = s.max_upload_mb * 1_000_000;
  if (f.buf.length > maxBytes) return { ok: false, error: `This file is larger than ${s.max_upload_mb} MB. Export a smaller copy and upload that.` };
  const facts = await inspectBuffer(f.buf, f.type);
  const dims = printDims(product, item.size_key, item.width_ft, item.height_ft);
  const check = checkArtwork({ facts, printWIn: dims?.w ?? 1, printHIn: dims?.h ?? 1, cls: product.check_class, thresholds: s.check_thresholds, maxBytes });

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
    await query("update order_items set artwork_file_id = $2, artwork_path = 'upload', preview_approved_at = null where id = $1", [item.id, row!.id]);
    await query("insert into events (name, props) values ('upload_passed', $1)", [JSON.stringify({ order: order.code, status: check.status })]);
    if (!['draft', 'awaiting_payment'].includes(order.status)) await noteReupload(orderId);
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
