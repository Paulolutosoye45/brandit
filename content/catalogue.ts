import type { CheckClass, OptionChoice, Package, PricingMode, ProductOption, QuantityRule, SizeOption } from '../lib/types';

/*
 * The Brandit catalogue, version 2: every product's options, packages and price tables.
 *
 * Three kinds of number, and the console says which is which:
 *  - real: the prices the shop already has today (`known`). These are the only prices on the real site.
 *  - example: made-up numbers (`examples`) that make every table and add-on work, so the whole catalogue can be seen,
 *    tried and tested. They appear in demo mode and on the test site (when you press "Fill in example prices"),
 *    always marked as placeholders, and NEVER on the real site.
 *  - missing: everything else. A choice with no real price is left out of the shop until you give it one ("ask": true),
 *    and a price table with no cell for a choice leaves that choice out too.
 *
 * Nothing here is advice about what to charge. The numbers are shaped like a Lagos print shop's, not taken from one.
 */

const N = (n: number) => Math.round(n * 100);

export type Ex = Pick<OptionChoice, 'extra_kobo' | 'extra_per' | 'setup_kobo' | 'percent' | 'by'>;
/** A choice as the catalogue writes it: `ask` means it needs a price from the owner before customers see it; `ex` is an example price. */
export type PackChoice = OptionChoice & { ex?: Ex; ask?: boolean };
export type PackOption = Omit<ProductOption, 'choices'> & { choices: PackChoice[] };

export type Cell = {
  quantity?: number;
  size_key?: string;
  config: Record<string, string>;
  price_kobo?: number;
  rate_per_sqft_kobo?: number;
  min_area_sqft?: number;
};

export type LegacyRule = { quantity: number | null; size_key: string | null; price_kobo: number | null; rate_per_sqft_kobo: number | null; config: Record<string, string> };

export type PackProduct = {
  slug: string;
  /** Older slugs this product used to have; an existing database is upgraded in place. */
  aliases?: string[];
  name: string;
  blurb: string;
  mode: PricingMode;
  cls: CheckClass;
  printW?: number;
  printH?: number;
  options: PackOption[];
  sizes: SizeOption[];
  packages: Package[];
  qty: QuantityRule;
  /** Takes a list of names, one per piece. */
  personalise?: boolean;
  promise: { max_quantity?: number; max_area_sqft?: number; max_size_rank?: number; excluded?: string[] };
  known: Cell[];
  examples: () => Cell[];
  /** Where a price saved by an older version belongs in the new tables. Null leaves it out. */
  legacy: (r: LegacyRule) => { quantity?: number | null; size_key?: string | null; config: Record<string, string> } | null;
};

// ---------- small helpers ----------
/** A choice. `ex` is an example price; `ask` marks a choice that waits for the owner's real price. */
const c = (value: string, label: string, rest: Partial<PackChoice> = {}): PackChoice => ({ value, label, ...rest });
const priced = (value: string, label: string, ex: Ex, rest: Partial<PackChoice> = {}): PackChoice => ({ value, label, ask: true, ex, ...rest });
const piece = (kobo: number): Ex => ({ extra_kobo: kobo, extra_per: 'piece' });
const order = (kobo: number): Ex => ({ extra_kobo: kobo, extra_per: 'order' });

function combos(axes: Record<string, string[]>): Record<string, string>[] {
  let out: Record<string, string>[] = [{}];
  for (const [k, vals] of Object.entries(axes)) out = out.flatMap((o) => vals.map((v) => ({ ...o, [k]: v })));
  return out;
}
/** Round an example price to the nearest ₦500 (or ₦100 when it is small), never to zero. */
const tidy = (kobo: number) => {
  const step = kobo >= N(10000) ? N(500) : N(100);
  return Math.max(step, Math.round(kobo / step) * step);
};

// =====================================================================================================================
// Business cards
// =====================================================================================================================
const CARD_QTY = [50, 100, 200, 250, 500, 1000];
const CARD_QF: Record<number, number> = { 50: 1.15, 100: 1, 200: 0.92, 250: 0.9, 500: 0.8, 1000: 0.7 };
const CARD_MULT: Record<string, number> = { std300: 1, prem350: 1.25, thick600: 1.9, lux700: 2.4, linen: 1.5, kraft: 1.35 };
const LAMINATABLE = ['std300', 'prem350', 'thick600', 'lux700'];

