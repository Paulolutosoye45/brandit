import { isDemo, query, one } from '../db';
import type { Settings } from '../settings-defaults';
import { lagosParts, lagosDate, addDays } from '../time';
import { vendorsOn } from './providers/catalog';

/** Studio can only run when at least one picture-making company is connected (or in demo mode). Without one it stays closed instead of taking money it cannot honour. */
export const runnable = () => isDemo() || Object.values(vendorsOn()).some(Boolean);

/*
 * Prices, allowances and switches for Studio, read from settings so the team changes them in the console.
 * All money is kobo and includes VAT, like the rest of the platform.
 */
export type Tier = 'standard' | 'premium';
export type Sku = 'standard' | 'premium' | 'upgrade' | 'pack3' | 'round' | 'vector' | 'check';
export const SKUS: Sku[] = ['standard', 'premium', 'upgrade', 'pack3', 'round', 'vector', 'check'];

export const SKU_LABEL: Record<Sku, string> = {
  standard: 'Standard design',
  premium: 'Premium design',
  upgrade: 'Upgrade to Premium',
  pack3: 'Pack of three Standard designs',
  round: 'One more round of changes',
  vector: 'Vector file',
  check: 'Check by a Brandit designer',
};

export type Allowance = {
  tier: Tier;
  concepts: number; // first-round designs
  rounds: number; // change rounds included
  perRound: number; // new versions each round
  finals: number; // print-quality files (Premium: highest-quality finals)
  extraProducts: number;
  vectorIncluded: boolean;
  checkIncluded: boolean;
  creditKobo: number;
};

export function allowanceFor(tier: Tier, s: Settings): Allowance {
  return tier === 'premium'
    ? { tier, concepts: s.studio_prem_drafts, rounds: s.studio_prem_rounds, perRound: 1, finals: s.studio_prem_finals, extraProducts: s.studio_prem_extra_products, vectorIncluded: true, checkIncluded: true, creditKobo: s.studio_credit_premium_kobo }
    : { tier, concepts: s.studio_std_concepts, rounds: s.studio_std_rounds, perRound: s.studio_std_per_round, finals: 1, extraProducts: 0, vectorIncluded: false, checkIncluded: false, creditKobo: s.studio_credit_standard_kobo };
}

/** What a customer pays for something. A price the team has overridden wins. */
export function priceOf(s: Settings, sku: Sku, tier?: Tier): number {
  const o = s.studio_price_overrides?.[`price:${sku}`];
  if (typeof o === 'number' && o >= 0) return Math.round(o);
  switch (sku) {
    case 'standard': return s.studio_standard_kobo;
    case 'premium': return s.studio_premium_kobo;
    case 'upgrade': return Math.max(0, s.studio_premium_kobo - s.studio_standard_kobo);
    case 'pack3': return s.studio_pack3_kobo;
    case 'round': return tier === 'premium' ? s.studio_round_premium_kobo : s.studio_round_standard_kobo;
    case 'vector': return s.studio_vector_kobo;
    case 'check': return s.studio_check_kobo;
  }
}

/** Studio can be used by this person right now? */
export type Access = { ok: true } | { ok: false; reason: 'off' | 'invite' | 'paused'; message: string };

export async function accessFor(s: Settings, c: { id: string; phone: string | null; email: string | null; studio_blocked_until?: string | null } | null): Promise<Access> {
  if (!s.studio_enabled || !runnable()) return { ok: false, reason: 'off', message: 'Brandit Studio is not open yet.' };
  if (c?.studio_blocked_until && new Date(c.studio_blocked_until) > new Date()) {
    return { ok: false, reason: 'paused', message: 'Studio is paused on this account for now because a few requests were stopped. Contact us on the Help page and we will sort it out.' };
  }
  if (s.studio_access === 'invited' && !isDemo()) {
    if (!c) return { ok: false, reason: 'invite', message: 'Brandit Studio is open to invited customers at the moment. Sign in to see if you are on the list.' };
    const ids = [c.phone, c.email?.toLowerCase()].filter(Boolean) as string[];
    const hit = ids.length ? await one('select 1 as x from studio_invites where identifier = any($1)', [ids]) : null;
    if (!hit) return { ok: false, reason: 'invite', message: 'Brandit Studio is open to invited customers at the moment. Ask us on WhatsApp for an invite. It is free to be added.' };
  }
  return { ok: true };
}

export const tierOn = (s: Settings, t: Tier) => s.studio_enabled && runnable() && (t === 'premium' ? s.studio_premium_on : s.studio_standard_on);

/** The start of today in Lagos, as a UTC instant. */
export function lagosDayStart(now = new Date()): Date {
  return lagosDate(lagosParts(now).ymd, '00:00');
}
export function lagosWeekAgo(now = new Date()): Date {
  return new Date(now.getTime() - 7 * 24 * 3_600_000);
}
export function startOfLagosMonth(now = new Date()): Date {
  const p = lagosParts(now);
  return lagosDate(`${p.y}-${String(p.m).padStart(2, '0')}-01`, '00:00');
}
export { addDays };

/** Naira with the sign and thousands separators, from kobo. */
export const naira = (kobo: number) => `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`;

export async function studioPublicStatus(s: Settings) {
  return {
    enabled: s.studio_enabled && runnable(),
    standard: tierOn(s, 'standard'),
    premium: tierOn(s, 'premium'),
    prices: {
      standard: priceOf(s, 'standard'), premium: priceOf(s, 'premium'), upgrade: priceOf(s, 'upgrade'), pack3: priceOf(s, 'pack3'),
      roundStandard: priceOf(s, 'round', 'standard'), roundPremium: priceOf(s, 'round', 'premium'), vector: priceOf(s, 'vector'), check: priceOf(s, 'check'),
      creditStandard: s.studio_credit_standard_kobo, creditPremium: s.studio_credit_premium_kobo,
    },
  };
}
void query;
