import { addWorkingDays, lagosDate, productionDay, type Calendar } from './time';

export type Reason = 'PRODUCT' | 'QUANTITY' | 'AREA' | 'SIZE' | 'FINISH' | 'ZONE' | 'PAUSED' | 'FULL';

export type PromiseRule = {
  eligible_24h: boolean;
  max_quantity: number | null;
  max_area_sqft: number | null;
  max_size_rank: number | null;
  excluded_choices: string[];
  standard_days: number;
};

export type PromiseSettings = Calendar & {
  cutoff_time: string;
  arrive_by: string;
  daily_24h_slots: number;
  slots_paused: boolean;
};

export type PromiseInput = {
  rule: PromiseRule;
  settings: PromiseSettings;
  zoneEligible24h: boolean;
  pickup: boolean;
  quantity: number;
  totalAreaSqft: number | null;
  sizeRank: number | null;
  choices: string[];      // "key:value" pairs the customer picked
  slotsUsed: number;      // 24-hour jobs already promised for the production day
  now: Date;
};

export type PromiseResult = {
  tier: '24h' | 'standard';
  productionDay: string;
  cutoffAt: Date;
  arriveBy: Date;
  reasons: Reason[];
  slotsLeft: number;
};

/**
 * One rule decides whether a job gets the 24-hour promise. Every check must pass at the
 * moment the customer is looking; otherwise they get the standard date and the reasons,
 * so the page can tell them how to qualify.
 */
export function promise(i: PromiseInput): PromiseResult {
  const { rule, settings: s } = i;
  const reasons: Reason[] = [];

  if (!rule.eligible_24h) reasons.push('PRODUCT');
  if (rule.max_quantity != null && i.quantity > rule.max_quantity) reasons.push('QUANTITY');
  if (rule.max_area_sqft != null && (i.totalAreaSqft ?? 0) > rule.max_area_sqft) reasons.push('AREA');
  if (rule.max_size_rank != null && i.sizeRank != null && i.sizeRank > rule.max_size_rank) reasons.push('SIZE');
  if (i.choices.some((c) => rule.excluded_choices.includes(c))) reasons.push('FINISH');
  if (!i.pickup && !i.zoneEligible24h) reasons.push('ZONE');
  if (s.slots_paused) reasons.push('PAUSED');

  const day = productionDay(i.now, s);
  const slotsLeft = Math.max(0, s.daily_24h_slots - i.slotsUsed);
  if (slotsLeft === 0) reasons.push('FULL');

  const cutoffAt = lagosDate(day, s.cutoff_time);

  if (reasons.length === 0) {
    return {
      tier: '24h',
      productionDay: day,
      cutoffAt,
      arriveBy: lagosDate(addWorkingDays(day, 1, s), s.arrive_by),
      reasons,
      slotsLeft,
    };
  }
  return {
    tier: 'standard',
    productionDay: day,
    cutoffAt,
    arriveBy: lagosDate(addWorkingDays(day, rule.standard_days, s), s.arrive_by),
    reasons,
    slotsLeft,
  };
}

/** The combined promise for an order is the slowest of its items. */
export function slowest(results: PromiseResult[]): PromiseResult {
  return results.reduce((a, b) => (b.arriveBy > a.arriveBy ? b : a));
}