const businessCards: PackProduct = {
  slug: 'business-cards',
  name: 'Business cards',
  blurb: 'Thick 300gsm card, printed on both sides.',
  mode: 'tier',
  cls: 'print',
  printW: 3.5,
  printH: 2,
  sizes: [],
  qty: { custom: true, min: 50, max: 5000 },
  options: [
    {
      key: 'card', label: 'Card', default: 'std300', drives: true, help: 'Every card has its own price.',
      choices: [
        c('std300', 'Standard 300gsm'), c('prem350', 'Premium 350gsm'), c('thick600', 'Super thick 600gsm', { note: 'Two cards bonded together' }),
        c('lux700', 'Luxury 700gsm'), c('linen', 'Textured linen'), c('kraft', 'Kraft'),
      ],
    },
    { key: 'sides', label: 'Printed sides', default: 'both', choices: [c('both', 'Both sides'), priced('one', 'One side only', piece(-N(5)))] },
    {
      key: 'lamination', label: 'Lamination', default: 'matte', only_if: { card: LAMINATABLE },
      choices: [c('matte', 'Matte'), c('gloss', 'Gloss'), priced('soft', 'Soft-touch (velvet)', piece(N(8))), priced('none', 'None', piece(-N(2)))],
    },
    {
      key: 'finishing', label: 'Make it special', kind: 'tick', group: 'special', default: '',
      choices: [
        priced('round', 'Rounded corners', piece(N(6))),
        priced('spotuv', 'Spot UV, one side', { extra_kobo: N(14), extra_per: 'piece', setup_kobo: N(8000) }, { only_if: { lamination: ['matte', 'soft'] } }),
        priced('foil_gold', 'Gold foil, one side', { extra_kobo: N(18), extra_per: 'piece', setup_kobo: N(10000) }, { only_if: { lamination: ['matte', 'gloss', 'soft'] } }),
        priced('foil_silver', 'Silver foil, one side', { extra_kobo: N(18), extra_per: 'piece', setup_kobo: N(10000) }, { only_if: { lamination: ['matte', 'gloss', 'soft'] } }),
        priced('edges', 'Coloured edges', piece(N(12)), { only_if: { card: ['thick600', 'lux700'] } }),
      ],
    },
  ],
  packages: [
    { key: 'standard', label: 'Standard', tagline: '300gsm card, matte', set: { card: 'std300', lamination: 'matte', finishing: '' } },
    { key: 'premium', label: 'Premium', tagline: '350gsm card, matte lamination', set: { card: 'prem350', lamination: 'matte', finishing: '' } },
    { key: 'luxury', label: 'Luxury', tagline: '600gsm, soft-touch, rounded corners, gold foil', set: { card: 'thick600', lamination: 'soft', finishing: 'round,foil_gold' } },
  ],
  promise: { max_quantity: 500, excluded: ['finishing:spotuv', 'finishing:foil_gold', 'finishing:foil_silver', 'finishing:edges', 'card:thick600', 'card:lux700', 'lamination:soft'] },
  known: [{ quantity: 100, config: { card: 'std300' }, price_kobo: N(15000) }],
  examples: () => Object.keys(CARD_MULT).flatMap((card) => CARD_QTY.map((q) => ({ quantity: q, config: { card }, price_kobo: tidy(N(150) * CARD_MULT[card] * q * CARD_QF[q]) }))),
  legacy: (r) => (r.quantity != null ? { quantity: r.quantity, config: { card: 'std300' } } : null),
};

// =====================================================================================================================
// Flyers and handbills
// =====================================================================================================================
const FLYER_QTY = [50, 100, 250, 500, 1000, 2500, 5000];
const FLYER_QF: Record<number, number> = { 50: 1.2, 100: 1, 250: 0.82, 500: 0.66, 1000: 0.52, 2500: 0.4, 5000: 0.33 };
const FLYER_SIZE: Record<string, number> = { a6: 0.55, a5: 1, a4: 1.8, dl: 0.8 };
const FLYER_PAPER: Record<string, number> = { g115: 0.8, g150: 1, s170: 1.2, c250: 2.2, c300: 2.7 };

