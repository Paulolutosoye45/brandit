import { query, one, tx, type Q } from './db';
import { STAGES, STAGE_LABEL, type Stage, type Role } from './types';
import { can } from './permissions';
import { appUrl, flushMessages, queueMessage } from './messages';
import { arriveLine, promiseFor } from './orders';
import { token } from './password';

type Row = Record<string, any>;
export type Actor = { id: string; name: string; role: Role; press_id: string | null };

export class JobError extends Error {}

/** The only moves a job may make. Everything else is refused. */
export const ALLOWED: Record<Stage, Stage[]> = {
  paid: ['file_check'],
  file_check: ['printing', 'proof'],
  proof: ['printing'],
  printing: ['quality_check'],
  quality_check: ['out_for_delivery', 'printing'],
  out_for_delivery: ['delivered'],
  delivered: [],
};

export function nextStep(stage: Stage, artworkPath: string | null): Stage | null {
  if (stage === 'file_check') return artworkPath === 'design' ? 'proof' : 'printing';
  if (stage === 'printing') return 'quality_check';
  if (stage === 'quality_check') return 'out_for_delivery';
  if (stage === 'out_for_delivery') return 'delivered';
  return null;
}

const need = (actor: Actor | null, action: Parameters<typeof can>[1], msg: string) => {
  if (actor && !can(actor.role, action)) throw new JobError(msg);
};

type MoveOpts = { actor: Actor | null; note?: string; viaCustomer?: boolean; viaCode?: boolean };

