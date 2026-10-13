import { one, query } from '../db';
import type { Settings } from '../settings-defaults';
import { allowanceFor, priceOf, startOfLagosMonth, type Tier } from './config';
import { opUsd, resolveEngine } from './providers/catalog';
import type { EngineId } from './providers/types';
import { capState, freeCeiling, spendByVendor } from './ledger';

/*
 * The numbers the team watches. Two views of margin:
 *  - Planned: what one customer costs if they use every single thing included in their tier, at the cautious exchange rate.
 *    This is the worst case, and it must stay above the floor in settings.
 *  - Observed: what paying customers actually cost over the last 30 days.
 * Paystack's fee is taken as 1.5 percent plus ₦100 (the ₦100 applies from ₦2,500), capped at ₦2,000.
 * The time a Brandit designer spends on a check is a staff cost and is not in these numbers.
 */
const paystackFee = (gross: number) => Math.min(200_000, Math.round(gross * 0.015) + (gross >= 250_000 ? 10_000 : 0));

export type PlanLine = { label: string; usd: number };
export type Plan = { tier: Tier; priceKobo: number; netKobo: number; costKobo: number; marginPct: number; lines: PlanLine[]; belowFloor: boolean };

export function planMargin(s: Settings, tier: Tier): Plan {
  const a = allowanceFor(tier, s);
  const chain = (tier === 'premium' ? s.studio_chain_premium : s.studio_chain_standard) as EngineId[];
  const eng = resolveEngine(chain[0] ?? (tier === 'premium' ? 'nano-banana' : 'recraft'), s);
  const lines: PlanLine[] = [];
  const gens = tier === 'premium' ? a.concepts + a.finals + a.rounds * a.perRound + a.extraProducts : a.concepts + a.rounds * a.perRound;
  lines.push({ label: `${gens} pictures with ${eng.label}`, usd: gens * eng.usd });
  const finishes = tier === 'premium' ? 4 : 2;
  const mp = tier === 'premium' ? 26 : s.studio_standard_max_mp;
  const upUsd = s.studio_upscaler === 'topaz' ? opUsd('topazPerMp', s) * mp : opUsd('crisp', s);
  lines.push({ label: `${finishes} print files enlarged (${s.studio_upscaler})`, usd: finishes * upUsd });
  if (tier === 'premium') lines.push({ label: 'Vector file and a person cut out', usd: opUsd('vectorise', s) * 2 + opUsd('cutout', s) });
  const usd = lines.reduce((t, l) => t + l.usd, 0);
  const costKobo = Math.round(usd * s.studio_fx_plan * 100);
  const priceKobo = priceOf(s, tier);
  const exVat = s.prices_include_vat ? Math.round(priceKobo / (1 + s.vat_rate)) : priceKobo;
  const netKobo = exVat - paystackFee(priceKobo);
  const marginPct = netKobo > 0 ? Math.round(((netKobo - costKobo) / netKobo) * 100) : 0;
  return { tier, priceKobo, netKobo, costKobo, marginPct, lines, belowFloor: marginPct < s.studio_margin_floor_pct };
}

export type Observed = { tier: Tier; projects: number; revenueKobo: number; costKobo: number; avgCostKobo: number; avgRevenueKobo: number; marginPct: number | null };

export async function observedMargin(since: Date): Promise<Observed[]> {
  const out: Observed[] = [];
  for (const tier of ['standard', 'premium'] as const) {
    const r = await one<{ n: string; rev: string; cost: string }>(
      `select count(*) as n, coalesce(sum(p.paid_kobo),0) as rev,
              coalesce(sum((select coalesce(sum(l.cost_kobo),0) from studio_ledger l where l.project_id = p.id and not l.simulated)),0) as cost
       from studio_projects p where p.tier = $1 and p.paid_at >= $2 and p.from_pack = false`,
      [tier, since.toISOString()],
    );
    const n = Number(r?.n ?? 0), rev = Number(r?.rev ?? 0), cost = Number(r?.cost ?? 0);
    out.push({ tier, projects: n, revenueKobo: rev, costKobo: cost, avgRevenueKobo: n ? Math.round(rev / n) : 0, avgCostKobo: n ? Math.round(cost / n) : 0, marginPct: rev > 0 ? Math.round(((rev - cost) / rev) * 100) : null });
  }
  return out;
}

export async function studioOverview(s: Settings, now = new Date()) {
  const month = startOfLagosMonth(now);
  const d30 = new Date(now.getTime() - 30 * 86_400_000);
  const [cap, ceiling, vendors, observed, counts] = await Promise.all([
    capState(s, now), freeCeiling(s, now), spendByVendor(month), observedMargin(d30),
    one<Record<string, string>>(
      `select
         (select count(*) from studio_projects where created_at >= $1) as projects_month,
         (select count(*) from studio_projects where tier is not null and paid_at >= $1) as paid_month,
         (select coalesce(sum(amount_kobo),0) from studio_purchases where status = 'paid' and verified_at >= $1) as revenue_month,
         (select coalesce(sum(amount_kobo),0) from studio_purchases where status = 'refunded' and refunded_at >= $1) as refunded_month,
         (select count(*) from studio_purchases where status = 'refunded' and refunded_at >= $1) as refunds_month,
         (select count(*) from studio_sketch_log where at >= $1) as sketches_month,
         (select count(*) from studio_versions where status = 'failed' and created_at >= $1) as failed_month,
         (select count(*) from studio_flags where status = 'open') as flags_open,
         (select count(*) from studio_reviews where status = 'waiting') as reviews_waiting,
         (select count(*) from studio_versions where status in ('queued','running')) as queue,
         (select count(*) from orders where studio_project_id is not null and created_at >= $1) as orders_month`,
      [month.toISOString()],
    ),
  ]);
  const c = (k: string) => Number(counts?.[k] ?? 0);
  return {
    cap, ceiling,
    vendors: vendors.map((v) => ({ vendor: v.vendor, op: v.op, calls: Number(v.calls), usd: Number(v.usd), failed: Number(v.failed) })),
    plan: [planMargin(s, 'standard'), planMargin(s, 'premium')],
    observed,
    month: {
      projects: c('projects_month'), paid: c('paid_month'), revenueKobo: c('revenue_month'), refundedKobo: c('refunded_month'), refunds: c('refunds_month'),
      sketches: c('sketches_month'), failed: c('failed_month'), orders: c('orders_month'),
    },
    flagsOpen: c('flags_open'), reviewsWaiting: c('reviews_waiting'), queue: c('queue'),
  };
}
export type Overview = Awaited<ReturnType<typeof studioOverview>>;
void query;
