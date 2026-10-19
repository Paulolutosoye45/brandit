import type { Condition, ExtraPer, OptionChoice, ProductOption } from './types';

/*
 * What a customer's choices mean. No database and no prices here: this decides which choices are allowed together,
 * what they add up to, and how a button should read. The same code runs on the server (which is the only place a
 * price is ever decided) and in the browser (which only uses it to grey out choices and explain why).
 */

export const MAX_PIECES = 10000;

const list = (v: string | undefined | null): string[] => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

/** "s:2,m:3" -> { s: 2, m: 3 }. Anything that is not a positive whole number is ignored. */
export function parseSplit(raw: string | undefined | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of list(raw)) {
    const [k, n] = part.split(':');
    const c = Math.trunc(Number(n));
    if (k && c > 0) out[k] = Math.min(MAX_PIECES, (out[k] ?? 0) + c);
  }
  return out;
}
export function formatSplit(counts: Record<string, number>, order: string[]): string {
  return order.filter((k) => (counts[k] ?? 0) > 0).map((k) => `${k}:${counts[k]}`).join(',');
}

/**
 * Share a total out in the same proportions as `counts`, in whole pieces that add up exactly (largest remainder).
 * Used when something asks for "10 T-shirts" without saying which sizes: the usual mix of sizes is scaled to 10.
 */
export function scaleSplit(counts: Record<string, number>, total: number): Record<string, number> {
  const keys = Object.keys(counts);
  const sum = keys.reduce((a, k) => a + counts[k], 0);
  const want = Math.max(0, Math.min(MAX_PIECES, Math.trunc(total)));
  if (!keys.length || !sum || !want) return {};
  const raw = keys.map((k, i) => ({ k, i, exact: (counts[k] * want) / sum }));
  const out: Record<string, number> = {};
  let left = want;
  for (const r of raw) { out[r.k] = Math.floor(r.exact); left -= out[r.k]; }
  for (const r of [...raw].sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)) || a.i - b.i)) {
    if (left <= 0) break;
    out[r.k] += 1;
    left -= 1;
  }
  return out;
}

export const kindOf = (o: ProductOption) => o.kind ?? 'pick';
/** Switched on and priced. A choice that is hidden, or still waiting for a price, is not offered. */
export const sellable = (c: OptionChoice) => !c.hidden && !c.unpriced;

/** The values picked in an option, from the stored text. */
export function selectedOf(o: ProductOption, raw: string | undefined): string[] {
  if (raw === undefined || raw === '') return [];
  const k = kindOf(o);
  if (k === 'tick') return list(raw);
  if (k === 'split') return Object.keys(parseSplit(raw));
  return [raw];
}

type Getter = (key: string) => string[];

/** Every named option must have one of the allowed values picked. */
export function satisfies(cond: Condition | undefined, get: Getter): boolean {
  if (!cond) return true;
  return Object.entries(cond).every(([k, allowed]) => get(k).some((v) => allowed.includes(v)));
}

export type SelectionInput = { config?: Record<string, string> | null; sizeKey?: string | null; quantity: number };
export type SelectionOptions = {
  /** The console tries prices for choices that customers cannot see yet. */
  preview?: boolean;
  /**
   * True when a price table has room for this choice alongside the choices made so far. "Best for your quantity" uses it
   * so that it never picks a method (or a card, or a size) that has no price, when another one does.
   */
  usable?: (key: string, value: string, soFar: Record<string, string>) => boolean;
};

export type Selection = {
  /** What is saved with the order: the customer's choices, cleaned. An "auto" choice stays "auto". */
  config: Record<string, string>;
  /** The same with "auto" replaced by the choice it meant. Price tables are looked up with this. */
  effective: Record<string, string>;
  /** The total of a split option (garment sizes), or null when the product has none. */
  quantity: number | null;
  /** Sentences for the customer when we had to change something. */
  notes: string[];
  /** The options that apply to this selection. */
  active: ProductOption[];
};

function needText(cond: Condition, options: ProductOption[]): string {
  const parts = Object.entries(cond).map(([k, vals]) => {
    const o = options.find((x) => x.key === k);
    const names = vals.map((v) => o?.choices.find((c) => c.value === v)?.label ?? v);
    return `${o ? o.label.toLowerCase() : k === 'size' ? 'size' : k}: ${names.join(' or ')}`;
  });
  return parts.join(' and ');
}

function whyNot(c: OptionChoice, options: ProductOption[], get: Getter, qty: number, preview: boolean): string | null {
  if (!preview && !sellable(c)) return `${c.label} is not available right now`;
  if (!satisfies(c.only_if, get)) return `${c.label} needs ${needText(c.only_if!, options)}`;
  if (c.min_qty != null && qty < c.min_qty) return `${c.label} needs at least ${c.min_qty.toLocaleString('en-US')} pieces`;
  if (c.max_qty != null && qty > c.max_qty) return `${c.label} is for up to ${c.max_qty.toLocaleString('en-US')} pieces`;
  return null;
}

