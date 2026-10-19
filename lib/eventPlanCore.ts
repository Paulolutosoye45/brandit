/*
 * "Plan my event": the parts that need no database. An event is a date, a number of guests and a set of
 * printed things. We suggest sensible quantities from the guest count, the customer changes what they like,
 * and the whole plan goes to a person as one custom request with one price.
 */
export const EVENT_TYPES = [
  { key: 'wedding', label: 'Wedding', hint: 'Invitations, programmes, banners, souvenirs' },
  { key: 'birthday', label: 'Birthday or party', hint: 'Invitations, posters, a banner' },
  { key: 'funeral', label: 'Funeral or memorial', hint: 'Programmes and a portrait banner' },
  { key: 'church', label: 'Church or mosque event', hint: 'Programmes, flyers, banners' },
  { key: 'corporate', label: 'Company event or conference', hint: 'Roll-up banners, badges, flyers' },
  { key: 'school', label: 'School event', hint: 'Notices, posters, a banner' },
  { key: 'opening', label: 'Shop or business opening', hint: 'Flyers, a banner, stickers' },
  { key: 'other', label: 'Something else', hint: 'You choose what you need' },
] as const;
export type EventType = (typeof EVENT_TYPES)[number]['key'];
export const isEventType = (v: unknown): v is EventType => EVENT_TYPES.some((t) => t.key === v);
export const eventLabel = (k: string) => EVENT_TYPES.find((t) => t.key === k)?.label ?? 'Event';

export const roundUp = (n: number, step: number) => Math.ceil(n / step) * step;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export type ItemDef = {
  key: string;
  label: string;
  /** The product this is priced like. Null means the team prices it by hand. */
  slug: string | null;
  hint: string;
  unit: string;
  qty: (guests: number) => number;
  /** Event types that start with this ticked. */
  on: EventType[];
  /** Fixed size for products priced by square foot. */
  widthFt?: number; heightFt?: number;
};

export const ITEMS: ItemDef[] = [
  { key: 'invitations', label: 'Invitation cards', slug: 'flyers', hint: 'Sent to guests before the day. About one per two guests.', unit: 'cards', qty: (g) => clamp(roundUp(Math.ceil(g / 2), 10), 20, 5000), on: ['wedding', 'birthday'] },
  { key: 'programmes', label: 'Programmes or order of service', slug: 'flyers', hint: 'One for each guest.', unit: 'copies', qty: (g) => clamp(roundUp(g, 10), 20, 5000), on: ['wedding', 'funeral', 'church'] },
  { key: 'flyers', label: 'Flyers to hand out', slug: 'flyers', hint: 'To spread the word.', unit: 'flyers', qty: (g) => clamp(roundUp(g, 50), 100, 5000), on: ['church', 'school', 'opening', 'corporate'] },
  { key: 'posters', label: 'Posters', slug: 'posters', hint: 'For walls, gates and notice boards.', unit: 'posters', qty: () => 10, on: ['birthday', 'school', 'opening'] },
  { key: 'banner', label: 'Event banner (6 by 3 feet)', slug: 'flex-banners', hint: 'Hangs at the entrance or behind the stage.', unit: 'banner', qty: () => 1, on: ['wedding', 'birthday', 'funeral', 'church', 'school', 'opening'], widthFt: 6, heightFt: 3 },
  { key: 'rollup', label: 'Roll-up banner', slug: 'roll-up-banners', hint: 'Stands on its own. Good for a portrait or a welcome sign.', unit: 'banner', qty: () => 1, on: ['funeral', 'church', 'corporate'] },
  { key: 'tshirts', label: 'Branded T-shirts', slug: 'tees-and-totes', hint: 'For the family, the team or the crew.', unit: 'T-shirts', qty: (g) => clamp(roundUp(Math.ceil(g / 10), 5), 10, 500), on: [] },
  { key: 'souvenirs', label: 'Stickers or labels for souvenirs', slug: 'stickers', hint: 'One for each guest to seal a favour bag or bottle.', unit: 'stickers', qty: (g) => clamp(roundUp(g, 50), 50, 5000), on: ['wedding'] },
  { key: 'badges', label: 'Name badges', slug: 'id-cards', hint: 'For staff, hosts or speakers.', unit: 'badges', qty: (g) => clamp(roundUp(Math.ceil(g / 5), 5), 10, 500), on: ['corporate'] },
];
export const itemDef = (key: string) => ITEMS.find((i) => i.key === key);

