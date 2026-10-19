import type { Condition, ExtraPer, OptionChoice, Package, ProductOption } from './types';

/*
 * The options editor works on a plain-text form of the options (amounts typed in naira, yes/no boxes), and this is the
 * one place that turns what is stored into that form. The server turns it back (lib/optionsAdmin.ts) and a test checks
 * the two agree for every product, so opening an editor and pressing Save never changes anything by accident.
 */

export type ChoiceIn = {
  value?: string;
  label: string;
  note?: string;
  swatch?: string;
  hidden?: boolean;
  /** Waiting for a price. Giving the choice any price, or saying "no charge", takes it off. */
  unpriced?: boolean;
  /** Carried through from what is stored; the server only keeps it if the choice had it already. */
  provisional?: boolean;
  amount?: string;
  per?: string;
  setup?: string;
  percent?: string;
  by?: { key: string; amounts: Record<string, string> } | null;
  cost?: string;
  costPer?: string;
  only_if?: Condition | null;
  min_qty?: string;
  max_qty?: string;
  price_like?: string;
  w_in?: string;
  h_in?: string;
};

export type OptionIn = {
  key?: string;
  label: string;
  help?: string;
  kind?: string;
  special?: boolean;
  drives?: boolean;
  default?: string;
  /** Choose one: which choice (by position in the list) is picked to start with. */
  defaultIndex?: number;
  /** Tick any: which choices (by position) start ticked. */
  defaultIndexes?: number[];
  /** Count of each: the starting number for each choice (by position). */
  defaultCounts?: string[];
  only_if?: Condition | null;
  auto?: { min_qty: string; value: string }[] | null;
  positions?: boolean;
  choices: ChoiceIn[];
};

const plain = (k: number | undefined | null) => (k == null ? '' : String(k / 100));

export function choiceToInput(c: OptionChoice): ChoiceIn {
  return {
    value: c.value,
    label: c.label,
    note: c.note ?? '',
    swatch: c.swatch ?? '',
    hidden: !!c.hidden,
    unpriced: !!c.unpriced,
    provisional: !!c.provisional,
    amount: plain(c.extra_kobo),
    per: (c.extra_per ?? 'order') as ExtraPer,
    setup: plain(c.setup_kobo),
    percent: c.percent ? String(c.percent) : '',
    by: c.by ? { key: c.by.key, amounts: Object.fromEntries(Object.entries(c.by.amounts).map(([k, v]) => [k, plain(v)])) } : null,
    cost: plain(c.cost_kobo),
    costPer: c.cost_per ?? c.extra_per ?? 'order',
    only_if: c.only_if ?? null,
    min_qty: c.min_qty ? String(c.min_qty) : '',
    max_qty: c.max_qty ? String(c.max_qty) : '',
    price_like: c.price_like ?? '',
    w_in: c.w_in ? String(c.w_in) : '',
    h_in: c.h_in ? String(c.h_in) : '',
  };
}

export function optionsToInput(options: ProductOption[]): OptionIn[] {
  return options.map((o) => {
    const kind = o.kind ?? 'pick';
    const ticked = kind === 'tick' ? o.default.split(',').filter(Boolean) : [];
    const counts: Record<string, string> = {};
    if (kind === 'split') for (const part of o.default.split(',').filter(Boolean)) { const [k, n] = part.split(':'); counts[k] = n; }
    return {
    key: o.key,
    label: o.label,
    help: o.help ?? '',
    kind: o.kind ?? 'pick',
    special: o.group === 'special',
    drives: !!o.drives,
    default: o.default,
    defaultIndex: kind === 'pick' ? Math.max(0, o.choices.findIndex((c) => c.value === o.default)) : undefined,
    defaultIndexes: kind === 'tick' ? o.choices.map((c, i) => (ticked.includes(c.value) ? i : -1)).filter((i) => i >= 0) : undefined,
    defaultCounts: kind === 'split' ? o.choices.map((c) => counts[c.value] ?? '') : undefined,
    only_if: o.only_if ?? null,
    auto: o.auto ? o.auto.map((a) => ({ min_qty: String(a.min_qty), value: a.value })) : null,
    positions: o.role === 'positions',
    choices: o.choices.map(choiceToInput),
    };
  });
}

export type PackageForm = { key?: string; label: string; tagline: string; badge: string; set: Record<string, string> };
export const packagesToInput = (packages: Package[]): PackageForm[] => packages.map((p) => ({ key: p.key, label: p.label, tagline: p.tagline ?? '', badge: p.badge ?? '', set: { ...p.set } }));
