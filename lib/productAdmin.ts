import { query, one, tx } from './db';
import { MAX_QUANTITY } from './pricing';
import type { CheckClass, ExtraPer, OptionChoice, PricingMode, ProductOption, SizeOption } from './types';

/*
 * Everything the console does to the catalogue. Plain functions that check their input and throw
 * ProductError with a sentence the person at the keyboard can act on.
 */
export class ProductError extends Error {}

export const RESERVED_SLUGS = ['custom-order', 'new'];
const MAX_OPTIONS = 4;
const MAX_CHOICES = 12;
const MAX_SIZES = 12;
const MAX_TIERS = 12;
export const MAX_IMAGES = 8;

export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const cleanBlock = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '');

/** A key that is not already taken: "finish", then "finish-2", "finish-3". */
function uniqueKey(base: string, taken: Set<string>, fallback: string): string {
  const root = slugify(base) || fallback;
  let k = root;
  for (let i = 2; taken.has(k); i++) k = `${root}-${i}`;
  taken.add(k);
  return k;
}

export type NewProduct = { name: string; category: string; blurb: string; mode: PricingMode };

export async function createProduct(i: NewProduct): Promise<{ id: string; slug: string }> {
  const name = clean(i.name, 60);
  if (name.length < 2) throw new ProductError('Give the product a name.');
  if (!['tier', 'area', 'size'].includes(i.mode)) throw new ProductError('Choose how this product is priced.');
  const base = slugify(name);
  if (!base) throw new ProductError('The name needs some letters or numbers.');
  let slug = base;
  for (let n = 2; RESERVED_SLUGS.includes(slug) || (await one('select 1 as x from products where slug = $1', [slug])); n++) slug = `${base}-${n}`;
  const sort = (await one<{ n: number }>('select coalesce(max(sort), -1)::int + 1 as n from products'))!.n;
  const created = await tx(async (q) => {
    const r = await q.query<{ id: string }>(
      `insert into products (slug, name, blurb, category, pricing_mode, check_class, active, sort)
       values ($1,$2,$3,$4,$5,$6,false,$7) returning id`,
      [slug, name, clean(i.blurb, 160), clean(i.category, 40), i.mode, i.mode === 'area' ? 'large' : 'print', sort],
    );
    await q.query('insert into promise_rules (product_id, eligible_24h, standard_days) values ($1,false,3)', [r[0].id]);
    return r[0].id;
  });
  return { id: created, slug };
}

export type Details = { name: string; category: string; blurb: string; description: string; highlights: string; allow_custom: boolean; check_class: string; print_w_in: string; print_h_in: string };

export async function saveDetails(id: string, d: Details) {
  const name = clean(d.name, 60);
  if (name.length < 2) throw new ProductError('The product needs a name.');
  const cls = ['print', 'photo', 'large'].includes(d.check_class) ? (d.check_class as CheckClass) : 'print';
  const w = d.print_w_in?.trim() ? Number(d.print_w_in) : null;
  const h = d.print_h_in?.trim() ? Number(d.print_h_in) : null;
  for (const v of [w, h]) if (v != null && !(v > 0 && v <= 400)) throw new ProductError('The print size must be a number of inches, such as 3.5.');
  if ((w == null) !== (h == null)) throw new ProductError('Give both the width and the height of the print, or leave both empty.');
  const highlights = cleanBlock(d.highlights, 1200).split('\n').map((x) => clean(x, 90)).filter(Boolean).slice(0, 8);
  const r = await query(
    `update products set name = $2, category = $3, blurb = $4, description = $5, highlights = $6, allow_custom = $7, check_class = $8, print_w_in = $9, print_h_in = $10 where id = $1 and not system returning id`,
    [id, name, clean(d.category, 40), clean(d.blurb, 160), cleanBlock(d.description, 4000), highlights, !!d.allow_custom, cls, w, h],
  );
  if (!r.length) throw new ProductError('We could not find that product.');
}

// ---------- Options ----------
type OptionIn = { key?: string; label: string; help?: string; default?: string; defaultIndex?: number; choices: { value?: string; label: string; extra?: string; per?: string }[] };

