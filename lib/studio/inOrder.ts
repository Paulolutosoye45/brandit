import { one, query } from '../db';
import type { Customer } from '../identity';
import { getFile, putFile } from '../storage';
import { addLine, getItems, getOrder, isOpen, recomputeOrder } from '../orders';
import type { Tier } from './config';
import { STUDIO_WAIT, studioFeeKobo } from './fees';
import { audit, getProject, getVersion, ownProject, readyToOrder, type Fail, type Ok } from './projects';
import { applyPurchase, checkPurchase, type Purchase } from './purchases';
import type { Spec } from './specs';

/*
 * Studio inside the order.
 *
 * A line in the basket can be made by Brandit Studio. The design fee is part of the order's one payment. What the customer
 * pays for the design is Studio's price for the tier less the print credit Studio gives, so the credit is taken off up front
 * and nobody has to carry a code around. After payment Studio starts making the designs. The print line waits until the customer
 * approves one (and a Brandit designer has checked it, on Premium), then the approved print file is put on the line and the
 * file desk takes over, exactly as for an uploaded file.
 */
export { STUDIO_WAIT, studioFeeKobo };

export type StudioLine = { itemId: string; orderId: string; orderCode: string; orderStatus: string; tier: Tier | null; feeKobo: number };

/** The line of an order that this design is for. */
export async function lineOf(projectId: string): Promise<StudioLine | null> {
  const r = await one<{ item_id: string; order_id: string; code: string; status: string; tier: Tier | null; fee: number }>(
    `select i.id as item_id, o.id as order_id, o.code, o.status, i.studio_tier as tier, i.studio_fee_kobo as fee
       from order_items i join orders o on o.id = i.order_id
      where i.studio_project_id = $1 order by o.created_at desc limit 1`,
    [projectId],
  );
  return r ? { itemId: r.item_id, orderId: r.order_id, orderCode: r.code, orderStatus: r.status, tier: r.tier, feeKobo: r.fee } : null;
}

/** A line of an unpaid order that belongs to this customer (or to nobody yet), described the way a new design needs it. */
export async function lineForStudio(customerId: string, orderId: string, itemId: string) {
  const o = await getOrder(orderId);
  if (!o || !isOpen(o) || o.custom_request_id || (o.customer_id && o.customer_id !== customerId)) return null;
  const i = await one<{ id: string; slug: string; size_key: string | null; width_ft: number | null; height_ft: number | null; quantity: number; config: Record<string, string> }>(
    'select i.id, p.slug, i.size_key, i.width_ft, i.height_ft, i.quantity, i.config from order_items i join products p on p.id = i.product_id where i.id = $1 and i.order_id = $2',
    [itemId, orderId],
  );
  return i ? { slug: i.slug, sizeKey: i.size_key, widthFt: i.width_ft, heightFt: i.height_ft, quantity: i.quantity, config: i.config ?? {} } : null;
}

/** Link a design that was started from a line to that line. The line's own choices are the truth, never the browser's. */
export async function linkStarted(projectId: string, itemId: string): Promise<void> {
  await query("update order_items set artwork_path = 'studio', studio_project_id = $2, studio_tier = null, studio_fee_kobo = 0, design_brief = null, artwork_file_id = null, preview_approved_at = null where id = $1", [itemId, projectId]);
}

/** The customer chose Standard or Premium for this design: it becomes part of the order and the order's price changes. */
export async function addToOrder(c: Pick<Customer, 'id' | 'phone' | 'email'>, projectId: string, tier: Tier): Promise<Ok<{ orderId: string; next: string; feeKobo: number }> | Fail> {
  const p = await ownProject(c, projectId);
  if (!p) return { ok: false, error: 'We could not find that design.' };
  if (!p.order_id) return { ok: false, error: 'This design is not part of an order.' };
  const o = await getOrder(p.order_id);
  if (!o || !isOpen(o)) return { ok: false, error: 'That order has been paid or closed, so it cannot change.' };
  if (o.customer_id && o.customer_id !== c.id) return { ok: false, error: 'We could not find that design.' };
  const chk = await checkPurchase(c as Customer, { sku: tier, projectId });
  if (!chk.ok) return chk;

  // The line this design is for. Started from the builder it is already linked; otherwise take the matching line, or make one.
  let itemId = (await lineOf(projectId))?.itemId ?? null;
  if (!itemId) {
    const items = await getItems(o.id);
    const prod = await one<{ id: string }>('select id from products where slug = $1', [p.product_slug]);
    const match = items.find((i) => i.product_id === prod?.id && !i.studio_project_id && (i.size_key ?? null) === (p.size_key ?? null) && i.artwork_path !== 'upload');
    if (match) itemId = match.id;
    else {
      const a = await addLine(o.id, { slug: p.product_slug, quantity: p.quantity, config: p.config ?? {}, sizeKey: p.size_key ?? undefined, widthFt: p.width_ft ?? undefined, heightFt: p.height_ft ?? undefined });
      if ('error' in a) return { ok: false, error: a.error };
      itemId = a.itemId;
    }
  }
  await query("update order_items set artwork_path = 'studio', studio_project_id = $2, studio_tier = $3, design_brief = null, artwork_file_id = null, preview_approved_at = null where id = $1", [itemId, projectId, tier]);
  const r = await recomputeOrder(o.id);
  if (!r.ok) return { ok: false, error: r.error };
  const fee = (await one<{ f: number }>('select studio_fee_kobo as f from order_items where id = $1', [itemId]))?.f ?? 0;
  await audit(projectId, `customer:${c.id}`, 'added_to_order', { order: o.code, tier, fee });
  return { ok: true, orderId: o.id, next: '/basket', feeKobo: fee };
}

