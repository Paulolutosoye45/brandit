import { query, tx } from './db';
import { getSettings } from './settings';
import { refundPayment } from './payments';
import { appUrl, flushMessages, queueMessage } from './messages';
import { describeArrival } from './time';
import { STAGE_LABEL, type Stage } from './types';
import { deleteFile } from './storage';
import { cleanupStale } from './custom';
import { sendNudges } from './nudge';
import { issueReferralRewards } from './referrals';
import { cleanupRiderData } from './rider';
import { cleanupReviewPhotos } from './reviewPhotos';
import { runStudioSweep } from './studio/sweep';

/**
 * The checks that make the promise real. Runs every five minutes (Vercel cron or any scheduler).
 *  1. Marks jobs at risk before they are late, and alerts the production lead.
 *  2. Refunds the delivery fee on any 24-hour order that misses its promise, with no one asking.
 *  3. Sends the review request two hours after delivery.
 *  4. Deletes ID card files after the retention period.
 *  5. Closes custom requests nobody came back for and deletes their reference files.
 *  6. Sends one reminder for orders that were filled in but not paid.
 *  7. Pays out referral rewards for friends whose order was delivered.
 *  8. Clears rider locations of finished deliveries and old rejected review photos.
 *  9. Brandit Studio housekeeping: designs past their keep-for date, jobs that stopped, payments not yet applied.
 */
export async function runSweep(now = new Date()) {
  const s = await getSettings();
  const out = { atRisk: 0, late: 0, reviewRequests: 0, deleted: 0, messages: 0, customClosed: 0, customFiles: 0, nudges: 0, rewards: 0, riderCleared: 0, photosCleared: 0, studio: { purged: 0, recovered: 0, applied: 0, sketchLogs: 0 } };

  // 1. At risk
  const jobs = await query<any>(
    `select j.id, j.stage, j.at_risk, o.id as order_id, o.code, o.promised_at from jobs j join orders o on o.id = j.order_id
     where j.stage <> 'delivered' and not j.clock_paused and o.promised_at is not null`,
  );
  const alertPhone = process.env.ALERT_PHONE ?? null;
  for (const j of jobs) {
    const left = new Date(j.promised_at).getTime() - now.getTime();
    const stage = j.stage as Stage;
    const early = ['paid', 'file_check', 'proof', 'printing'].includes(stage);
    const risky = left > 0 && ((early && left < s.at_risk_qc_hours * 3_600_000) || (stage === 'quality_check' && left < s.at_risk_dispatch_hours * 3_600_000));
    if (risky && !j.at_risk) {
      await tx(async (q) => {
        await q.query('update jobs set at_risk = true where id = $1', [j.id]);
        await queueMessage(q, { orderId: null, toPhone: alertPhone, template: 'at_risk', vars: { code: j.code, arrive: describeArrival(new Date(j.promised_at), now), stage: STAGE_LABEL[stage] } });
      });
      out.atRisk++;
    } else if (!risky && j.at_risk && left > 0) {
      await query('update jobs set at_risk = false where id = $1', [j.id]);
    }
  }

  // 2. Late 24-hour orders refund their delivery fee by themselves
  const late = await query<any>(
    `select o.* from orders o join jobs j on j.order_id = o.id
     where o.speed = '24h' and o.status in ('paid','in_production') and o.promised_at < $1 and not j.clock_paused
       and not exists (select 1 from claims c where c.order_id = o.id and c.kind = 'late')`,
    [now.toISOString()],
  );
  for (const o of late) {
    try {
    const fee = o.pickup ? 0 : o.delivery_fee_kobo;
    let refunded = false;
    if (fee > 0) refunded = (await refundPayment(o.id, fee, `late-${o.id}`)).ok;
    await tx(async (q) => {
      await q.query(
        `insert into claims (order_id, kind, source, description, status, resolution, cost_kobo, resolved_at)
         values ($1,'late','system','Missed the 24-hour promise','resolved',$2,$3, now())`,
        [o.id, refunded ? 'delivery_refund' : 'rejected', refunded ? fee : 0],
      );
      await queueMessage(q, { orderId: o.id, template: refunded ? 'late_refund' : 'late_notice', vars: { code: o.code, link: `${appUrl()}/track/${o.public_token}` } });
    });
    out.late++;
    } catch (e: any) {
      // One order that cannot be processed must not stop the others being checked. It is retried on the next run.
      console.error(`[brandit] could not process late order ${o.code}: ${e?.message ?? e}`);
    }
  }

  // 3. Review requests, two hours after delivery
  const reviews = await query<any>(
    `select o.id, o.code, o.public_token from orders o
     where o.status = 'delivered' and o.delivered_at < $1 and o.delivered_at > $2
       and not exists (select 1 from reviews r where r.order_id = o.id)
       and not exists (select 1 from messages m where m.order_id = o.id and m.template = 'review_request')`,
    [new Date(now.getTime() - 2 * 3_600_000).toISOString(), new Date(now.getTime() - 7 * 86_400_000).toISOString()],
  );
  for (const o of reviews) {
    await tx(async (q) => queueMessage(q, { orderId: o.id, template: 'review_request', vars: { code: o.code, link: `${appUrl()}/order/${o.public_token}/review` } }));
    out.reviewRequests++;
  }

  // 4. ID card personal files
  const old = await query<any>(
    `select f.id, f.storage_key from files f join orders o on o.id = f.order_id join order_items i on i.id = f.order_item_id join products p on p.id = i.product_id
     where p.slug = 'id-cards' and o.delivered_at < $1`,
    [new Date(now.getTime() - s.id_file_retention_days * 86_400_000).toISOString()],
  );
  for (const f of old) {
    await deleteFile(f.storage_key);
    await query('update files set storage_key = $2 where id = $1', [f.id, 'deleted.bin']);
    out.deleted++;
  }

  // 5. Custom requests nobody came back for, and the reference files that went with them
  const custom = await cleanupStale(now);
  out.customClosed = custom.closed;
  out.customFiles = custom.files;

  // 6. Reminders for unpaid orders. A failure here must never stop the checks above from running next time.
  try { out.nudges = await sendNudges(now); } catch (e: any) { console.error('[brandit] nudges failed:', e?.message ?? e); }
  // 7. Referral rewards
  try { out.rewards = await issueReferralRewards(now); } catch (e: any) { console.error('[brandit] referral rewards failed:', e?.message ?? e); }
  // 8. Housekeeping for rider locations and review photos
  try { out.riderCleared = await cleanupRiderData(now); } catch (e: any) { console.error('[brandit] rider cleanup failed:', e?.message ?? e); }
  try { out.photosCleared = await cleanupReviewPhotos(now); } catch (e: any) { console.error('[brandit] photo cleanup failed:', e?.message ?? e); }

  // 9. Brandit Studio. Each step is guarded inside, and none may stop the sweep.
  try { out.studio = await runStudioSweep(now); } catch (e: any) { console.error('[brandit] studio sweep failed:', e?.message ?? e); }

  out.messages = await flushMessages();
  return out;
}