export function cleanOptions(input: unknown, mode: PricingMode): ProductOption[] {
  if (!Array.isArray(input)) throw new ProductError('The options could not be read. Reload the page and try again.');
  if (input.length > MAX_OPTIONS) throw new ProductError(`A product can have up to ${MAX_OPTIONS} options.`);
  const keys = new Set<string>();
  const out: ProductOption[] = [];
  for (const raw of input as OptionIn[]) {
    const label = clean(raw?.label, 40);
    if (!label) throw new ProductError('Every option needs a name, such as "Finish" or "Paper".');
    const key = raw.key && !keys.has(raw.key) && /^[a-z0-9-]{1,48}$/.test(raw.key) ? (keys.add(raw.key), raw.key) : uniqueKey(label, keys, 'option');
    const vals = new Set<string>();
    const choices: OptionChoice[] = [];
    let defaultFromIndex: string | undefined;
    for (const [srcIdx, c] of (raw.choices ?? []).entries()) {
      const cl = clean(c?.label, 40);
      if (!cl) continue;
      const value = c.value && !vals.has(c.value) && /^[a-z0-9-]{1,48}$/.test(c.value) ? (vals.add(c.value), c.value) : uniqueKey(cl, vals, 'choice');
      const extraNaira = c.extra === undefined || c.extra === '' ? 0 : Number(String(c.extra).replace(/[^\d.]/g, ''));
      if (!(extraNaira >= 0 && extraNaira <= 10_000_000)) throw new ProductError(`The extra price for "${cl}" must be an amount in naira, like 2000.`);
      const choice: OptionChoice = { value, label: cl };
      if (extraNaira > 0) {
        const per = (['order', 'piece', 'sqft'] as ExtraPer[]).includes(c.per as ExtraPer) ? (c.per as ExtraPer) : 'order';
        if (per === 'sqft' && mode !== 'area') throw new ProductError(`"Per square foot" extras only make sense for products priced by the square foot ("${cl}").`);
        choice.extra_kobo = Math.round(extraNaira * 100);
        choice.extra_per = per;
      }
      choices.push(choice);
      if (srcIdx === raw.defaultIndex) defaultFromIndex = value;
    }
    if (choices.length > MAX_CHOICES) throw new ProductError(`"${label}" has more than ${MAX_CHOICES} choices.`);
    if (choices.length < 2) throw new ProductError(`"${label}" needs at least two choices. An option with one choice is not a choice.`);
    const def = defaultFromIndex ?? choices.find((c) => c.value === raw.default)?.value ?? choices[0].value;
    const help = clean(raw.help, 120);
    out.push({ key, label, default: def, choices, ...(help ? { help } : {}) });
  }
  return out;
}

export async function saveOptions(id: string, input: unknown) {
  const p = await one<{ pricing_mode: PricingMode }>('select pricing_mode from products where id = $1 and not system', [id]);
  if (!p) throw new ProductError('We could not find that product.');
  const options = cleanOptions(input, p.pricing_mode);
  await query('update products set options = $2 where id = $1', [id, JSON.stringify(options)]);
}

// ---------- Prices ----------
const kobo = (v: unknown) => Math.round(Number(String(v ?? '').replace(/[^\d.]/g, '')) * 100);

export type TierRow = { quantity: string | number; price: string | number };
export async function saveTierPrices(id: string, rows: unknown) {
  const p = await one<{ pricing_mode: PricingMode }>('select pricing_mode from products where id = $1 and not system', [id]);
  if (!p || p.pricing_mode !== 'tier') throw new ProductError('This product is not priced by quantity.');
  if (!Array.isArray(rows)) throw new ProductError('The prices could not be read. Reload the page and try again.');
  if (rows.length > MAX_TIERS) throw new ProductError(`Up to ${MAX_TIERS} quantity steps are allowed.`);
  const seen = new Set<number>();
  const clean2: { q: number; price: number }[] = [];
  for (const r of rows as TierRow[]) {
    const q = Math.trunc(Number(r.quantity));
    const price = kobo(r.price);
    if (!(q >= 1 && q <= MAX_QUANTITY)) throw new ProductError(`A quantity must be between 1 and ${MAX_QUANTITY.toLocaleString('en-US')}.`);
    if (!(price > 0)) throw new ProductError(`Add a price for ${q.toLocaleString('en-US')}. Prices must be more than zero.`);
    if (seen.has(q)) throw new ProductError(`${q.toLocaleString('en-US')} appears twice. Each quantity needs one price.`);
    seen.add(q);
    clean2.push({ q, price });
  }
  await tx(async (q) => {
    await q.query('delete from price_rules where product_id = $1 and quantity is not null and not (quantity = any($2::int[]))', [id, clean2.map((c) => c.q)]);
    for (const c of clean2) {
      const done = await q.query('update price_rules set price_kobo = $3, active = true, provisional = false where product_id = $1 and quantity = $2 returning id', [id, c.q, c.price]);
      if (!done.length) await q.query('insert into price_rules (product_id, quantity, price_kobo, provisional, active) values ($1,$2,$3,false,true)', [id, c.q, c.price]);
    }
  });
}

