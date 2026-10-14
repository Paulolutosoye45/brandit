import { isDemo } from './db';
import { DEFAULT_SETTINGS } from './settings-defaults';
import { hashPin } from './password';
import type { Q } from './db';
import type { ProductOption, SizeOption } from './types';
import { PRODUCT_CONTENT } from './catalog-content';
import { seedTemplates } from './growth-content';

/*
 * Starting data. Three kinds of numbers live here, and the console shows which is which:
 *  - benchmark: taken from Lagos competitors' published prices (Printivo, Hazken Digital)
 *  - provisional: invented to make the quantity steps work in the demo (marked provisional=true,
 *    switched on only in DEMO_MODE; real prices go in through the console once the cost sheet exists)
 *  - placeholder: delivery fees and design fees, to be replaced with real ones
 */

const naira = (n: number) => n * 100;
const round500 = (n: number) => Math.round(n / 500) * 500;
const factor = (q: number) => (q <= 10 ? 1.5 : q <= 50 ? 1.15 : q <= 100 ? 1 : q <= 250 ? 0.9 : q <= 500 ? 0.8 : 0.7);

type TierSpec = { quantities: number[]; knownQty: number; knownPrice: number };
const tierPrices = (s: TierSpec) =>
  s.quantities.map((q) =>
    q === s.knownQty
      ? { quantity: q, price: naira(s.knownPrice), provisional: false }
      : { quantity: q, price: naira(round500((s.knownPrice / s.knownQty) * q * factor(q))), provisional: true },
  );

type Seed = {
  slug: string;
  name: string;
  blurb: string;
  mode: 'tier' | 'area' | 'size';
  cls: 'print' | 'photo' | 'large';
  printW?: number;
  printH?: number;
  options?: ProductOption[];
  sizes?: SizeOption[];
  tier?: TierSpec;
  sizePrices?: { key: string; price: number }[];
  area?: { rate: number; min: number };
  promise: { max_quantity?: number; max_area_sqft?: number; max_size_rank?: number };
};

const FRAME_SIZES: SizeOption[] = [
  { key: '8x10', label: '8 × 10 in', w_in: 8, h_in: 10 },
  { key: '12x16', label: '12 × 16 in', w_in: 12, h_in: 16 },
  { key: '16x20', label: '16 × 20 in', w_in: 16, h_in: 20 },
  { key: '20x24', label: '20 × 24 in', w_in: 20, h_in: 24 },
  { key: '24x36', label: '24 × 36 in', w_in: 24, h_in: 36 },
];