function autoPick(o: ProductOption, qty: number, ok: (c: OptionChoice) => boolean): string | null {
  const rules = [...(o.auto ?? [])].sort((a, b) => b.min_qty - a.min_qty);
  for (const r of rules) {
    const c = o.choices.find((x) => x.value === r.value);
    if (qty >= r.min_qty && c && ok(c)) return c.value;
  }
  return o.choices.find((c) => c.value !== 'auto' && ok(c))?.value ?? null;
}

function step(options: ProductOption[], cond: Record<string, string>, raw: Record<string, string>, input: SelectionInput, opt: SelectionOptions, notes: string[]): Selection {
  const byKey = new Map(options.map((o) => [o.key, o]));
  const get: Getter = (key) => {
    const o = byKey.get(key);
    const v = cond[key];
    if (o && v !== undefined) return selectedOf(o, v);
    if (key === 'size' && !o && input.sizeKey) return [input.sizeKey];
    return [];
  };
  const preview = !!opt.preview;
  const active = options.filter((o) => satisfies(o.only_if, get));

  // Garment sizes decide the quantity, so they come first.
  const splits: Record<string, Record<string, number>> = {};
  let splitTotal: number | null = null;
  for (const o of active.filter((x) => kindOf(x) === 'split')) {
    // Sizes not given: use the usual mix of sizes, scaled to the quantity that was asked for.
    const given = raw[o.key] !== undefined ? parseSplit(raw[o.key]) : input.quantity >= 1 ? scaleSplit(parseSplit(o.default), input.quantity) : parseSplit(o.default);
    const kept: Record<string, number> = {};
    for (const [k, n] of Object.entries(given)) {
      const c = o.choices.find((x) => x.value === k);
      if (!c) continue;
      const why = whyNot(c, options, get, 0, preview);
      if (why) { notes.push(`${why}, so it was taken out.`); continue; }
      kept[k] = n;
    }
    splits[o.key] = kept;
    splitTotal = (splitTotal ?? 0) + Object.values(kept).reduce((a, b) => a + b, 0);
  }
  const qty = splitTotal ?? input.quantity;

  const config: Record<string, string> = {};
  const effective: Record<string, string> = {};
  for (const o of active) {
    const kind = kindOf(o);
    const avail = (c: OptionChoice) => whyNot(c, options, get, qty, preview) === null;

    if (kind === 'split') {
      const s = formatSplit(splits[o.key], o.choices.map((c) => c.value));
      config[o.key] = s;
      effective[o.key] = s;
      continue;
    }

    if (kind === 'tick') {
      const given = raw[o.key] !== undefined ? list(raw[o.key]) : list(o.default);
      const keep: string[] = [];
      for (const v of given) {
        const c = o.choices.find((x) => x.value === v);
        if (!c) continue;
        const why = whyNot(c, options, get, qty, preview);
        if (why) { if (raw[o.key] !== undefined) notes.push(`${why}, so it was taken off.`); continue; }
        if (!keep.includes(v)) keep.push(v);
      }
      const ordered = o.choices.map((c) => c.value).filter((v) => keep.includes(v)).join(',');
      config[o.key] = ordered;
      effective[o.key] = ordered;
      continue;
    }

    // pick
    const rawV = raw[o.key];
    if (o.auto?.length && (rawV === undefined || rawV === '' || rawV === 'auto')) {
      const picked = (opt.usable ? autoPick(o, qty, (c) => avail(c) && opt.usable!(o.key, c.value, effective)) : null) ?? autoPick(o, qty, avail);
      if (picked) { config[o.key] = 'auto'; effective[o.key] = picked; continue; }
    }
    const asked = rawV !== undefined && rawV !== '' ? o.choices.find((c) => c.value === rawV) : undefined;
    // A choice that picks the price table is only on sale when the table has a price for it (the console can still try it).
    const priceable = (c: OptionChoice) => preview || !o.drives || !opt.usable || opt.usable(o.key, c.value, effective);
    const availP = (c: OptionChoice) => avail(c) && priceable(c);
    if (asked) {
      const why = whyNot(asked, options, get, qty, preview) ?? (priceable(asked) ? null : `${asked.label} is not available right now`);
      if (!why) { config[o.key] = asked.value; effective[o.key] = asked.value; continue; }
      const fb = fallbackOf(o, availP) ?? fallbackOf(o, avail);
      notes.push(`${why}${fb ? `, so we chose ${fb.label} for ${o.label.toLowerCase()}` : ''}.`);
      if (fb) { config[o.key] = fb.value; effective[o.key] = fb.value; }
      continue;
    }
    const fb = fallbackOf(o, availP) ?? fallbackOf(o, avail);
    if (fb) { config[o.key] = fb.value; effective[o.key] = fb.value; }
  }
  return { config, effective, quantity: splitTotal, notes, active };
}