const flyers: PackProduct = {
  slug: 'flyers',
  name: 'Flyers',
  blurb: 'A5, single-sided, 150gsm.',
  mode: 'tier',
  cls: 'print',
  printW: 5.83,
  printH: 8.27,
  sizes: [],
  qty: { custom: true, min: 50, max: 5000 },
  options: [
    {
      key: 'size', label: 'Size', default: 'a5', drives: true,
      choices: [c('a6', 'A6', { w_in: 4.13, h_in: 5.83 }), c('a5', 'A5', { w_in: 5.83, h_in: 8.27 }), c('a4', 'A4', { w_in: 8.27, h_in: 11.69 }), c('dl', 'DL (a third of A4)', { w_in: 3.86, h_in: 8.27 })],
    },
    {
      key: 'paper', label: 'Paper', default: 'g150', drives: true,
      choices: [
        c('g115', '115gsm gloss (budget)'), c('g150', '150gsm gloss'), c('m150', '150gsm matte', { price_like: 'g150' }),
        c('s170', '170gsm silk'), c('c250', '250gsm card'), c('c300', '300gsm card'),
      ],
    },
    { key: 'sides', label: 'Printed sides', default: 'one', choices: [c('one', 'One side'), priced('both', 'Both sides', piece(N(40)))] },
    {
      key: 'lamination', label: 'Make it special: lamination', group: 'special', default: 'none',
      choices: [c('none', 'None'), priced('matte', 'Matte', piece(N(25)), { only_if: { paper: ['c250', 'c300'] } }), priced('gloss', 'Gloss', piece(N(25)), { only_if: { paper: ['c250', 'c300'] } })],
    },
    {
      key: 'folding', label: 'Make it special: folding', group: 'special', default: 'none', only_if: { size: ['a4'] },
      choices: [c('none', 'No fold'), priced('half', 'Half fold', piece(N(15))), priced('tri', 'Tri-fold', piece(N(20)))],
    },
  ],
  packages: [
    { key: 'budget', label: 'Budget', tagline: '115gsm gloss, one side', set: { paper: 'g115', sides: 'one', lamination: 'none' } },
    { key: 'standard', label: 'Standard', tagline: '150gsm gloss, one side', set: { paper: 'g150', sides: 'one', lamination: 'none' } },
    { key: 'premium', label: 'Premium', tagline: '170gsm silk, both sides', set: { paper: 's170', sides: 'both', lamination: 'none' } },
  ],
  promise: { max_quantity: 1000, excluded: ['folding:half', 'folding:tri', 'lamination:matte', 'lamination:gloss'] },
  known: [{ quantity: 100, config: { size: 'a5', paper: 'g150' }, price_kobo: N(25500) }],
  examples: () =>
    combos({ size: Object.keys(FLYER_SIZE), paper: Object.keys(FLYER_PAPER) }).flatMap((cfg) =>
      FLYER_QTY.map((q) => ({ quantity: q, config: cfg, price_kobo: tidy(N(255) * FLYER_SIZE[cfg.size] * FLYER_PAPER[cfg.paper] * q * FLYER_QF[q]) })),
    ),
  legacy: (r) => (r.quantity != null ? { quantity: r.quantity, config: { size: 'a5', paper: 'g150' } } : null),
};

// =====================================================================================================================
// Posters
// =====================================================================================================================
const POSTER_QTY = [1, 5, 10, 50, 100];
const POSTER_QF: Record<number, number> = { 1: 2.2, 5: 1.7, 10: 1.5, 50: 1.15, 100: 1 };
const POSTER_SIZE: Record<string, number> = { a3: 1, a2: 1.8, a1: 3.2, a0: 5.5 };
const bySize = (a3: number, a2: number, a1: number, a0: number) => ({ key: 'size', amounts: { a3: N(a3), a2: N(a2), a1: N(a1), a0: N(a0) } });

const posters: PackProduct = {
  slug: 'posters',
  name: 'Posters',
  blurb: 'A3, 150gsm. Orders from 1, where others start at 100.',
  mode: 'tier',
  cls: 'photo',
  printW: 11.7,
  printH: 16.5,
  sizes: [],
  qty: { custom: true, min: 1, max: 1000 },
  options: [
    {
      key: 'size', label: 'Size', default: 'a3', drives: true,
      choices: [c('a3', 'A3', { w_in: 11.7, h_in: 16.5 }), c('a2', 'A2', { w_in: 16.5, h_in: 23.4 }), c('a1', 'A1', { w_in: 23.4, h_in: 33.1 }), c('a0', 'A0', { w_in: 33.1, h_in: 46.8 })],
    },
    {
      key: 'paper', label: 'Paper', default: 'g150',
      choices: [
        c('g150', '150gsm gloss'),
        priced('satin200', '200gsm satin', { extra_per: 'piece', by: bySize(150, 300, 550, 1000) }, { by: { key: 'size', amounts: {} } }),
        priced('photo', 'Photo paper', { extra_per: 'piece', by: bySize(400, 800, 1500, 2800) }, { by: { key: 'size', amounts: {} } }),
      ],
    },
    {
      key: 'lamination', label: 'Make it special: lamination', group: 'special', default: 'none',
      choices: [c('none', 'None'), priced('matte', 'Matte', piece(N(150))), priced('gloss', 'Gloss', piece(N(150)))],
    },
    {
      key: 'mounting', label: 'Make it special: mounting', group: 'special', default: 'none',
      choices: [c('none', 'No mounting'), priced('foam', 'Foam board', { extra_per: 'piece', by: bySize(800, 1500, 2800, 5000) }, { by: { key: 'size', amounts: {} } })],
    },
  ],
  packages: [
    { key: 'standard', label: 'Standard', tagline: '150gsm gloss', set: { paper: 'g150', lamination: 'none', mounting: 'none' } },
    { key: 'premium', label: 'Premium', tagline: '200gsm satin, matte lamination', set: { paper: 'satin200', lamination: 'matte', mounting: 'none' } },
    { key: 'gallery', label: 'Gallery', tagline: 'Photo paper on foam board', set: { paper: 'photo', lamination: 'none', mounting: 'foam' } },
  ],
  promise: { max_quantity: 100, excluded: ['mounting:foam'] },
  known: [{ quantity: 100, config: { size: 'a3' }, price_kobo: N(58000) }],
  examples: () => Object.keys(POSTER_SIZE).flatMap((size) => POSTER_QTY.map((q) => ({ quantity: q, config: { size }, price_kobo: tidy(N(580) * POSTER_SIZE[size] * q * POSTER_QF[q]) }))),
  legacy: (r) => (r.quantity != null ? { quantity: r.quantity, config: { size: 'a3' } } : null),
};