export async function moveJob(jobId: string, to: Stage, o: MoveOpts, now = new Date()): Promise<void> {
  const job = await one('select * from jobs where id = $1', [jobId]);
  if (!job) throw new JobError('We could not find that job.');
  const from = job.stage as Stage;
  if (!ALLOWED[from].includes(to)) throw new JobError(`A job cannot go from ${STAGE_LABEL[from]} to ${STAGE_LABEL[to]}.`);
  const order = (await one('select * from orders where id = $1', [job.order_id]))!;
  const item = (await one('select * from order_items where id = $1', [job.order_item_id]))!;
  const a = o.actor;

  // Who may make which move
  if (from === 'file_check') need(a, 'file_review', 'Only the file desk can pass a file.');
  if (from === 'proof') {
    if (!o.viaCustomer && !(a && (a.role === 'admin' || a.role === 'production_lead') && o.note?.trim())) throw new JobError('Printing starts when the customer approves the proof.');
  }
  if (from === 'printing') {
    need(a, 'scan_print', 'Only press staff can move a job out of printing.');
    if (a?.role === 'partner_press' && job.press_id !== a.press_id) throw new JobError('That job is at another press.');
  }
  if (from === 'quality_check') need(a, 'pass_qc', 'Only the production lead can pass the quality check.');
  if (from === 'out_for_delivery' && !o.viaCode) need(a, 'dispatch', 'Only dispatch can mark a job delivered.');

  // Rules that protect accuracy
  if (from === 'file_check' && to === 'printing') {
    if (item.artwork_path !== 'upload' || !item.preview_approved_at) throw new JobError('The customer has not approved the preview yet.');
  }
  if (from === 'file_check' && to === 'proof' && item.artwork_path !== 'design' && !o.note?.trim()) throw new JobError('Add a note saying why this file needs a proof.');
  if (from === 'quality_check' && to === 'out_for_delivery') {
    const photo = await one('select 1 as x from files where order_item_id = $1 and kind = $2 limit 1', [item.id, 'qc_photo']);
    if (!photo) throw new JobError('Add the finished-job photo first. It is what the customer sees before the rider leaves.');
    if (!order.pickup) {
      const d = await one('select 1 as x from deliveries where order_id = $1', [order.id]);
      if (!d) throw new JobError('Add the rider details first.');
    }
  }
  if (from === 'quality_check' && to === 'printing' && !o.note?.trim()) throw new JobError('Say what failed the check, so it is reprinted right.');

  // Printing starts the clock again if it was paused, or sets it for the first time on a design job.
  const resuming = to === 'printing' && (job.clock_paused || !order.promised_at) && from !== 'quality_check';
  const pair = resuming ? await promiseFor(order.id, now) : null;

  await tx(async (q: Q) => {
    await q.query('update jobs set stage = $2, at_risk = false, clock_paused = false, paused_reason = null, paused_at = null, updated_at = now() where id = $1', [job.id, to]);
    await q.query('insert into job_events (job_id, from_stage, to_stage, staff_id, note) values ($1,$2,$3,$4,$5)', [job.id, from, to, a?.id ?? null, o.note?.trim() || (o.viaCustomer ? 'Customer approved the proof' : o.viaCode ? 'Customer gave the delivery code' : null)]);

    const link = `${appUrl()}/track/${order.public_token}`;
    let promisedAt: Date | null = order.promised_at ? new Date(order.promised_at) : null;
    if (pair) {
      const f = pair.fresh;
      const changed = !promisedAt || f.arriveBy.getTime() !== promisedAt.getTime();
      promisedAt = f.arriveBy;
      await q.query('update orders set speed = $2, production_day = $3, promised_at = $4, promise_reasons = $5 where id = $1', [order.id, f.tier, f.productionDay, f.arriveBy.toISOString(), JSON.stringify(f.reasons)]);
      if (changed && from === 'file_check') await queueMessage(q, { orderId: order.id, template: 'new_time', vars: { arrive_line: arriveLine({ speed: f.tier, promisedAt, pickup: order.pickup }, now), link } });
    }

    if (to === 'printing' && from === 'file_check') {
      await q.query("update orders set status = 'in_production' where id = $1", [order.id]);
      await queueMessage(q, { orderId: order.id, template: 'file_checked', vars: { staff_name: a?.name.split(' (')[0] ?? 'Our file desk' } });
    }
    if (to === 'printing' && from === 'proof') {
      await q.query("update orders set status = 'in_production' where id = $1", [order.id]);
      await queueMessage(q, { orderId: order.id, template: 'printing', vars: { code: order.code, arrive_line: arriveLine({ speed: order.speed, promisedAt, pickup: order.pickup }, now) } });
    }
    if (to === 'printing' && from === 'quality_check') {
      await q.query('update jobs set reprint_count = reprint_count + 1 where id = $1', [job.id]);
    }
    if (to === 'out_for_delivery') {
      await q.query('update deliveries set dispatched_at = now() where order_id = $1', [order.id]);
      await queueMessage(q, { orderId: order.id, template: order.pickup ? 'ready_for_pickup' : 'out_for_delivery', vars: { link, delivery_code: order.delivery_code } });
    }
    if (to === 'delivered') {
      await q.query("update orders set status = 'delivered', delivered_at = $2 where id = $1", [order.id, now.toISOString()]);
      await q.query('update deliveries set delivered_at = $2, last_lat = null, last_lng = null, last_accuracy_m = null, last_ping_at = null where order_id = $1', [order.id, now.toISOString()]);
      await queueMessage(q, { orderId: order.id, template: 'delivered', vars: { link } });
    }
  });
  await flushMessages();
}