function fallbackOf(o: ProductOption, avail: (c: OptionChoice) => boolean): OptionChoice | undefined {
  const d = o.choices.find((c) => c.value === o.default);
  if (d && d.value !== 'auto' && avail(d)) return d;
  return o.choices.find((c) => c.value !== 'auto' && avail(c));
}

/** Clean the customer's choices: drop what is not allowed together, fill in what is missing, work out "auto". */
export function resolveSelection(options: ProductOption[], input: SelectionInput, opt: SelectionOptions = {}): Selection {
  const raw = { ...(input.config ?? {}) } as Record<string, string>;
  let cond = raw;
  // Two quiet passes let choices settle (a swap in one option can switch another on or off); the third one speaks.
  for (let i = 0; i < 2; i++) cond = step(options, cond, raw, input, opt, []).effective;
  const notes: string[] = [];
  const sel = step(options, cond, raw, input, opt, notes);
  return { ...sel, notes: [...new Set(notes)] };
}

/** The config the price table is looked up with: choices that share another choice's table are swapped for it. */
export function ruleConfig(options: ProductOption[], effective: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...effective };
  for (const o of options) {
    const v = effective[o.key];
    if (v === undefined || kindOf(o) !== 'pick') continue;
    const like = o.choices.find((c) => c.value === v)?.price_like;
    if (like) out[o.key] = like;
  }
  return out;
}

// ---------- What choices add ----------
export type ExtraContext = {
  quantity: number;
  areaSqft: number | null;
  /** Running feet around all the banners together. */
  perimeterFt?: number | null;
  sizeKey?: string | null;
};
export type ExtraLine = {
  key: string;
  option: string;
  label: string;
  /** What it adds, in kobo. */
  kobo: number;
  /** What it costs us, or null when no cost is recorded. */
  costKobo: number | null;
  /** Plain words for the price breakdown: "₦25 × 100 cards". */
  how: string;
  setupKobo: number;
};
export type PercentLine = { key: string; option: string; label: string; percent: number };

function pickedChoices(o: ProductOption, effective: Record<string, string>): { c: OptionChoice; count: number }[] {
  const kind = kindOf(o);
  const raw = effective[o.key];
  if (raw === undefined || raw === '') return [];
  if (kind === 'split') {
    const counts = parseSplit(raw);
    return o.choices.filter((c) => counts[c.value]).map((c) => ({ c, count: counts[c.value] }));
  }
  const vals = kind === 'tick' ? list(raw) : [raw];
  return vals.map((v) => o.choices.find((c) => c.value === v)).filter((c): c is OptionChoice => !!c).map((c) => ({ c, count: 1 }));
}