// =====================================================================================================================
// Roll-up banners
// =====================================================================================================================
const ROLL_SIZE: Record<string, number> = { '85x200': 1, '100x200': 1.12, '120x200': 1.3, '150x200': 1.55 };
const ROLL_STAND: Record<string, number> = { economy: 0.55, standard: 0.8, bigbase: 1, double: 1.6, printonly: 0.3 };

const rollUps: PackProduct = {
  slug: 'roll-up-banners',
  name: 'Roll-up banners',
  blurb: '85 × 200 cm with a big base.',
  mode: 'size',
  cls: 'large',
  sizes: [
    { key: '85x200', label: '85 × 200 cm', w_in: 33.5, h_in: 78.7 },
    { key: '100x200', label: '100 × 200 cm', w_in: 39.4, h_in: 78.7 },
    { key: '120x200', label: '120 × 200 cm', w_in: 47.2, h_in: 78.7 },
    { key: '150x200', label: '150 × 200 cm', w_in: 59.1, h_in: 78.7 },
  ],
  qty: { custom: false, min: null, max: null },
  options: [
    {
      key: 'stand', label: 'Stand', default: 'bigbase', drives: true, help: 'Each stand has its own price.',
      choices: [c('economy', 'Economy stand'), c('standard', 'Standard stand'), c('bigbase', 'Premium big-base stand'), c('double', 'Double-sided stand'), c('printonly', 'Print only (I already have a stand)', { note: 'A replacement print for a stand you own' })],
    },
    { key: 'material', label: 'Print material', default: 'pvc', choices: [c('pvc', 'Standard PVC'), priced('anticurl', 'Premium anti-curl', piece(N(2500)))] },
  ],
  packages: [],
  promise: { max_quantity: 5 },
  known: [{ size_key: '85x200', config: { stand: 'bigbase' }, price_kobo: N(68500) }],
  examples: () => combos({ size: Object.keys(ROLL_SIZE), stand: Object.keys(ROLL_STAND) }).map((cfg) => ({ size_key: cfg.size, config: { stand: cfg.stand }, price_kobo: tidy(N(68500) * ROLL_SIZE[cfg.size] * ROLL_STAND[cfg.stand]) })),
  legacy: (r) => (r.size_key != null ? { size_key: '85x200', config: { stand: 'bigbase' } } : null),
};

// =====================================================================================================================
// Flex banners
// =====================================================================================================================
const FLEX_RATE: Record<string, number> = { standard: 700, backlit: 1300, mesh: 900, vinyl: 1100 };

const flexBanners: PackProduct = {
  slug: 'flex-banners',
  name: 'Flex banners',
  blurb: 'Any size, priced by the square foot. Corner eyelets included.',
  mode: 'area',
  cls: 'large',
  sizes: [],
  qty: { custom: false, min: null, max: null },
  options: [
    {
      key: 'material', label: 'Material', default: 'standard', drives: true,
      choices: [c('standard', 'Standard flex'), c('backlit', 'Backlit (for light boxes)'), c('mesh', 'Mesh (for windy places)'), c('vinyl', 'Self-adhesive vinyl')],
    },
    {
      key: 'finishing', label: 'Make it special', kind: 'tick', group: 'special', default: '', help: 'Eyelets every 2 ft are included.',
      choices: [
        priced('welded', 'Welded edges', { extra_kobo: N(60), extra_per: 'foot' }),
        priced('pockets', 'Pole pockets, top and bottom', order(N(2500))),
        priced('ropes', 'Ropes', { extra_kobo: N(40), extra_per: 'foot' }),
      ],
    },
    { key: 'frame', label: 'Frame', group: 'special', default: 'none', choices: [c('none', 'No frame'), priced('wood', 'Wooden frame', { extra_kobo: N(350), extra_per: 'sqft' }), priced('metal', 'Metal frame', { extra_kobo: N(550), extra_per: 'sqft' })] },
    { key: 'install', label: 'Installation', group: 'special', default: 'none', help: 'We confirm the fee for your site.', choices: [c('none', 'No installation'), priced('lagos', 'Installed within Lagos', order(N(15000)))] },
  ],
  packages: [],
  promise: { max_area_sqft: 150, excluded: ['frame:wood', 'frame:metal', 'install:lagos'] },
  known: [{ config: { material: 'standard' }, rate_per_sqft_kobo: N(700), min_area_sqft: 10 }],
  examples: () => Object.entries(FLEX_RATE).map(([material, rate]) => ({ config: { material }, rate_per_sqft_kobo: N(rate), min_area_sqft: 10 })),
  legacy: (r) => (r.rate_per_sqft_kobo != null ? { config: { material: 'standard' } } : null),
};