/** The file desk found a problem. The clock pauses and the customer gets the exact issue and a link to fix it. */
export async function flagFile(jobId: string, actor: Actor, issue: string): Promise<void> {
  need(actor, 'file_review', 'Only the file desk can flag a file.');
  const job = await one('select * from jobs where id = $1', [jobId]);
  if (!job || job.stage !== 'file_check') throw new JobError('Only jobs at the file check can be flagged.');
  if (!issue.trim()) throw new JobError('Say what is wrong, in plain words. The customer will read it.');
  const order = (await one('select * from orders where id = $1', [job.order_id]))!;
  await tx(async (q) => {
    await q.query('update jobs set clock_paused = true, paused_reason = $2, paused_at = now(), updated_at = now() where id = $1', [job.id, issue.trim()]);
    await q.query("insert into job_events (job_id, from_stage, to_stage, staff_id, note) values ($1,'file_check','file_check',$2,$3)", [job.id, actor.id, `Problem with the file: ${issue.trim()}`]);
    await q.query('update order_items set preview_approved_at = null where id = $1', [job.order_item_id]);
    await queueMessage(q, { orderId: order.id, template: 'file_problem', vars: { issue: issue.trim().replace(/\.?$/, '.'), link: `${appUrl()}/order/${order.id}/artwork?fix=1` } });
  });
  await flushMessages();
}

export async function sendProof(jobId: string, actor: Actor, fileId: string): Promise<{ token: string }> {
  need(actor, 'send_proof', 'Only the file desk can send proofs.');
  const job = await one('select * from jobs where id = $1', [jobId]);
  if (!job || !['file_check', 'proof'].includes(job.stage)) throw new JobError('Proofs go out from the file check or proof stage.');
  const order = (await one('select * from orders where id = $1', [job.order_id]))!;
  const tok = token(16);
  await tx(async (q) => {
    const v = (await q.query<{ n: number }>('select coalesce(max(version),0)::int + 1 as n from proofs where order_item_id = $1', [job.order_item_id]))[0].n;
    await q.query("insert into proofs (token, order_item_id, version, file_id, status) values ($1,$2,$3,$4,'sent')", [tok, job.order_item_id, v, fileId]);
    if (job.stage === 'file_check') {
      await q.query("update jobs set stage = 'proof', clock_paused = true, paused_reason = 'Waiting for your approval of the proof', paused_at = now(), updated_at = now() where id = $1", [job.id]);
      await q.query("insert into job_events (job_id, from_stage, to_stage, staff_id, note) values ($1,'file_check','proof',$2,$3)", [job.id, actor.id, `Proof version ${v} sent`]);
    } else {
      await q.query("insert into job_events (job_id, from_stage, to_stage, staff_id, note) values ($1,'proof','proof',$2,$3)", [job.id, actor.id, `Proof version ${v} sent`]);
    }
    await queueMessage(q, { orderId: order.id, template: 'proof_ready', vars: { link: `${appUrl()}/proof/${tok}` } });
  });
  await flushMessages();
  return { token: tok };
}

