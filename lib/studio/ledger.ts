import { one, query } from '../db';
import type { Settings } from '../settings-defaults';
import { lagosDayStart, startOfLagosMonth } from './config';

/*
 * Every call to an image company is written down with what it cost. The margin report, the monthly cap and the
 * daily free-sketch ceiling all read this one table, so what the team sees is what was spent.
 */
export type Call = {
  projectId?: string | null; versionId?: string | null; vendor: string; model?: string | null; op: string;
  units?: number; usd: number; free?: boolean; simulated?: boolean; ok?: boolean; ms?: number;
};

export const microUsd = (usd: number) => Math.round(usd * 1_000_000);

export async function recordCall(c: Call, fx: number) {
  const micro = c.ok === false ? 0 : microUsd(c.usd);
  await query(
    `insert into studio_ledger (project_id, version_id, vendor, model, op, units, cost_usd_micro, cost_kobo, free, simulated, ok, ms)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [c.projectId ?? null, c.versionId ?? null, c.vendor, c.model ?? null, c.op, c.units ?? 1, micro, Math.round((micro / 1_000_000) * fx * 100), !!c.free, !!c.simulated, c.ok !== false, c.ms ?? null],
  );
  if (c.versionId && micro) await query('update studio_versions set cost_usd_micro = cost_usd_micro + $2 where id = $1', [c.versionId, micro]);
  return micro;
}

export async function monthSpendUsd(now = new Date()): Promise<number> {
  const r = await one<{ m: string }>('select coalesce(sum(cost_usd_micro),0) as m from studio_ledger where at >= $1 and not simulated', [startOfLagosMonth(now).toISOString()]);
  return Number(r?.m ?? 0) / 1_000_000;
}

export async function todayFreeSpendKobo(now = new Date()): Promise<number> {
  const r = await one<{ k: string }>('select coalesce(sum(cost_kobo),0) as k from studio_ledger where free and at >= $1', [lagosDayStart(now).toISOString()]);
  return Number(r?.k ?? 0);
}

/**
 * Where the monthly vendor budget stands.
 *  ok: everything runs. sketches_off: past 80 percent, free sketches pause so paying customers are never the ones turned away.
 *  all_off: the cap is spent, nothing new is generated until the month turns or the cap is raised.
 */
export type CapState = 'ok' | 'sketches_off' | 'all_off';
export async function capState(s: Settings, now = new Date()): Promise<{ state: CapState; spent: number; cap: number }> {
  const spent = await monthSpendUsd(now);
  const cap = s.studio_vendor_cap_usd;
  if (cap <= 0) return { state: 'ok', spent, cap };
  return { state: spent >= cap ? 'all_off' : spent >= cap * 0.8 ? 'sketches_off' : 'ok', spent, cap };
}

/** The free sketch ceiling for the Lagos day. */
export async function freeCeiling(s: Settings, now = new Date()): Promise<{ reached: boolean; spentKobo: number; ceilingKobo: number }> {
  const spentKobo = await todayFreeSpendKobo(now);
  return { reached: s.studio_free_ceiling_kobo > 0 && spentKobo >= s.studio_free_ceiling_kobo, spentKobo, ceilingKobo: s.studio_free_ceiling_kobo };
}

export async function spendByVendor(since: Date) {
  return query<{ vendor: string; op: string; calls: string; usd: string; failed: string }>(
    `select vendor, op, count(*) as calls, coalesce(sum(cost_usd_micro),0)/1000000.0 as usd, count(*) filter (where not ok) as failed
     from studio_ledger where at >= $1 and not simulated group by vendor, op order by usd desc`,
    [since.toISOString()],
  );
}
