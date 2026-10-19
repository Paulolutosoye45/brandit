export type PricingMode = 'tier' | 'area' | 'size';
export type CheckClass = 'print' | 'photo' | 'large';

/**
 * How a choice adds to the price.
 *  order     once per order
 *  piece     once per piece (for sizes of a garment: once per piece of that size)
 *  sqft      once per square foot (banners)
 *  foot      once per running foot around the edge of a banner
 *  position  once per piece for every print position ticked (front, back, sleeve...)
 */
export type ExtraPer = 'order' | 'piece' | 'sqft' | 'foot' | 'position';

/** "Only when": option key (or "size") mapped to the values that satisfy it. A ticked list is satisfied by any one of them. */
export type Condition = Record<string, string[]>;

export type OptionChoice = {
  value: string;
  label: string;
  /** What this choice adds. Can be negative for a saving, such as one side instead of two. */
  extra_kobo?: number;
  extra_per?: ExtraPer;
  /** A one-time charge on top, such as the setup for foil. */
  setup_kobo?: number;
  /** A percentage of the price so far, such as 24-hour printing. */
  percent?: number;
  /** An amount that depends on another choice or the size, such as mounting by poster size. Replaces extra_kobo. */
  by?: { key: string; amounts: Record<string, number> };
  /** What this choice costs Brandit. Never shown to customers; the console uses it to warn about thin margins. */
  cost_kobo?: number;
  cost_per?: ExtraPer;
  /** Available only while these other choices are made, such as foil only with lamination. */
  only_if?: Condition;
  min_qty?: number;
  max_qty?: number;
  /** Switched off in the console: customers do not see it. */
  hidden?: boolean;
  /** Waiting for a price from the owner: customers do not see it until one is set. */
  unpriced?: boolean;
  /** A stand-in price that has not been confirmed (shown in the console as a placeholder). */
  provisional?: boolean;
  /** For a choice that picks the base price table: use the table of another choice (gloss and matte of the same paper). */
  price_like?: string;
  /** The print size this choice means, in inches, for the file sharpness check. */
  w_in?: number;
  h_in?: number;
  swatch?: string;
  note?: string;
};

export type OptionKind = 'pick' | 'tick' | 'split';

export type ProductOption = {
  key: string;
  label: string;
  default: string;
  choices: OptionChoice[];
  help?: string;
  /** pick: one choice. tick: any number of choices. split: a count for each choice, such as garment sizes. */
  kind?: OptionKind;
  /** main options are always visible; special ones are folded under "Make it special". */
  group?: 'main' | 'special';
  /** The base price table has a column for each choice of this option. */
  drives?: boolean;
  /** This option applies only while these other choices are made (tote bag options for a tote). */
  only_if?: Condition;
  /** Choose by quantity when the customer has not chosen: the choice of the largest min_qty that fits. */
  auto?: { min_qty: number; value: string }[];
  /** Ticking choices of this option are print positions; "position" extras count them. */
  role?: 'positions';
};

/** One tap that sets several options at once. */
export type Package = { key: string; label: string; tagline?: string; badge?: string; set: Record<string, string> };

/** Whether a customer may type a quantity between the steps, and the limits. */
export type QuantityRule = { custom: boolean; min: number | null; max: number | null };

export type SizeOption = { key: string; label: string; w_in: number; h_in: number };

export type Product = {
  id: string;
  slug: string;
  name: string;
  blurb: string;
  pricing_mode: PricingMode;
  options: ProductOption[];
  sizes: SizeOption[];
  print_w_in: number | null;
  print_h_in: number | null;
  check_class: CheckClass;
  active: boolean;
  sort: number;
  description: string;
  highlights: string[];
  category: string;
  allow_custom: boolean;
  packages: Package[];
  qty_custom: boolean;
  qty_min: number | null;
  qty_max: number | null;
  /** Takes a list of names, one per piece (ID cards, name tees). */
  personalise: boolean;
  /** The sample pack: nothing to print, and its price comes back as credit. */
  sample: boolean;
};

export type Zone = { id: string; name: string; areas: string[]; fee_kobo: number; eligible_24h: boolean; sort: number; provisional: boolean };

export const STAGES = ['paid', 'file_check', 'proof', 'printing', 'quality_check', 'out_for_delivery', 'delivered'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  paid: 'Paid',
  file_check: 'File check',
  proof: 'Proof',
  printing: 'Printing',
  quality_check: 'Quality check',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
};

export type Role = 'admin' | 'production_lead' | 'file_desk' | 'support' | 'dispatcher' | 'partner_press';
export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  production_lead: 'Production lead',
  file_desk: 'File desk',
  support: 'Support',
  dispatcher: 'Dispatcher',
  partner_press: 'Partner press',
};