// =====================================================================================================================
// Stickers and labels
// =====================================================================================================================
const STICKER_QTY = [50, 100, 250, 500, 1000, 2500, 5000];
const STICKER_QF: Record<number, number> = { 50: 1.2, 100: 1, 250: 0.78, 500: 0.6, 1000: 0.45, 2500: 0.34, 5000: 0.27 };
const STICKER_SIZE: Record<string, number> = { s1: 0.35, s2: 0.55, s3: 0.85, s35: 1, s4: 1.2 };
const STICKER_MAT: Record<string, number> = { gloss: 0.8, matte: 0.85, vinyl: 1, clear: 1.2 };
const sq = (n: number) => ({ w_in: n, h_in: n });

const stickers: PackProduct = {
  slug: 'stickers',
  name: 'Stickers and labels',
  blurb: 'Round, 3.5 inch, vinyl.',
  mode: 'tier',
  cls: 'print',
  printW: 3.5,
  printH: 3.5,
  sizes: [],
  qty: { custom: true, min: 50, max: 5000 },
  options: [
    { key: 'shape', label: 'Shape', default: 'circle', choices: [c('circle', 'Circle'), c('square', 'Square'), c('rectangle', 'Rectangle'), c('oval', 'Oval'), priced('custom', 'Cut to your shape', piece(N(12)))] },
    {
      key: 'size', label: 'Size', default: 's35', drives: true,
      choices: [c('s1', '1 inch', sq(1)), c('s2', '2 inches', sq(2)), c('s3', '3 inches', sq(3)), c('s35', '3.5 inches', sq(3.5)), c('s4', '4 inches', sq(4))],
    },
    {
      key: 'material', label: 'Material', default: 'vinyl', drives: true,
      choices: [c('gloss', 'Gloss paper'), c('matte', 'Matte paper'), c('vinyl', 'White vinyl (waterproof)'), c('clear', 'Clear vinyl')],
    },
    {
      key: 'lamination', label: 'Make it special: lamination', group: 'special', default: 'none', only_if: { material: ['gloss', 'matte'] },
      choices: [c('none', 'None'), priced('gloss', 'Gloss', piece(N(8))), priced('matte', 'Matte', piece(N(8)))],
    },
    {
      key: 'supply', label: 'Supplied as', group: 'special', default: 'cut',
      choices: [c('cut', 'Cut one by one'), priced('sheets', 'On sheets', order(N(1500))), priced('rolls', 'On a roll (for product labels)', order(N(3000)))],
    },
  ],
  packages: [],
  promise: { max_quantity: 100, excluded: ['shape:custom', 'supply:rolls'] },
  known: [{ quantity: 100, config: { size: 's35', material: 'vinyl' }, price_kobo: N(17000) }],
  examples: () =>
    combos({ size: Object.keys(STICKER_SIZE), material: Object.keys(STICKER_MAT) }).flatMap((cfg) =>
      STICKER_QTY.map((q) => ({ quantity: q, config: cfg, price_kobo: tidy(N(170) * STICKER_SIZE[cfg.size] * STICKER_MAT[cfg.material] * q * STICKER_QF[q]) })),
    ),
  legacy: (r) => (r.quantity != null ? { quantity: r.quantity, config: { size: 's35', material: 'vinyl' } } : null),
};

// =====================================================================================================================
// Tees and Totes
// =====================================================================================================================
const TEE_QTY = [1, 5, 10, 25, 50, 100, 250, 500];
/** Per-piece example price of a plain round-neck tee, by method and quantity. */
const TEE_HEAT: Record<number, number> = { 1: 7000, 5: 6200, 10: 5700, 25: 5200, 50: 4900, 100: 4700, 250: 4600 };
const TEE_SCREEN: Record<number, number> = { 50: 3700, 100: 3300, 250: 2900, 500: 2600 };
const TEE_STYLE: Record<string, number> = { round: 1, vneck: 1.1, polo: 1.5 };
const TOTE_MAT: Record<string, number> = { nonwoven: 0.45, cotton: 0.75, heavy: 1 };
const TEE_SIZES = ['s', 'm', 'l', 'xl', 'xxl', '3xl'];