export type PlanItem = { key: string; label: string; qty: number; slug: string | null; unit: string };
export type EventPlan = {
  type: EventType; typeLabel: string; date: string; guests: number;
  items: PlanItem[]; extra: string; notes: string;
};

/** The starting selection for an event: what is ticked, and how many of each. */
export function suggest(type: EventType, guests: number): Record<string, { on: boolean; qty: number }> {
  const g = clamp(Math.trunc(guests) || 0, 1, 20_000);
  return Object.fromEntries(ITEMS.map((i) => [i.key, { on: i.on.includes(type), qty: i.qty(g) }]));
}

export const EVENT_BUFFER_DAYS = 2; // we aim to deliver this many days before the event
export const MAX_GUESTS = 20_000;

const addDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
export { addDays };

/** The date we need the prints by: a couple of days before the event, but never in the past. */
export const needByFor = (eventYmd: string, todayYmd: string) => {
  const d = addDays(eventYmd, -EVENT_BUFFER_DAYS);
  return d < todayYmd ? todayYmd : d;
};

const niceDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-NG', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};
const shortDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-NG', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
};

export const planTitle = (p: Pick<EventPlan, 'typeLabel' | 'date'>) => `${p.typeLabel} on ${shortDate(p.date)}`.slice(0, 80);

/** The plain text a person reads in the console and a designer reads on the job. */
export function planDetails(p: EventPlan): string {
  const lines = [`${p.typeLabel} on ${niceDate(p.date)}. About ${p.guests} guest${p.guests === 1 ? '' : 's'}.`, ''];
  if (p.items.length) {
    lines.push('What they need:');
    for (const i of p.items) lines.push(`- ${i.label}: ${i.qty} ${i.unit}`);
  }
  if (p.extra) lines.push('', `Also needed: ${p.extra}`);
  if (p.notes) lines.push('', `Notes: ${p.notes}`);
  return lines.join('\n');
}

export type PlanInput = {
  type: unknown; date: unknown; guests: unknown; items: unknown; extra?: unknown; notes?: unknown;
};
export type PlanCheck = { ok: true; plan: EventPlan } | { ok: false; error: string; field?: string };

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '');

/**
 * Check what the customer sent. Labels, products and units always come from our own list, never from the form,
 * so a customer cannot put words in our mouth. `available` is the set of product slugs that are on sale.
 */
export function checkPlan(i: PlanInput, today: string, available: Set<string>): PlanCheck {
  if (!isEventType(i.type)) return { ok: false, error: 'Choose what kind of event it is.', field: 'type' };
  const date = text(i.date, 12);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return { ok: false, error: 'Pick the date of the event from the calendar.', field: 'date' };
  if (date <= today) return { ok: false, error: 'Pick a date after today. If it is today or tomorrow, message us on WhatsApp and we will see what is possible.', field: 'date' };
  if (date > addDays(today, 360)) return { ok: false, error: 'Pick a date within the next year.', field: 'date' };
  const guests = Math.trunc(Number(i.guests));
  if (!(guests >= 1 && guests <= MAX_GUESTS)) return { ok: false, error: 'How many guests do you expect? A rough number is fine.', field: 'guests' };

  const raw = Array.isArray(i.items) ? i.items : [];
  const seen = new Set<string>();
  const items: PlanItem[] = [];
  for (const r of raw) {
    const key = text((r as any)?.key, 30);
    const def = itemDef(key);
    if (!def || seen.has(key)) continue;
    const qty = Math.trunc(Number((r as any)?.qty));
    if (!(qty >= 1 && qty <= 100_000)) return { ok: false, error: `Enter how many “${def.label}” you need, as a whole number.`, field: `qty_${key}` };
    seen.add(key);
    items.push({ key, label: def.label, qty, slug: def.slug && available.has(def.slug) ? def.slug : null, unit: def.unit });
  }
  const extra = text(i.extra, 400);
  if (items.length === 0 && extra.length < 5) return { ok: false, error: 'Tick at least one thing you need, or describe it under “Anything else”.', field: 'items' };
  const type = i.type;
  return { ok: true, plan: { type, typeLabel: eventLabel(type), date, guests, items, extra, notes: text(i.notes, 600) } };
}

/** The nearest standard quantity at or above what was asked, for products priced by quantity. Null when it is beyond our list. */
export function snapQuantity(steps: number[], qty: number): number | null {
  if (steps.length === 0) return qty;
  const s = [...steps].sort((a, b) => a - b).find((x) => x >= qty);
  return s ?? null;
}