const PRODUCTS: Seed[] = [
  {
    slug: 'business-cards', name: 'Business cards', mode: 'tier', cls: 'print', printW: 3.5, printH: 2,
    blurb: 'Thick 300gsm card, printed on both sides.',
    options: [
      { key: 'finish', label: 'Finish', default: 'matte', choices: [{ value: 'matte', label: 'Matte' }, { value: 'gloss', label: 'Gloss' }], help: 'Same price either way.' },
    ],
    tier: { quantities: [100, 250, 500, 1000], knownQty: 100, knownPrice: 15000 },
    promise: { max_quantity: 500 },
  },
  {
    slug: 'flyers', name: 'Flyers', mode: 'tier', cls: 'print', printW: 5.83, printH: 8.27,
    blurb: 'A5, single-sided, 150gsm.',
    tier: { quantities: [50, 100, 500, 1000], knownQty: 100, knownPrice: 25500 },
    promise: { max_quantity: 1000 },
  },
  {
    slug: 'posters', name: 'Posters', mode: 'tier', cls: 'photo', printW: 11.7, printH: 16.5,
    blurb: 'A3, 150gsm. Orders from 10, where others start at 100.',
    tier: { quantities: [10, 50, 100], knownQty: 100, knownPrice: 58000 },
    promise: { max_quantity: 100 },
  },
  {
    slug: 'roll-up-banners', name: 'Roll-up banners', mode: 'size', cls: 'large',
    blurb: '85 × 200 cm with a big base.',
    sizes: [{ key: 'each', label: '85 × 200 cm, big base', w_in: 33.5, h_in: 78.7 }],
    sizePrices: [{ key: 'each', price: 68500 }],
    promise: { max_quantity: 5 },
  },
  {
    slug: 'flex-banners', name: 'Flex banners', mode: 'area', cls: 'large',
    blurb: 'Any size, priced by the square foot. Corner eyelets included.',
    area: { rate: 700, min: 10 },
    promise: { max_area_sqft: 150 },
  },
  {
    slug: 'stickers', name: 'Stickers and labels', mode: 'tier', cls: 'print', printW: 3.5, printH: 3.5,
    blurb: 'Round, 3.5 inch, vinyl.',
    tier: { quantities: [100, 250, 500], knownQty: 100, knownPrice: 17000 },
    promise: { max_quantity: 100 },
  },
  {
    slug: 'branded-t-shirts', name: 'Branded T-shirts', mode: 'size', cls: 'photo',
    blurb: 'Cotton round-neck, front print.',
    options: [
      { key: 'colour', label: 'Shirt colour', default: 'white', choices: [{ value: 'white', label: 'White' }, { value: 'black', label: 'Black' }, { value: 'navy', label: 'Navy' }], help: 'We confirm colours in stock on your proof.' },
    ],
    sizes: [{ key: 'each', label: 'Front print, A4', w_in: 8.3, h_in: 11.7 }],
    sizePrices: [{ key: 'each', price: 7000 }],
    promise: { max_quantity: 20 },
  },
  {
    slug: 'id-cards', name: 'ID cards', mode: 'size', cls: 'print',
    blurb: 'PVC card, landscape.',
    sizes: [{ key: 'each', label: 'PVC card, landscape', w_in: 3.37, h_in: 2.13 }],
    sizePrices: [{ key: 'each', price: 4500 }],
    promise: { max_quantity: 50 },
  },
  {
    slug: 'picture-frames', name: 'Picture frames', mode: 'size', cls: 'photo',
    blurb: 'Your photo printed and framed, with a matte finish.',
    options: [
      { key: 'frame', label: 'Frame colour', default: 'black', choices: [{ value: 'black', label: 'Black' }, { value: 'white', label: 'White' }, { value: 'wood', label: 'Natural wood' }], help: 'Same price in every colour.' },
    ],
    sizes: FRAME_SIZES,
    sizePrices: [
      { key: '8x10', price: 11000 },
      { key: '12x16', price: 16000 },
      { key: '16x20', price: 22000 },
      { key: '20x24', price: 38000 },
      { key: '24x36', price: 56000 },
    ],
    promise: { max_quantity: 5, max_size_rank: 2 },
  },
];

const ZONES = [
  { name: 'Zone A: Mainland core', fee: 1500, eligible: true, areas: ['Yaba', 'Surulere', 'Ikeja', 'Maryland', 'Gbagada', 'Ilupeju', 'Ojuelegba', 'Anthony', 'Ogba', 'Magodo', 'Oshodi', 'Mushin'] },
  { name: 'Zone B: Island and Lekki', fee: 2500, eligible: true, areas: ['Victoria Island', 'Ikoyi', 'Lekki Phase 1', 'Oniru', 'Lagos Island', 'Ikate', 'Chevron', 'Banana Island'] },
  { name: 'Zone C: Outer Lagos', fee: 4000, eligible: false, areas: ['Ajah', 'Sangotedo', 'Ikorodu', 'Epe', 'Badagry', 'Festac', 'Ojo', 'Alimosho', 'Ikotun', 'Agege'] },
];