const teesAndTotes: PackProduct = {
  slug: 'tees-and-totes',
  aliases: ['branded-t-shirts'],
  name: 'Tees and Totes',
  blurb: 'T-shirts and tote bags with your design. Pick one at the start.',
  mode: 'tier',
  personalise: true,
  cls: 'photo',
  printW: 8.3,
  printH: 11.7,
  sizes: [],
  qty: { custom: true, min: 1, max: 5000 },
  options: [
    { key: 'item', label: 'What are you printing on?', default: 'tee', drives: true, choices: [c('tee', 'T-shirt'), c('tote', 'Tote bag')] },
    { key: 'style', label: 'Style', default: 'round', drives: true, only_if: { item: ['tee'] }, choices: [c('round', 'Round neck'), c('vneck', 'V-neck'), c('polo', 'Polo')] },
    { key: 'material', label: 'Bag material', default: 'nonwoven', drives: true, only_if: { item: ['tote'] }, choices: [c('nonwoven', 'Non-woven (budget)'), c('cotton', 'Cotton canvas'), c('heavy', 'Heavy canvas')] },
    { key: 'fabric', label: 'Fabric', default: 'standard', only_if: { item: ['tee'] }, choices: [c('standard', 'Standard cotton'), priced('premium', 'Premium heavyweight cotton', piece(N(1200)))] },
    {
      key: 'colour', label: 'Shirt colour', default: 'white', only_if: { item: ['tee'] }, help: 'We confirm the colours in stock on your proof.',
      choices: [
        c('white', 'White', { swatch: '#FFFFFF' }), c('black', 'Black', { swatch: '#111111' }), c('navy', 'Navy', { swatch: '#1B2A4A' }),
        priced('royal', 'Royal blue', piece(N(300)), { swatch: '#1F4FBF' }), priced('red', 'Red', piece(N(300)), { swatch: '#C62828' }),
        priced('green', 'Green', piece(N(300)), { swatch: '#1B7F3B' }), priced('yellow', 'Yellow', piece(N(300)), { swatch: '#F2C200' }),
      ],
    },
    { key: 'tote_colour', label: 'Bag colour', default: 'natural', only_if: { item: ['tote'] }, choices: [c('natural', 'Natural', { swatch: '#E8DCC2' }), c('white', 'White', { swatch: '#FFFFFF' }), priced('black', 'Black', piece(N(250)), { swatch: '#111111' })] },
    {
      key: 'tee_sizes', label: 'How many of each size?', kind: 'split', default: 'm:2,l:2,xl:1', only_if: { item: ['tee'] },
      choices: [c('s', 'S'), c('m', 'M'), c('l', 'L'), c('xl', 'XL'), priced('xxl', 'XXL', piece(N(500))), priced('3xl', '3XL', piece(N(800)))],
    },
    {
      key: 'tote_sizes', label: 'How many of each bag?', kind: 'split', default: 'standard:10', only_if: { item: ['tote'] },
      choices: [c('standard', 'Standard'), priced('large', 'Large, with a gusset', piece(N(600)))],
    },
    { key: 'handles', label: 'Handles', default: 'short', only_if: { item: ['tote'] }, choices: [c('short', 'Short'), c('long', 'Long (over the shoulder)')] },
    {
      key: 'positions', label: 'Print on', kind: 'tick', role: 'positions', default: 'front', only_if: { item: ['tee'] },
      help: 'The front print is included in the price.',
      choices: [c('front', 'Front'), priced('back', 'Back', piece(N(900))), priced('chest', 'Left chest', piece(N(600))), priced('sleeve', 'Sleeves', piece(N(700)))],
    },
    {
      key: 'tote_positions', label: 'Print on', kind: 'tick', role: 'positions', default: 'front', only_if: { item: ['tote'] },
      help: 'One side is included in the price.',
      choices: [c('front', 'One side'), priced('back', 'Both sides', piece(N(700)))],
    },
    { key: 'printsize', label: 'Print size', default: 'a4', choices: [c('a4', 'A4'), priced('a3', 'A3', { extra_kobo: N(600), extra_per: 'position' })] },
    {
      key: 'method', label: 'Print method', default: 'auto', drives: true, help: 'We choose heat transfer for small orders and screen print from 50 items (up to 3 colours). You can change it.',
      auto: [{ min_qty: 1, value: 'heat' }, { min_qty: 50, value: 'screen' }],
      choices: [c('auto', 'Best for your quantity'), c('heat', 'Heat transfer'), c('screen', 'Screen print', { min_qty: 50 })],
    },
    {
      key: 'extras', label: 'Make it special', kind: 'tick', group: 'special', default: '',
      choices: [priced('namenumber', 'A name or number on each shirt', piece(N(700)), { only_if: { item: ['tee'] } }), priced('packing', 'Pack each one separately', piece(N(150)))],
    },
  ],
  packages: [
    { key: 'basic', label: 'Basic', tagline: 'Front print', set: { printsize: 'a4', fabric: 'standard', positions: 'front', tote_positions: 'front' } },
    { key: 'team', label: 'Team', tagline: 'Front and back', set: { printsize: 'a4', fabric: 'standard', positions: 'front,back', tote_positions: 'front,back' } },
    { key: 'premium', label: 'Premium', tagline: 'Heavyweight cotton, front and back, A3', set: { printsize: 'a3', fabric: 'premium', positions: 'front,back', tote_positions: 'front,back' } },
  ],
  promise: { max_quantity: 20, excluded: ['method:screen', 'extras:namenumber'] },
  known: [{ quantity: 1, config: { item: 'tee', style: 'round', method: 'heat' }, price_kobo: N(7000) }],
  examples: () => {
    const out: Cell[] = [];
    for (const [style, m] of Object.entries(TEE_STYLE)) {
      for (const [q, unit] of Object.entries(TEE_HEAT)) out.push({ quantity: Number(q), config: { item: 'tee', style, method: 'heat' }, price_kobo: tidy(N(unit) * m * Number(q)) });
      for (const [q, unit] of Object.entries(TEE_SCREEN)) out.push({ quantity: Number(q), config: { item: 'tee', style, method: 'screen' }, price_kobo: tidy(N(unit) * m * Number(q)) });
    }
    for (const [material, m] of Object.entries(TOTE_MAT)) {
      for (const [q, unit] of Object.entries(TEE_HEAT)) out.push({ quantity: Number(q), config: { item: 'tote', material, method: 'heat' }, price_kobo: tidy(N(unit) * 0.7 * m * Number(q)) });
      for (const [q, unit] of Object.entries(TEE_SCREEN)) out.push({ quantity: Number(q), config: { item: 'tote', material, method: 'screen' }, price_kobo: tidy(N(unit) * 0.7 * m * Number(q)) });
    }
    return out;
  },
  legacy: (r) => (r.size_key != null && r.price_kobo != null ? { quantity: 1, size_key: null, config: { item: 'tee', style: 'round', method: 'heat' } } : null),
};