const nairaText = (k: number) => `₦${(Math.abs(k) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

function timesOf(per: ExtraPer, sel: { count: number }, kind: string, ctx: ExtraContext, positions: number): { n: number; unit: string } {
  switch (per) {
    case 'piece': return { n: kind === 'split' ? sel.count : ctx.quantity, unit: 'piece' };
    case 'sqft': return { n: Math.ceil(ctx.areaSqft ?? 0), unit: 'sq ft' };
    case 'foot': return { n: Math.ceil(ctx.perimeterFt ?? 0), unit: 'ft' };
    case 'position': return { n: ctx.quantity * positions, unit: 'print' };
    default: return { n: 1, unit: 'order' };
  }
}

/** What the picked choices add to the price, line by line. Percent charges come back separately; they need the subtotal. */
export function extrasFor(active: ProductOption[], effective: Record<string, string>, ctx: ExtraContext): { lines: ExtraLine[]; percents: PercentLine[]; costComplete: boolean } {
  const lines: ExtraLine[] = [];
  const percents: PercentLine[] = [];
  let costComplete = true;
  const posOpt = active.find((o) => o.role === 'positions');
  const positions = posOpt ? Math.max(1, selectedOf(posOpt, effective[posOpt.key]).length) : 1;
  const valueOf = (key: string): string | undefined => {
    const o = active.find((x) => x.key === key);
    if (o) return selectedOf(o, effective[key])[0];
    if (key === 'size') return ctx.sizeKey ?? undefined;
    return undefined;
  };

  for (const o of active) {
    const kind = kindOf(o);
    for (const sel of pickedChoices(o, effective)) {
      const c = sel.c;
      const per: ExtraPer = c.extra_per ?? 'order';
      const amount = c.by ? (c.by.amounts[valueOf(c.by.key) ?? ''] ?? 0) : (c.extra_kobo ?? 0);
      const t = timesOf(per, sel, kind, ctx, positions);
      const base = Math.round(amount * t.n);
      const setup = Math.round(c.setup_kobo ?? 0);
      if (c.percent) percents.push({ key: `${o.key}:${c.value}`, option: o.label, label: c.label, percent: c.percent });

      // What it costs us, if the owner recorded it.
      const hasCost = c.cost_kobo != null;
      const cost = hasCost ? Math.round(c.cost_kobo! * timesOf(c.cost_per ?? per, sel, kind, ctx, positions).n) : null;
      const priced = base !== 0 || setup !== 0;
      if (priced && !hasCost) costComplete = false;
      if (priced || cost) {
        const how = per === 'order' ? '' : `${nairaText(amount)} × ${t.n.toLocaleString('en-US')}${per === 'piece' ? '' : ` ${t.unit}`}`;
        lines.push({
          key: `${o.key}:${c.value}`, option: o.label, label: kind === 'split' ? `${c.label} × ${sel.count}` : c.label,
          kobo: base + setup, costKobo: cost, how: [how, setup ? `${nairaText(setup)} setup` : ''].filter(Boolean).join(' + '), setupKobo: setup,
        });
      }
    }
  }
  return { lines, percents, costComplete };
}

/** The legacy single number: what the choices add, in kobo. */
export function surchargeKobo(active: ProductOption[], effective: Record<string, string>, ctx: ExtraContext): number {
  return extrasFor(active, effective, ctx).lines.reduce((a, l) => a + l.kobo, 0);
}

// ---------- Words for buttons ----------
const signed = (k: number) => (k < 0 ? '−' : '+');
const PER_WORD: Record<ExtraPer, string> = { order: '', piece: ' each', sqft: ' per sq ft', foot: ' per ft', position: ' each per print' };

/**
 * The small text on a choice button: "Included", "+₦2,500", "+₦25 each", "+20%", "−₦5 each".
 * It reads the amount that applies to the choices made now (mounting costs more on a bigger poster).
 */
export function choiceLabel(c: OptionChoice, ctx: { valueOf: (key: string) => string | undefined }, fmt: (kobo: number) => string = nairaText): string {
  const parts: string[] = [];
  const per = c.extra_per ?? 'order';
  const amount = c.by ? c.by.amounts[ctx.valueOf(c.by.key) ?? ''] : c.extra_kobo;
  if (amount) parts.push(`${signed(amount)}${fmt(Math.abs(amount))}${PER_WORD[per]}`);
  if (c.percent) parts.push(`${c.percent < 0 ? '−' : '+'}${Math.abs(c.percent)}%`);
  if (c.setup_kobo) parts.push(`${amount ? 'and ' : '+'}${fmt(c.setup_kobo)} setup`);
  return parts.join(' ');
}

// ---------- What each button should show right now ----------
export type ChoiceStatus = {
  /** Can be picked with the choices made now. */
  ok: boolean;
  /** Why not, in a sentence for the customer. */
  why: string | null;
  /** Switched off or waiting for a price: leave it out of the page altogether. */
  hide: boolean;
  /** "+₦2,500", "+₦25 each", or empty when it costs nothing extra. */
  price: string;
};

/**
 * For every choice of every option that applies: can it be picked with the other choices made now, and what does it add.
 * `sel` is the cleaned selection from resolveSelection.
 */
export function choiceStatus(options: ProductOption[], sel: Selection, input: SelectionInput, opt: SelectionOptions = {}, fmt?: (kobo: number) => string): Record<string, Record<string, ChoiceStatus>> {
  const byKey = new Map(options.map((o) => [o.key, o]));
  const get: Getter = (key) => {
    const o = byKey.get(key);
    const v = sel.effective[key];
    if (o && v !== undefined) return selectedOf(o, v);
    if (key === 'size' && !o && input.sizeKey) return [input.sizeKey];
    return [];
  };
  const qty = sel.quantity ?? input.quantity;
  const valueOf = (key: string) => get(key)[0];
  const out: Record<string, Record<string, ChoiceStatus>> = {};
  for (const o of sel.active) {
    const per: Record<string, ChoiceStatus> = {};
    for (const c of o.choices) {
      const hide = !opt.preview && !sellable(c);
      const why = hide ? null : whyNot(c, options, get, qty, !!opt.preview);
      per[c.value] = { ok: !hide && !why, why, hide, price: choiceLabel(c, { valueOf }, fmt) };
    }
    out[o.key] = per;
  }
  return out;
}