export async function seedIfEmpty(d: { query: Q['query']; tx: <T>(fn: (q: Q) => Promise<T>) => Promise<T> }) {
  const demo = isDemo();
  const have = await d.query<{ n: number }>('select count(*)::int as n from products');
  if (have[0].n > 0) return;

  await d.tx(async (q) => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await q.query('insert into settings (key, value) values ($1, $2) on conflict (key) do nothing', [key, JSON.stringify(value)]);
    }

    let sort = 0;
    for (const z of ZONES) {
      await q.query('insert into delivery_zones (name, areas, fee_kobo, eligible_24h, provisional, sort) values ($1,$2,$3,$4,true,$5)', [z.name, z.areas, naira(z.fee), z.eligible, sort++]);
    }

    const press = await q.query<{ id: string }>("insert into presses (name, is_partner) values ('Brandit hub', false) returning id");
    await q.query("insert into presses (name, is_partner) values ('Partner press (set up in console)', true)");
    const partner = await q.query<{ id: string }>("select id from presses where is_partner limit 1");

    // Staff. Demo mode gets one account per role with PIN 1234. Real mode gets only the admin from the environment.
    if (demo) {
      const demoStaff: [string, string, string, string | null][] = [
        ['admin@brandit.test', 'Ada (Admin)', 'admin', null],
        ['lead@brandit.test', 'Tunde (Production lead)', 'production_lead', null],
        ['files@brandit.test', 'Ngozi (File desk)', 'file_desk', null],
        ['support@brandit.test', 'Femi (Support)', 'support', null],
        ['dispatch@brandit.test', 'Sule (Dispatcher)', 'dispatcher', null],
        ['press@brandit.test', 'Partner press', 'partner_press', partner[0].id],
      ];
      for (const [email, name, role, pressId] of demoStaff) {
        await q.query('insert into staff (email, name, role, pin_hash, press_id) values ($1,$2,$3,$4,$5)', [email, name, role, hashPin('1234'), pressId]);
      }
    } else if (process.env.ADMIN_EMAIL && process.env.ADMIN_PIN) {
      await q.query("insert into staff (email, name, role, pin_hash) values ($1,'Admin','admin',$2)", [process.env.ADMIN_EMAIL.toLowerCase(), hashPin(process.env.ADMIN_PIN)]);
    }

    let order = 0;
    for (const p of PRODUCTS) {
      const [{ id }] = await q.query<{ id: string }>(
        `insert into products (slug, name, blurb, pricing_mode, options, sizes, print_w_in, print_h_in, check_class, sort, description, highlights, category)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
        [p.slug, p.name, p.blurb, p.mode, JSON.stringify(p.options ?? []), JSON.stringify(p.sizes ?? []), p.printW ?? null, p.printH ?? null, p.cls, order++, PRODUCT_CONTENT[p.slug]?.description ?? '', PRODUCT_CONTENT[p.slug]?.highlights ?? [], PRODUCT_CONTENT[p.slug]?.category ?? ''],
      );

      if (p.mode === 'tier' && p.tier) {
        for (const t of tierPrices(p.tier)) {
          await q.query('insert into price_rules (product_id, quantity, price_kobo, provisional, active) values ($1,$2,$3,$4,$5)', [id, t.quantity, t.price, t.provisional, !t.provisional || demo]);
        }
      } else if (p.mode === 'size' && p.sizePrices) {
        for (const s of p.sizePrices) {
          await q.query('insert into price_rules (product_id, size_key, price_kobo, provisional, active) values ($1,$2,$3,false,true)', [id, s.key, naira(s.price)]);
        }
      } else if (p.mode === 'area' && p.area) {
        await q.query('insert into price_rules (product_id, rate_per_sqft_kobo, min_area_sqft, provisional, active) values ($1,$2,$3,false,true)', [id, naira(p.area.rate), p.area.min]);
      }

      await q.query(
        'insert into promise_rules (product_id, eligible_24h, max_quantity, max_area_sqft, max_size_rank, standard_days) values ($1,true,$2,$3,$4,3)',
        [id, p.promise.max_quantity ?? null, p.promise.max_area_sqft ?? null, p.promise.max_size_rank ?? null],
      );
    }
    void press;
    await seedTemplates(q);
  });
}