/** Take the design out of the order again. The free sketches stay in My designs. */
export async function removeFromOrder(c: Pick<Customer, 'id'>, projectId: string): Promise<Ok<{ orderId: string }> | Fail> {
  const p = await ownProject(c, projectId);
  if (!p) return { ok: false, error: 'We could not find that design.' };
  const ln = await lineOf(projectId);
  if (!ln) return { ok: true, orderId: p.order_id ?? '' };
  const o = await getOrder(ln.orderId);
  if (!o || !isOpen(o)) return { ok: false, error: 'That order has been paid, so the design cannot be taken out.' };
  await query("update order_items set artwork_path = null, studio_tier = null, studio_fee_kobo = 0, studio_project_id = null where id = $1", [ln.itemId]);
  const r = await recomputeOrder(o.id);
  if (!r.ok) return { ok: false, error: r.error };
  await audit(projectId, `customer:${c.id}`, 'removed_from_order', { order: o.code });
  return { ok: true, orderId: o.id };
}

/** Before anyone pays: is every Studio line still something Studio can make? Returns the first problem in words. */
export async function studioProblem(orderId: string, c: Pick<Customer, 'id' | 'phone' | 'email'> | null): Promise<string | null> {
  const lines = await query<{ id: string; studio_project_id: string | null; studio_tier: Tier | null }>("select id, studio_project_id, studio_tier from order_items where order_id = $1 and artwork_path = 'studio'", [orderId]);
  for (const l of lines) {
    if (!l.studio_project_id || !l.studio_tier) return 'Choose Standard or Premium for your Studio design, or pick another way to give us your artwork.';
    if (!c) return 'Sign in to pay for a Studio design.';
    const chk = await checkPurchase(c as Customer, { sku: l.studio_tier, projectId: l.studio_project_id });
    if (!chk.ok) return chk.error;
  }
  return null;
}

/** After payment: unlock each Studio design that was paid for inside the order and start making it. Safe to run again. */
export async function applyStudioLines(orderId: string): Promise<number> {
  const o = await getOrder(orderId);
  if (!o || !['paid', 'in_production'].includes(o.status)) return 0;
  const lines = await query<{ id: string; studio_project_id: string; studio_tier: Tier; studio_fee_kobo: number }>(
    "select id, studio_project_id, studio_tier, studio_fee_kobo from order_items where order_id = $1 and artwork_path = 'studio' and studio_project_id is not null and studio_tier is not null",
    [orderId],
  );
  let n = 0;
  for (const l of lines) {
    const p = await getProject(l.studio_project_id);
    if (!p) continue;
    const ref = `ORD-${o.code}-${l.id.slice(0, 8)}`;
    // The purchase row is the receipt for the design part of this order's payment. The money moved in the order's own payment.
    await query(
      `insert into studio_purchases (customer_id, project_id, sku, amount_kobo, provider_ref, status, method, verified_at, order_id)
       values ($1,$2,$3,$4,$5,'paid','order', now(), $6) on conflict (provider_ref) do nothing`,
      [p.customer_id, p.id, l.studio_tier, l.studio_fee_kobo, ref, orderId],
    );
    const row = await one<Purchase>('select * from studio_purchases where provider_ref = $1', [ref]);
    if (!row) continue;
    await applyPurchase(row, { fromOrder: true });
    await query('update orders set studio_project_id = coalesce(studio_project_id, $2) where id = $1', [orderId, p.id]);
    await query(
      "update jobs set clock_paused = true, paused_reason = $2, paused_at = coalesce(paused_at, now()), updated_at = now() where order_item_id = $1 and stage = 'file_check' and not clock_paused",
      [l.id, STUDIO_WAIT],
    );
    n++;
  }
  return n;
}

/**
 * Studio could not make a design that was paid for inside an order and the design fee went back. The print line must not stay
 * stuck: it becomes an ordinary line that needs the customer's own file, and the customer is told in the line's own words.
 */