// =====================================================================================================================
// ID cards
// =====================================================================================================================
const ID_QTY = [1, 10, 25, 50, 100, 250, 500];
const ID_UNIT: Record<number, number> = { 1: 4500, 10: 3800, 25: 3200, 50: 2800, 100: 2400, 250: 2100, 500: 1900 };

const idCards: PackProduct = {
  slug: 'id-cards',
  name: 'ID cards',
  blurb: 'PVC card, landscape.',
  mode: 'tier',
  personalise: true,
  cls: 'print',
  printW: 3.37,
  printH: 2.13,
  sizes: [],
  qty: { custom: true, min: 1, max: 2000 },
  options: [
    { key: 'sides', label: 'Printed sides', default: 'one', choices: [c('one', 'One side'), priced('both', 'Both sides', piece(N(400)))] },
    { key: 'layout', label: 'Layout', default: 'landscape', choices: [c('landscape', 'Landscape', { w_in: 3.37, h_in: 2.13 }), c('portrait', 'Portrait', { w_in: 2.13, h_in: 3.37 })] },
    { key: 'finish', label: 'Finish', default: 'gloss', choices: [c('gloss', 'Gloss'), c('matte', 'Matte')] },
    {
      key: 'personalised', label: 'Different details on each card?', group: 'special', default: 'none', help: 'Upload a spreadsheet of names, roles and photos and each card is printed differently.',
      choices: [c('none', 'No, all the same'), priced('sheet', 'Yes, from a spreadsheet', { setup_kobo: N(5000) })],
    },
    { key: 'codes', label: 'A code on each card', group: 'special', default: 'none', only_if: { personalised: ['sheet'] }, choices: [c('none', 'No code'), c('qr', 'QR code for each person'), c('barcode', 'Barcode for each person')] },
    {
      key: 'accessories', label: 'Lanyards and holders', kind: 'tick', group: 'special', default: '',
      choices: [
        priced('lanyard', 'Plain lanyard', piece(N(350))), priced('lanyard_logo', 'Lanyard printed with your logo', piece(N(650)), { min_qty: 50 }),
        priced('holder_soft', 'Soft holder', piece(N(200))), priced('holder_hard', 'Hard holder', piece(N(400))), priced('clip', 'Retractable clip', piece(N(500))),
      ],
    },
  ],
  packages: [],
  promise: { max_quantity: 50, excluded: ['personalised:sheet', 'accessories:lanyard_logo'] },
  known: [{ quantity: 1, config: {}, price_kobo: N(4500) }],
  examples: () => ID_QTY.map((q) => ({ quantity: q, config: {}, price_kobo: tidy(N(ID_UNIT[q]) * q) })),
  // The old price was per card whatever the quantity, so only the first step keeps it.
  legacy: (r) => (r.size_key != null && r.price_kobo != null ? { quantity: 1, size_key: null, config: {} } : null),
};

// =====================================================================================================================
// Picture frames
// =====================================================================================================================
const FRAME_SIZES: SizeOption[] = [
  { key: '8x10', label: '8 × 10 in', w_in: 8, h_in: 10 },
  { key: '12x16', label: '12 × 16 in', w_in: 12, h_in: 16 },
  { key: '16x20', label: '16 × 20 in', w_in: 16, h_in: 20 },
  { key: '20x24', label: '20 × 24 in', w_in: 20, h_in: 24 },
  { key: '24x36', label: '24 × 36 in', w_in: 24, h_in: 36 },
];
const FRAME_PRICE: Record<string, number> = { '8x10': 11000, '12x16': 16000, '16x20': 22000, '20x24': 38000, '24x36': 56000 };
const fby = (a: number, b: number, c2: number, d: number, e: number) => ({ key: 'size', amounts: { '8x10': N(a), '12x16': N(b), '16x20': N(c2), '20x24': N(d), '24x36': N(e) } });
const EMPTY_BY = { key: 'size', amounts: {} };

