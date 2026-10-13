import { one, query } from '../db';
import type { Settings } from '../settings-defaults';
import { capState, freeCeiling } from './ledger';
import { lagosDayStart } from './config';

/*
 * What stops Studio being used up by one person, or turned into a free service. Free sketches are counted by
 * verified phone number (a new email address does not give a new allowance), the day's free spend has a ceiling, and
 * repeated blocked requests pause the account for a human to look at.
 */
export type Sketches = {
  verified: boolean;
  limit: number;
  used: number;
  left: number;
  /** When the oldest sketch in the window stops counting. */
  nextAt: string | null;
  /** Paused for everyone right now (budget or daily ceiling). */
  resting: null | 'ceiling' | 'budget' | 'off';
};

export async function sketchState(s: Settings, customer: { id: string; phone: string | null }): Promise<Sketches> {
  const limit = s.studio_free_per_week;
  let used = 0, nextAt: string | null = null;
  if (customer.phone) {
    const rows = await query<{ at: string }>("select at from studio_sketch_log where phone = $1 and at > now() - interval '7 days' order by at", [customer.phone]);
    used = rows.length;
    if (rows.length >= limit && limit > 0) nextAt = new Date(new Date(rows[rows.length - limit].at).getTime() + 7 * 86_400_000).toISOString();
  }
  let resting: Sketches['resting'] = null;
  if (!s.studio_enabled || !s.studio_standard_on || limit <= 0) resting = 'off';
  else {
    const cap = await capState(s);
    if (cap.state !== 'ok') resting = 'budget';
    else if ((await freeCeiling(s)).reached) resting = 'ceiling';
  }
  return { verified: !!customer.phone, limit, used, left: Math.max(0, limit - used), nextAt, resting };
}

export async function logSketch(customerId: string, phone: string, projectId: string, versionId: string, costKobo = 0) {
  await query('insert into studio_sketch_log (customer_id, phone, project_id, version_id, cost_kobo) values ($1,$2,$3,$4,$5)', [customerId, phone, projectId, versionId, costKobo]);
}
/** A sketch that failed through our fault does not count against the person. */
export async function unlogSketch(versionId: string) {
  await query('delete from studio_sketch_log where version_id = $1', [versionId]);
}

/** Record something Studio stopped or wants a person to look at. Returns true when the account has now been paused. */
export async function recordFlag(s: Settings, f: { customerId: string | null; projectId?: string | null; versionId?: string | null; stage: 'words' | 'look' | 'upload' | 'output' | 'print'; category: string; verdict: 'block' | 'review'; excerpt?: string | null }): Promise<boolean> {
  await query(
    'insert into studio_flags (customer_id, project_id, version_id, stage, category, verdict, excerpt) values ($1,$2,$3,$4,$5,$6,$7)',
    [f.customerId, f.projectId ?? null, f.versionId ?? null, f.stage, f.category, f.verdict, f.excerpt ? f.excerpt.slice(0, 200) : null],
  );
  if (f.verdict !== 'block' || !f.customerId || s.studio_strike_limit <= 0) return false;
  const r = await one<{ n: string }>("select count(*) as n from studio_flags where customer_id = $1 and verdict = 'block' and created_at > now() - interval '30 days' and status <> 'dismissed'", [f.customerId]);
  if (Number(r?.n ?? 0) >= s.studio_strike_limit) {
    await query("update customers set studio_blocked_until = now() + interval '7 days' where id = $1", [f.customerId]);
    return true;
  }
  return false;
}

/** Staff lift a pause and dismiss the strikes that led to it. */
export async function liftPause(customerId: string) {
  await query('update customers set studio_blocked_until = null where id = $1', [customerId]);
  await query("update studio_flags set status = 'dismissed' where customer_id = $1 and verdict = 'block' and status = 'open'", [customerId]);
}

export type LinkResult = { ok: true } | { ok: false; error: string };

/** After a code was checked for this number: put it on the account, unless it belongs to someone else. */
export async function linkVerifiedPhone(customerId: string, phone: string): Promise<LinkResult> {
  const other = await one<{ id: string }>('select id from customers where phone = $1 and id <> $2', [phone, customerId]);
  if (other) return { ok: false, error: 'That number is already on another Brandit account. Sign in with that number to use it.' };
  const me = await one<{ phone: string | null }>('select phone from customers where id = $1', [customerId]);
  if (!me) return { ok: false, error: 'Sign in again to continue.' };
  if (me.phone && me.phone !== phone) return { ok: false, error: 'This account already has a verified number.' };
  await query('update customers set phone = $2 where id = $1', [customerId, phone]);
  return { ok: true };
}

export const dayStartIso = () => lagosDayStart().toISOString();