export async function releasePaidLine(projectId: string): Promise<boolean> {
  const line = await one<{ id: string; order_id: string }>(
    `select i.id, i.order_id from order_items i join orders o on o.id = i.order_id
      where i.studio_project_id = $1 and i.artwork_path = 'studio' and o.status in ('paid','in_production')`,
    [projectId],
  );
  if (!line) return false;
  await query("update order_items set artwork_path = null, artwork_file_id = null, studio_tier = null, studio_fee_kobo = 0, studio_project_id = null, preview_approved_at = null where id = $1", [line.id]);
  await query(
    "update jobs set clock_paused = true, paused_reason = $2, paused_at = coalesce(paused_at, now()), updated_at = now() where order_item_id = $1 and stage = 'file_check'",
    [line.id, 'Brandit Studio could not make your design, so we refunded the design fee. Please upload your own file or ask a Brandit designer to make it, and we will print it.'],
  );
  await audit(projectId, 'system', 'released_from_order', { order: line.order_id, item: line.id });
  return true;
}

export type AttachResult = 'attached' | 'no_line' | 'not_ready' | 'missing_file';

/** The customer approved a design (and a person checked it, where that applies): put the print file on the paid line and release it to the file desk. */
export async function attachApproved(projectId: string): Promise<AttachResult> {
  const line = await one<{ id: string; order_id: string; status: string }>(
    `select i.id, i.order_id, o.status from order_items i join orders o on o.id = i.order_id
      where i.studio_project_id = $1 and i.artwork_path = 'studio' and o.status in ('paid','in_production') order by o.created_at desc limit 1`,
    [projectId],
  );
  if (!line) return 'no_line';
  const p = await getProject(projectId);
  if (!p) return 'no_line';
  const ready = await readyToOrder(p);
  if (!ready.ok) return 'not_ready';
  const v = p.approved_version_id ? await getVersion(p.approved_version_id) : null;
  if (!v || !v.final_key || !v.sha256 || !v.spec || v.sha256 !== p.approved_sha256) return 'missing_file';
  const file = await getFile(v.final_key).catch(() => null);
  if (!file) return 'missing_file';
  const ext = v.final_mime === 'image/png' ? 'png' : 'jpg';
  const key = await putFile(file, ext);
  const f = await one<{ id: string }>(
    `insert into files (order_id, order_item_id, kind, storage_key, original_name, mime, bytes, width_px, height_px, check_result)
     values ($1,$2,'artwork',$3,$4,$5,$6,$7,$8,$9) returning id`,
    [line.order_id, line.id, key, `studio-${p.id.slice(0, 8)}.${ext}`, v.final_mime, file.length, v.final_w, v.final_h, JSON.stringify(v.check_result ?? {})],
  );
  // Claim the line once: a second caller finds nothing left to attach.
  const claimed = await one<{ id: string }>(
    "update order_items set artwork_path = 'upload', artwork_file_id = $2, preview_approved_at = now(), studio_version_id = $3 where id = $1 and artwork_path = 'studio' returning id",
    [line.id, f!.id, v.id],
  );
  if (!claimed) return 'no_line';
  const spec = v.spec as Spec;
  void spec;
  await query(
    "update jobs set clock_paused = false, paused_reason = null, paused_at = null, updated_at = now() where order_item_id = $1 and stage = 'file_check'",
    [line.id],
  );
  const job = await one<{ id: string }>('select id from jobs where order_item_id = $1', [line.id]);
  if (job) await query("insert into job_events (job_id, from_stage, to_stage, note) values ($1,'file_check','file_check','Studio design approved. The file is ready for the file desk.')", [job.id]);
  await audit(projectId, 'system', 'attached_to_order', { order: line.order_id, item: line.id, sha256: v.sha256 });
  return 'attached';
}

/** Run by the sweep: finish any paid Studio line whose unlock or hand-over did not happen the first time. */
export async function sweepStudioLines(limit = 25): Promise<{ unlocked: number; attached: number }> {
  const out = { unlocked: 0, attached: 0 };
  const unpaid = await query<{ order_id: string }>(
    `select distinct i.order_id from order_items i join orders o on o.id = i.order_id join studio_projects p on p.id = i.studio_project_id
      where i.artwork_path = 'studio' and i.studio_tier is not null and o.status in ('paid','in_production') and p.tier is null limit $1`,
    [limit],
  );
  for (const r of unpaid) { try { out.unlocked += await applyStudioLines(r.order_id); } catch (e) { console.error(`[brandit] studio line unlock failed: ${(e as Error)?.message ?? e}`); } }
  const waiting = await query<{ project_id: string }>(
    `select distinct i.studio_project_id as project_id from order_items i join orders o on o.id = i.order_id join studio_projects p on p.id = i.studio_project_id
      where i.artwork_path = 'studio' and o.status in ('paid','in_production') and p.status = 'approved' limit $1`,
    [limit],
  );
  for (const r of waiting) { try { if ((await attachApproved(r.project_id)) === 'attached') out.attached++; } catch (e) { console.error(`[brandit] studio attach failed: ${(e as Error)?.message ?? e}`); } }
  return out;
}