export async function saveAreaPrice(id: string, rate: unknown, minArea: unknown) {
  const p = await one<{ pricing_mode: PricingMode }>('select pricing_mode from products where id = $1 and not system', [id]);
  if (!p || p.pricing_mode !== 'area') throw new ProductError('This product is not priced by the square foot.');
  const r = kobo(rate);
  if (!(r > 0)) throw new ProductError('Add a price per square foot. It must be more than zero.');
  const m = String(minArea ?? '').trim() === '' ? 0 : Number(minArea);
  if (!(m >= 0 && m <= 1000)) throw new ProductError('The minimum area must be a number of square feet, or empty.');
  await tx(async (q) => {
    const done = await q.query('update price_rules set rate_per_sqft_kobo = $2, min_area_sqft = $3, active = true, provisional = false where product_id = $1 and rate_per_sqft_kobo is not null returning id', [id, r, m || null]);
    if (!done.length) await q.query('insert into price_rules (product_id, rate_per_sqft_kobo, min_area_sqft, provisional, active) values ($1,$2,$3,false,true)', [id, r, m || null]);
  });
}

export type SizeRow = { key?: string; label: string; w_in: string | number; h_in: string | number; price: string | number };
/** Sizes and their prices belong together: a size without a price cannot be sold. */
export async function saveSizes(id: string, rows: unknown) {
  const p = await one<{ pricing_mode: PricingMode }>('select pricing_mode from products where id = $1 and not system', [id]);
  if (!p || p.pricing_mode !== 'size') throw new ProductError('This product is not priced by size.');
  if (!Array.isArray(rows) || rows.length === 0) throw new ProductError('Add at least one size.');
  if (rows.length > MAX_SIZES) throw new ProductError(`Up to ${MAX_SIZES} sizes are allowed.`);
  const keys = new Set<string>();
  const sizes: SizeOption[] = [];
  const prices: Record<string, number> = {};
  for (const r of rows as SizeRow[]) {
    const label = clean(r.label, 50);
    if (!label) throw new ProductError('Every size needs a name, such as "A4" or "12 × 16 in".');
    const w = Number(r.w_in);
    const h = Number(r.h_in);
    if (!(w > 0 && w <= 400 && h > 0 && h <= 400)) throw new ProductError(`Give the width and height of "${label}" in inches. They are used to check that a customer's file is sharp enough.`);
    const price = kobo(r.price);
    if (!(price > 0)) throw new ProductError(`Add a price for "${label}". Prices must be more than zero.`);
    const key = r.key && !keys.has(r.key) && /^[a-z0-9-]{1,48}$/.test(r.key) ? (keys.add(r.key), r.key) : uniqueKey(label, keys, 'size');
    sizes.push({ key, label, w_in: w, h_in: h });
    prices[key] = price;
  }
  await tx(async (q) => {
    await q.query('update products set sizes = $2 where id = $1', [id, JSON.stringify(sizes)]);
    await q.query('delete from price_rules where product_id = $1 and size_key is not null and not (size_key = any($2::text[]))', [id, sizes.map((s) => s.key)]);
    for (const s of sizes) {
      const done = await q.query('update price_rules set price_kobo = $3, active = true, provisional = false where product_id = $1 and size_key = $2 returning id', [id, s.key, prices[s.key]]);
      if (!done.length) await q.query('insert into price_rules (product_id, size_key, price_kobo, provisional, active) values ($1,$2,$3,false,true)', [id, s.key, prices[s.key]]);
    }
  });
}

export type Promise24 = { eligible: boolean; max_quantity: string; max_area: string; max_size_rank: string; standard_days: string };
export async function save24h(id: string, d: Promise24) {
  const maxQ = d.max_quantity?.trim() ? Math.trunc(Number(d.max_quantity)) : null;
  const maxA = d.max_area?.trim() ? Number(d.max_area) : null;
  const rank = d.max_size_rank?.trim() !== '' && d.max_size_rank != null ? Math.trunc(Number(d.max_size_rank)) : null;
  const days = Math.trunc(Number(d.standard_days));
  if (maxQ != null && !(maxQ >= 1)) throw new ProductError('"Most pieces" must be a whole number, or empty for no limit.');
  if (maxA != null && !(maxA > 0)) throw new ProductError('"Most square feet" must be a number, or empty for no limit.');
  if (!(days >= 1 && days <= 30)) throw new ProductError('Standard delivery must take between 1 and 30 working days.');
  const done = await query('update promise_rules set eligible_24h = $2, max_quantity = $3, max_area_sqft = $4, max_size_rank = $5, standard_days = $6 where product_id = $1 returning product_id', [id, !!d.eligible, maxQ, maxA, rank, days]);
  if (!done.length) await query('insert into promise_rules (product_id, eligible_24h, max_quantity, max_area_sqft, max_size_rank, standard_days) values ($1,$2,$3,$4,$5,$6)', [id, !!d.eligible, maxQ, maxA, rank, days]);
}

