import { one, query } from '../db';
import { createDraft, recomputeOrder, getItem } from '../orders';
import { quantitySteps } from '../catalog';
import { snapQuantity } from '../eventPlanCore';
import { getFile, putFile } from '../storage';
import type { Customer } from '../identity';
import { audit, getProject, getVersion, ownProject, readyToOrder, type Fail, type Ok } from './projects';
import { ensureCredit, resumeCredit } from './purchases';
import type { Spec } from './specs';

/*
 * From an approved design to a normal Brandit order. The print file is copied so deleting the design later (after the
 * retention period) never touches an order, and the order records which design it came from and its hash, so the print
 * desk can see "made with Studio" and the exact file that was approved.
 */
const REASON: Record<string, string> = {
  not_approved: 'Approve the design first, then you can order it.',
  review_waiting: 'A Brandit designer is checking your design. We will message you as soon as it is ready to order.',
  review_changes: 'A Brandit designer left a note on your design. Open it, make the change and approve it again.',
};

export async function startOrder(c: Customer, projectId: string, o: { quantity?: number } = {}): Promise<Ok<{ orderId: string; next: string; creditCode: string | null; couponMessage?: string }> | Fail> {
  const p = await ownProject(c, projectId);
  if (!p) return { ok: false, error: 'We could not find that design.' };
  const ready = await readyToOrder(p);
  if (!ready.ok) return { ok: false, error: REASON[ready.reason] ?? 'This design cannot be ordered yet.', code: ready.reason };
  const v = p.approved_version_id ? await getVersion(p.approved_version_id) : null;
  if (!v || !v.final_key || !v.sha256 || !v.spec) return { ok: false, error: 'The approved print file is missing. Please contact us on the Help page.' };
  // The file that is about to be printed must still be the file that was approved.
  if (v.sha256 !== p.approved_sha256) return { ok: false, error: 'The approved file does not match the record. Please contact us on the Help page before ordering.', code: 'hash' };
  const spec = v.spec as Spec;
  const file = await getFile(v.final_key).catch(() => null);
  if (!file) return { ok: false, error: 'We could not read the approved print file. Please contact us on the Help page.' };

  let orderId: string | null = null;
  if (p.order_id) {
    const ex = await one<{ id: string; status: string; customer_id: string | null }>('select id, status, customer_id from orders where id = $1', [p.order_id]);
    const it = ex && (await getItem(ex.id));
    if (ex && ex.status === 'draft' && (!ex.customer_id || ex.customer_id === c.id) && it) {
      const prod = await one<{ slug: string }>('select slug from products where id = $1', [it.product_id]);
      if (prod?.slug === spec.slug && (it.size_key ?? null) === (spec.sizeKey ?? null)) orderId = ex.id;
    }
  }
  let qty = Math.max(1, Math.min(100000, Math.trunc(Number(o.quantity ?? p.quantity) || 1)));
  // Products priced by quantity only sell certain amounts (100, 250, 500…). Round up to the nearest one so the order always has a price.
  const prodRow = await one<{ id: string }>('select id from products where slug = $1', [spec.slug]);
  if (prodRow) {
    const steps = await quantitySteps(prodRow.id);
    if (steps.length) qty = snapQuantity(steps, qty) ?? Math.max(...steps);
  }
  if (!orderId) {
    const d = await createDraft({ slug: spec.slug, quantity: qty, config: p.product_slug === spec.slug ? p.config : {}, sizeKey: spec.sizeKey ?? undefined, widthFt: spec.widthFt ?? undefined, heightFt: spec.heightFt ?? undefined });
    if ('error' in d) return { ok: false, error: d.error };
    orderId = d.id;
  } else {
    await query('update order_items set quantity = $2 where order_id = $1', [orderId, qty]);
  }
  const item = (await getItem(orderId))!;
  const key = await putFile(file, v.final_mime === 'image/png' ? 'png' : 'jpg');
  const f = await one<{ id: string }>(
    `insert into files (order_id, order_item_id, kind, storage_key, original_name, mime, bytes, width_px, height_px, check_result)
     values ($1,$2,'artwork',$3,$4,$5,$6,$7,$8,$9) returning id`,
    [orderId, item.id, key, `studio-${p.id.slice(0, 8)}.${v.final_mime === 'image/png' ? 'png' : 'jpg'}`, v.final_mime, file.length, v.final_w, v.final_h, JSON.stringify(v.check_result ?? {})],
  );
  await query("update order_items set artwork_file_id = $2, artwork_path = 'upload', design_brief = null, preview_approved_at = now(), studio_version_id = $3 where id = $1", [item.id, f!.id, v.id]);
  await query('update orders set customer_id = $2, studio_project_id = $3 where id = $1', [orderId, c.id, p.id]);
  await query('update studio_projects set order_id = $2, quantity = $3 where id = $1', [p.id, orderId, qty]);

  // The credit comes off the print price at once, so the customer sees the real total before paying.
  await resumeCredit(p.id);
  const credit = await ensureCredit(p.id);
  if (credit) await query('update orders set coupon_id = $2, coupon_code = $3 where id = $1', [orderId, credit.id, credit.code]);
  const r = await recomputeOrder(orderId);
  await audit(p.id, `customer:${c.id}`, 'order_started', { order: orderId, sha256: v.sha256, credit: credit?.code ?? null });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, orderId, next: `/checkout/${orderId}`, creditCode: credit?.code ?? null, couponMessage: 'couponMessage' in r ? r.couponMessage : undefined };
}

/** What the print desk needs to see about a Studio order. */
export async function studioFacts(orderId: string) {
  const o = await one<{ studio_project_id: string | null }>('select studio_project_id from orders where id = $1', [orderId]);
  if (!o?.studio_project_id) return null;
  const p = await getProject(o.studio_project_id);
  if (!p) return null;
  const review = await one<{ status: string; note: string | null; decided_at: string | null }>('select status, note, decided_at from studio_reviews where project_id = $1 order by requested_at desc limit 1', [p.id]);
  return { projectId: p.id, tier: p.tier, sha256: p.approved_sha256, approvedAt: p.approved_at, spellingConfirmedAt: p.spelling_confirmed_at, review, creditKobo: p.credit_kobo };
}
