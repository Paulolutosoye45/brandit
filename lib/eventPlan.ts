import { one } from './db';
import { listProducts, quantitySteps } from './catalog';
import { makeQuote } from './quote';
import { lagosParts } from './time';
import { createCustomRequest, type CreateResult, type RefFile } from './custom';
import { checkPlan, itemDef, needByFor, planDetails, planTitle, snapQuantity, ITEMS, type EventPlan, type PlanInput } from './eventPlanCore';

/** Product slugs that are on sale right now. */
export async function availableSlugs(): Promise<Set<string>> {
  return new Set((await listProducts()).map((p) => p.slug));
}

/** The items the form offers: only those whose product is on sale are priced; the rest are still listed and priced by hand. */
export async function offeredItems() {
  const have = await availableSlugs();
  return ITEMS.map((i) => ({ key: i.key, label: i.label, hint: i.hint, unit: i.unit, priced: !!i.slug && have.has(i.slug) }));
}

export type Contact = { name: string; phone: string; email?: string };

/** Turn a filled-in plan into one custom request that a person prices as a whole. */
export async function createEventPlan(input: PlanInput, contact: Contact, files: RefFile[], customerId?: string | null): Promise<CreateResult> {
  const today = lagosParts(new Date()).ymd;
  const checked = checkPlan(input, today, await availableSlugs());
  if (!checked.ok) return checked;
  const plan = checked.plan;
  const r = await createCustomRequest(
    {
      productSlug: null, name: contact.name, phone: contact.phone, email: contact.email,
      title: planTitle(plan), details: planDetails(plan),
      quantityText: `${plan.items.length} item${plan.items.length === 1 ? '' : 's'}`, needBy: needByFor(plan.date, today),
    },
    files, customerId,
    { kind: 'event', plan },
  );
  return r;
}

export type EstimateRow = { key: string; kobo: number | null; forQty: number | null };

/**
 * A rough print price for each item, from the same price list the shop uses. It is a guide, not the quote:
 * it leaves out design, delivery and anything special, and a quantity beyond our list gets no number.
 */
export async function estimatePlan(items: { key: string; qty: number }[]): Promise<{ rows: EstimateRow[]; totalKobo: number; complete: boolean }> {
  const have = await availableSlugs();
  const rows: EstimateRow[] = [];
  let total = 0;
  let complete = true;
  for (const it of items.slice(0, ITEMS.length)) {
    const def = itemDef(it.key);
    const qty = Math.trunc(Number(it.qty));
    if (!def || !def.slug || !have.has(def.slug) || !(qty >= 1 && qty <= 100_000)) { if (def) rows.push({ key: it.key, kobo: null, forQty: null }); complete = false; continue; }
    const prod = await one<{ id: string; pricing_mode: string }>('select id, pricing_mode from products where slug = $1', [def.slug]);
    let q = qty;
    if (prod?.pricing_mode === 'tier') {
      const snapped = snapQuantity(await quantitySteps(prod.id), qty);
      if (snapped == null) { rows.push({ key: it.key, kobo: null, forQty: null }); complete = false; continue; }
      q = snapped;
    }
    const quote = await makeQuote({ slug: def.slug, quantity: q, widthFt: def.widthFt, heightFt: def.heightFt });
    if (!quote.ok) { rows.push({ key: it.key, kobo: null, forQty: null }); complete = false; continue; }
    // priceKobo already includes any add-ons.
    rows.push({ key: it.key, kobo: quote.priceKobo, forQty: q });
    total += quote.priceKobo;
  }
  return { rows, totalKobo: total, complete: complete && rows.length > 0 };
}

export const planOf = (r: { event_plan?: unknown }): EventPlan | null => {
  const p = r.event_plan as any;
  return p && typeof p === 'object' && Array.isArray(p.items) ? (p as EventPlan) : null;
};

export async function eventPlanStats(days = 30) {
  const r = await one<{ n: number; won: number }>(
    `select count(*)::int as n, count(*) filter (where status = 'accepted')::int as won from custom_requests where kind = 'event' and created_at > now() - ($1 || ' days')::interval`,
    [String(days)],
  );
  return { requests: r?.n ?? 0, accepted: r?.won ?? 0 };
}