// ---------- On sale ----------
export type Readiness = { ready: boolean; missing: string[]; tips: string[] };
export async function readiness(id: string): Promise<Readiness> {
  const p = await one<any>('select * from products where id = $1 and not system', [id]);
  if (!p) return { ready: false, missing: ['This product no longer exists.'], tips: [] };
  const missing: string[] = [];
  const tips: string[] = [];
  const prices = await one<{ n: number }>('select count(*)::int as n from price_rules where product_id = $1 and active', [id]);
  if (!p.name?.trim()) missing.push('A name');
  if (!p.blurb?.trim()) missing.push('A short description (one line for the product card)');
  if (!prices?.n) missing.push(p.pricing_mode === 'tier' ? 'At least one quantity with a price' : p.pricing_mode === 'size' ? 'At least one size with a price' : 'A price per square foot');
  if (p.pricing_mode === 'size' && (p.sizes ?? []).length === 0) missing.push('At least one size');
  const img = await one<{ n: number }>('select count(*)::int as n from product_images where product_id = $1', [id]);
  if (!img?.n) tips.push('Add a photo. Products with real photos get chosen more often.');
  if (p.pricing_mode === 'tier' && (!p.print_w_in || !p.print_h_in)) tips.push('Add the print size, so customers\' files can be checked for sharpness.');
  if (!p.description?.trim()) tips.push('Add a longer description. It answers questions before customers have to ask.');
  if (!p.category?.trim()) tips.push('Add a category, so customers can filter the catalogue.');
  return { ready: missing.length === 0, missing, tips };
}

export async function setActive(id: string, on: boolean) {
  if (on) {
    const r = await readiness(id);
    if (!r.ready) throw new ProductError(`Before this product can go on sale, it needs: ${r.missing.join('; ')}.`);
  }
  await query('update products set active = $2 where id = $1 and not system', [id, on]);
}

export async function moveProduct(id: string, dir: 'up' | 'down') {
  const rows = await query<{ id: string }>('select id from products where not system order by sort, name');
  const i = rows.findIndex((r) => r.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= rows.length) return;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  await tx(async (q) => {
    for (let n = 0; n < rows.length; n++) await q.query('update products set sort = $2 where id = $1', [rows[n].id, n]);
  });
}

/** Remove a product that was never sold. One with orders behind it can only be hidden, so old invoices keep working. */
export async function deleteProduct(id: string) {
  const p = await one<{ name: string }>('select name from products where id = $1 and not system', [id]);
  if (!p) throw new ProductError('We could not find that product.');
  const used = await one<{ n: number }>('select (select count(*) from order_items where product_id = $1)::int + (select count(*) from custom_requests where product_id = $1)::int as n', [id]);
  if (used?.n) throw new ProductError(`"${p.name}" has ${used.n} order${used.n === 1 ? '' : 's'} behind it, so it cannot be deleted. Hide it instead and it disappears from the shop.`);
  const { deleteAllImages } = await import('./productImages');
  await deleteAllImages(id);
  await tx(async (q) => {
    await q.query('delete from price_rules where product_id = $1', [id]);
    await q.query('delete from promise_rules where product_id = $1', [id]);
    await q.query('update coupons set product_ids = array_remove(product_ids, $1::uuid) where $1::uuid = any(product_ids)', [id]);
    await q.query('delete from products where id = $1', [id]);
  });
}

// ---------- The "custom order" product ----------
/** The one internal product that custom jobs without a regular product hang on. Created the first time it is needed. */
export async function customProductId(): Promise<string> {
  const have = await one<{ id: string }>("select id from products where slug = 'custom-order'");
  if (have) return have.id;
  const r = await one<{ id: string }>(
    `insert into products (slug, name, blurb, pricing_mode, check_class, active, system, sort, allow_custom)
     values ('custom-order', 'Custom order', 'A job priced by a person.', 'tier', 'print', false, true, 9999, false)
     on conflict (slug) do update set slug = excluded.slug returning id`,
  );
  return r!.id;
}
