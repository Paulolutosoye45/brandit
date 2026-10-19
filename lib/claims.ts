import { query, one, tx } from './db';
import { getSettings } from './settings';
import { refundPayment } from './payments';
import { appUrl, flushMessages, queueMessage } from './messages';
import { moveJob, JobError, type Actor } from './jobs';
import { can } from './permissions';
import { naira } from './money';

export type Resolution = 'reprint' | 'refund' | 'delivery_refund' | 'rejected';

/** A customer reports a problem. Open for 48 hours after delivery (a setting). */
export async function createClaim(orderToken: string, d: { kind: 'wrong_print' | 'damaged' | 'other'; description: string; photoFileId?: string | null; itemId?: string | null }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const o = await one('select * from orders where public_token = $1', [orderToken]);
  if (!o || o.status !== 'delivered' || !o.delivered_at) return { ok: false, error: 'You can report a problem once your order has been delivered.' };
  const s = await getSettings();
  if (Date.now() > new Date(o.delivered_at).getTime() + s.claim_window_hours * 3_600_000) return { ok: false, error: `Problems can be reported within ${s.claim_window_hours} hours of delivery. Message us and a person will look at it.` };
  if (!d.description?.trim()) return { ok: false, error: 'Tell us what is not right, in a sentence or two.' };
  // A problem can be about one product in the order. Anything we cannot match to this order means "the whole order".
  const itemId = d.itemId ? (await one<{ id: string }>('select id from order_items where id = $1 and order_id = $2', [d.itemId, o.id]))?.id ?? null : null;
  const open = await one<{ id: string }>("select id from claims where order_id = $1 and status = 'open' and source = 'customer' and order_item_id is not distinct from $2::uuid", [o.id, itemId]);
  if (open) return { ok: true, id: open.id };
  const r = await one<{ id: string }>(
    "insert into claims (order_id, kind, source, description, photo_file_id, order_item_id) values ($1,$2,'customer',$3,$4,$5) returning id",
    [o.id, d.kind, d.description.trim().slice(0, 1000), d.photoFileId ?? null, itemId],
  );
  return { ok: true, id: r!.id };
}

/** The production lead decides. Above their limit, an admin has to approve. */
export async function resolveClaim(claimId: string, actor: Actor, d: { resolution: Resolution; note?: string; amountKobo?: number }): Promise<void> {
  if (!can(actor.role, 'claims')) throw new JobError('Only the production lead or an admin can decide a claim.');
  const claim = await one('select * from claims where id = $1', [claimId]);
  if (!claim || claim.status !== 'open') throw new JobError('This claim is already closed.');
  const order = (await one('select * from orders where id = $1', [claim.order_id]))!;
  // The lines this claim is about: the one the customer named, or every line of the order.
  const items = await query<any>('select * from order_items where order_id = $1 and ($2::uuid is null or id = $2::uuid) order by position, id', [order.id, claim.order_item_id ?? null]);
  const jobs = await query<any>('select * from jobs where order_id = $1 and ($2::uuid is null or order_item_id = $2::uuid) order by created_at, id', [order.id, claim.order_item_id ?? null]);
  const s = await getSettings();
  const link = `${appUrl()}/track/${order.public_token}`;

  let cost = 0;
  if (d.resolution === 'reprint') cost = items.reduce((a: number, i: any) => a + i.line_total_kobo, 0); // estimate: the print value of the job
  if (d.resolution === 'refund') cost = Math.min(d.amountKobo ?? order.total_kobo, order.total_kobo);
  if (d.resolution === 'delivery_refund') cost = order.delivery_fee_kobo;
  if (d.resolution === 'rejected' && !d.note?.trim()) throw new JobError('Give the customer a reason, in plain words.');
  if (actor.role === 'production_lead' && cost > s.lead_reprint_limit_kobo) throw new JobError(`This is above ${naira(s.lead_reprint_limit_kobo)}. Ask an admin to approve it.`);

  if (d.resolution === 'refund' || d.resolution === 'delivery_refund') {
    if (cost > 0) {
      const r = await refundPayment(order.id, cost, claim.id);
      if (!r.ok) throw new JobError(r.error ?? 'The refund did not go through.');
    }
  }
  if (d.resolution === 'reprint' && jobs.length > 0) {
    // Back to printing at the front of the queue. The customer sees it on the tracker.
    for (const job of jobs) {
      await query("update jobs set stage = 'quality_check' where id = $1 and stage = 'delivered'", [job.id]);
      await moveJob(job.id, 'printing', { actor, note: `Reprint for claim: ${d.note?.trim() || claim.description || 'print problem'}` });
    }
    await query("update orders set status = 'in_production', delivered_at = null where id = $1", [order.id]);
  }

  await tx(async (q) => {
    await q.query("update claims set status = 'resolved', resolution = $2, resolution_note = $3, cost_kobo = $4, staff_id = $5, resolved_at = now() where id = $1", [claim.id, d.resolution, d.note?.trim() || null, cost, actor.id]);
    if (d.resolution === 'refund' && cost >= order.total_kobo) await q.query("update orders set status = 'refunded' where id = $1", [order.id]);
    if (d.resolution === 'reprint') await queueMessage(q, { orderId: order.id, template: 'reprint_started', vars: { code: order.code, link } });
    if (d.resolution === 'refund' || d.resolution === 'delivery_refund') await queueMessage(q, { orderId: order.id, template: 'refund_issued', vars: { amount: naira(cost), code: order.code } });
    if (d.resolution === 'rejected') await queueMessage(q, { orderId: order.id, template: 'claim_rejected', vars: { code: order.code, reason: d.note!.trim().replace(/\.?$/, '.') } });
  });
  await flushMessages();
}