const frames: PackProduct = {
  slug: 'picture-frames',
  name: 'Picture frames',
  blurb: 'Your photo printed and framed, with a matte finish.',
  mode: 'size',
  cls: 'photo',
  sizes: FRAME_SIZES,
  qty: { custom: false, min: null, max: null },
  options: [
    { key: 'print', label: 'Print', default: 'photo', drives: true, choices: [c('photo', 'Photo paper'), c('canvas', 'Canvas')] },
    {
      key: 'frame', label: 'Frame colour', default: 'black',
      choices: [c('black', 'Black'), c('white', 'White'), c('wood', 'Natural wood'), priced('gold', 'Gold', { extra_per: 'piece', by: fby(1500, 2500, 3500, 5500, 8000) }, { by: EMPTY_BY })],
    },
    { key: 'depth', label: 'Frame depth', default: 'slim', choices: [c('slim', 'Slim'), priced('deep', 'Deep', { extra_per: 'piece', by: fby(1000, 1600, 2400, 3800, 5500) }, { by: EMPTY_BY })] },
    {
      key: 'front', label: 'Front', default: 'glass', help: 'Acrylic is safer to deliver.',
      choices: [c('glass', 'Glass', { only_if: { print: ['photo'] } }), c('none', 'No glass', { only_if: { print: ['canvas'] } }), priced('acrylic', 'Acrylic', { extra_per: 'piece', by: fby(500, 900, 1400, 2400, 3600) }, { by: EMPTY_BY })],
    },
    {
      key: 'mount', label: 'Make it special: mount', group: 'special', default: 'none', only_if: { print: ['photo'] },
      choices: [c('none', 'No mount'), priced('white', 'White mount', { extra_per: 'piece', by: fby(600, 900, 1300, 2000, 3000) }, { by: EMPTY_BY }), priced('black', 'Black mount', { extra_per: 'piece', by: fby(600, 900, 1300, 2000, 3000) }, { by: EMPTY_BY })],
    },
    {
      key: 'hanging', label: 'Hanging', group: 'special', default: 'hooks',
      choices: [c('hooks', 'Wall hooks'), c('stand', 'Table stand', { only_if: { size: ['8x10', '12x16'] } })],
    },
    { key: 'giftwrap', label: 'Gift wrap', group: 'special', default: 'no', choices: [c('no', 'No'), priced('yes', 'Yes, wrapped as a gift', order(N(1500)))] },
  ],
  packages: [],
  promise: { max_quantity: 5, max_size_rank: 2, excluded: ['print:canvas', 'frame:gold', 'depth:deep'] },
  known: FRAME_SIZES.map((s) => ({ size_key: s.key, config: { print: 'photo' }, price_kobo: N(FRAME_PRICE[s.key]) })),
  examples: () => FRAME_SIZES.flatMap((s) => (['photo', 'canvas'] as const).map((print) => ({ size_key: s.key, config: { print }, price_kobo: tidy(N(FRAME_PRICE[s.key]) * (print === 'canvas' ? 1.35 : 1)) }))),
  legacy: (r) => (r.size_key != null ? { size_key: r.size_key, config: { print: 'photo' } } : null),
};

export const CATALOGUE: PackProduct[] = [businessCards, flyers, posters, rollUps, flexBanners, stickers, teesAndTotes, idCards, frames];
export const CATALOGUE_VERSION = 2;
export const packProduct = (slug: string) => CATALOGUE.find((p) => p.slug === slug || p.aliases?.includes(slug));

// ---------- Turning the catalogue's options into what is stored ----------
/**
 * The options for a product. `examples` fills in example prices for the choices waiting for a real one (marked as
 * placeholders). Without it those choices carry no price and stay off the shop until the owner sets one.
 */
export function materialiseOptions(p: PackProduct, examples: boolean): ProductOption[] {
  return p.options.map((o) => ({
    ...o,
    choices: o.choices.map((ch) => {
      const { ex, ask, ...rest } = ch;
      if (!ask) return rest;
      return examples ? { ...rest, ...ex, provisional: true } : { ...rest, unpriced: true };
    }),
  }));
}

/** The price cells to store: the real ones alone, or every example cell with the real ones standing where they overlap. */
export function cellsFor(p: PackProduct, examples: boolean): (Cell & { provisional: boolean })[] {
  const key = (x: Cell) => `${x.quantity ?? ''}|${x.size_key ?? ''}|${JSON.stringify(Object.fromEntries(Object.entries(x.config).sort()))}`;
  const known = new Map(p.known.map((x) => [key(x), x]));
  const out: (Cell & { provisional: boolean })[] = p.known.map((x) => ({ ...x, provisional: false }));
  if (examples) for (const x of p.examples()) if (!known.has(key(x))) out.push({ ...x, provisional: true });
  return out;
}
