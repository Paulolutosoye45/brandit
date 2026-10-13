import { query } from '../db';
import { purgeExpired } from './projects';
import { applyPendingPaid } from './purchases';
import { recoverStale } from './worker';

/**
 * The Studio part of the five-minute sweep.
 *  - Deletes designs, pictures and words that passed their keep-for date (the order's own copy of the print file stays).
 *  - Restarts design jobs that stopped when the server restarted, and finishes payments that were confirmed but not applied.
 *  - Forgets old free-sketch records, which exist only to count the week.
 */
export async function runStudioSweep(now = new Date()) {
  const out = { purged: 0, recovered: 0, applied: 0, sketchLogs: 0 };
  try { out.purged = await purgeExpired(); } catch (e: any) { console.error('[brandit] studio purge failed:', e?.message ?? e); }
  try { out.recovered = await recoverStale(); } catch (e: any) { console.error('[brandit] studio recover failed:', e?.message ?? e); }
  try { out.applied = await applyPendingPaid(); } catch (e: any) { console.error('[brandit] studio apply failed:', e?.message ?? e); }
  try {
    const old = await query<{ id: number }>('delete from studio_sketch_log where at < $1 returning id', [new Date(now.getTime() - 40 * 86_400_000).toISOString()]);
    out.sketchLogs = old.length;
    await query('delete from studio_ledger where at < $1', [new Date(now.getTime() - 400 * 86_400_000).toISOString()]);
  } catch (e: any) { console.error('[brandit] studio log cleanup failed:', e?.message ?? e); }
  return out;
}