export async function decideProof(proofToken: string, decision: 'approved' | 'changes_requested', note?: string): Promise<{ ok: boolean; error?: string }> {
  const p = await one('select * from proofs where token = $1', [proofToken]);
  if (!p) return { ok: false, error: 'We could not find that proof.' };
  if (p.status !== 'sent') return { ok: false, error: 'This proof has already been answered.' };
  const latest = await one<{ id: string }>('select id from proofs where order_item_id = $1 order by version desc limit 1', [p.order_item_id]);
  if (latest?.id !== p.id) return { ok: false, error: 'A newer proof has been sent. Please use the latest link.' };
  const job = await one('select * from jobs where order_item_id = $1', [p.order_item_id]);
  if (!job) return { ok: false, error: 'This order is not in production yet.' };
  if (decision === 'changes_requested') {
    if (!note?.trim()) return { ok: false, error: 'Tell us what to change.' };
    await query("update proofs set status = 'changes_requested', customer_note = $2, decided_at = now() where id = $1", [p.id, note.trim()]);
    await query("insert into job_events (job_id, from_stage, to_stage, note) values ($1,'proof','proof',$2)", [job.id, `Customer asked for changes: ${note.trim()}`]);
    return { ok: true };
  }
  await query("update proofs set status = 'approved', decided_at = now() where id = $1", [p.id]);
  await query('update order_items set preview_approved_at = now() where id = $1', [p.order_item_id]);
  try {
    await moveJob(job.id, 'printing', { actor: null, viaCustomer: true });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  return { ok: true };
}

export async function saveDelivery(orderId: string, actor: Actor, d: { rider_name: string; rider_phone?: string; tracking_url?: string; provider?: string }) {
  need(actor, 'dispatch', 'Only dispatch can add rider details.');
  if (!d.rider_name.trim()) throw new JobError('Add the rider name.');
  await query(
    `insert into deliveries (order_id, provider, rider_name, rider_phone, tracking_url, rider_token) values ($1,$2,$3,$4,$5,$6)
     on conflict (order_id) do update set provider = excluded.provider, rider_name = excluded.rider_name, rider_phone = excluded.rider_phone, tracking_url = excluded.tracking_url,
       rider_token = coalesce(deliveries.rider_token, excluded.rider_token)`,
    [orderId, d.provider?.trim() || null, d.rider_name.trim(), d.rider_phone?.trim() || null, d.tracking_url?.trim() || null, token(24)],
  );
}

/** The customer reads their delivery code to the rider. The rider (or dispatch) enters it to complete the delivery. */
export async function completeWithCode(jobId: string, code: string): Promise<void> {
  const job = await one('select * from jobs where id = $1', [jobId]);
  if (!job) throw new JobError('We could not find that job.');
  const order = await one('select delivery_code from orders where id = $1', [job.order_id]);
  if (!order || String(order.delivery_code) !== String(code).trim()) throw new JobError('That code does not match. Ask the customer to read it again.');
  await moveJob(jobId, 'delivered', { actor: null, viaCode: true });
}

export async function assignPress(jobId: string, actor: Actor, pressId: string) {
  need(actor, 'assign_press', 'Only the production lead can assign a press.');
  await query('update jobs set press_id = $2, updated_at = now() where id = $1', [jobId, pressId]);
  await query("insert into job_events (job_id, from_stage, to_stage, staff_id, note) select id, stage, stage, $2, $3 from jobs where id = $1", [jobId, actor.id, 'Assigned to a press']);
}

/** The customer replaced a file after a problem was flagged. The job stays paused until the file desk passes it. */
export async function noteReupload(orderId: string) {
  const job = await one('select * from jobs where order_id = $1', [orderId]);
  if (!job || job.stage !== 'file_check') return;
  await query("insert into job_events (job_id, from_stage, to_stage, note) values ($1,'file_check','file_check','Customer uploaded a new file')", [job.id]);
}

// ---------- Queue ----------
export type JobStatus = 'late' | 'at_risk' | 'on_track' | 'waiting' | 'unset';

export function statusOf(j: { stage: Stage; clock_paused: boolean; promised_at: string | Date | null; at_risk: boolean }, now = new Date()): JobStatus {
  if (j.clock_paused) return 'waiting';
  if (!j.promised_at) return 'unset';
  if (new Date(j.promised_at).getTime() < now.getTime() && j.stage !== 'delivered') return 'late';
  return j.at_risk ? 'at_risk' : 'on_track';
}

export async function listQueue(actor: Actor): Promise<Row[]> {
  const base = `select j.id, j.stage, j.clock_paused, j.paused_reason, j.at_risk, j.reprint_count, j.updated_at,
            o.id as order_id, o.code, o.speed, o.promised_at, o.pickup, o.public_token, o.area, o.delivery_window,
            coalesce(i.label, p.name) as product_name, i.quantity, i.config, i.artwork_path, i.size_key, i.width_ft, i.height_ft, pr.name as press_name
     from jobs j join orders o on o.id = j.order_id join order_items i on i.id = j.order_item_id
     join products p on p.id = i.product_id left join presses pr on pr.id = j.press_id
     where j.stage <> 'delivered'`;
  const order = ' order by (o.promised_at is null), o.promised_at, o.code';
  if (actor.role === 'partner_press') return query(`${base} and j.press_id = $1${order}`, [actor.press_id]);
  return query(`${base}${order}`);
}

export { STAGES };
