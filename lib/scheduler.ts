import { query, withLock } from './db';
import { runSweep } from './sweep';
import { siteAlert } from './siteAlert';
import { runBackupIfDue } from './backup';

/** One run of the five-minute checks, with a note of when it last ran so the console can show it. */
export const SWEEP_LOCK = 727001;

export async function runScheduledSweep() {
  try {
    return await runScheduledSweepNow();
  } catch (e) {
    // The checks that refund late orders and message customers could not run. Tell the owner, at most once an hour.
    await siteAlert({ key: 'sweep', what: `The five-minute checks failed (${(e as Error)?.message ?? e}). Late-order refunds and customer messages may be waiting.`, error: e, repeatMinutes: 60 });
    throw e;
  }
}

async function runScheduledSweepNow() {
  // Only one server may run the check at a time. During a deploy the old and new server overlap, and two
  // checks at once could refund the same late order twice.
  const r = await withLock(SWEEP_LOCK, async () => {
    const result = await runSweep();
    await query("insert into events (name, props) values ('sweep', $1)", [JSON.stringify(result)]);
    await query("delete from events where name = 'sweep' and at < now() - interval '3 days'");
    // Page-view counts older than six months are not needed.
    await query("delete from events where name in ('product_view','campaign_view','template_view','plan_view','nudge_clicked') and at < now() - interval '180 days'");
    // Sign-in codes nobody used would otherwise pile up for ever.
    await query("delete from login_codes where expires_at < now() - interval '1 day'");
    return result;
  });
  return r.ran ? { ...r.value, skipped: false } : { atRisk: 0, late: 0, reviewRequests: 0, deleted: 0, messages: 0, skipped: true };
}

const g = globalThis as unknown as { __brandit_cron?: ReturnType<typeof setInterval> };

/**
 * For hosts with no cron (Railway, Render, Fly, a VPS, Docker). Runs the sweep every five minutes inside the server.
 * Skipped on Vercel, which calls /api/cron/sweep itself, and when INTERNAL_CRON=false.
 */
export function startInternalScheduler(env: NodeJS.ProcessEnv = process.env): 'started' | 'skipped' {
  if (g.__brandit_cron || env.VERCEL || env.INTERNAL_CRON === 'false') return 'skipped';
  const tick = async () => {
    await runScheduledSweep().catch((e) => console.error('[brandit] scheduled sweep failed:', e?.message ?? e));
    // The nightly backup and the monthly restore test run here when they are due. They tell the owner themselves if they fail.
    await runBackupIfDue().catch((e) => console.error('[brandit] backup check failed:', e?.message ?? e));
  };
  setTimeout(tick, 30_000).unref();
  g.__brandit_cron = setInterval(tick, 5 * 60_000);
  g.__brandit_cron.unref();
  return 'started';
}
