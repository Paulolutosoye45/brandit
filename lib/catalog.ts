import { query, one } from './db';
import type { Product, Zone } from './types';
import type { PriceRule } from './pricing';
import type { PromiseRule } from './promise';
import { naira } from './money';
import { fromPrice } from './priceEngine';

const toProduct = (r: any): Product => ({
  id: r.id, slug: r.slug, name: r.name, blurb: r.blurb, pricing_mode: r.pricing_mode,
  options: r.options ?? [], sizes: r.sizes ?? [], print_w_in: r.print_w_in, print_h_in: r.print_h_in,
  check_class: r.check_class, active: r.active, sort: r.sort,
  description: r.description ?? '', highlights: r.highlights ?? [], category: r.category ?? '', allow_custom: r.allow_custom ?? true,
  packages: r.packages ?? [], qty_custom: r.qty_custom ?? false, qty_min: r.qty_min ?? null, qty_max: r.qty_max ?? null,
  personalise: !!r.personalise, sample: !!r.sample,
});

/** Customers see only products that are on sale. Internal rows (the "custom order" product) are never listed. */
export async function listProducts(includeInactive = false): Promise<Product[]> {
  // The sample pack is sold on its own page; it is not a product to design, quote or put in a campaign.
  const rows = await query(`select * from products where not system ${includeInactive ? '' : 'and active and not sample'} order by sort, name`);
  return rows.map(toProduct);
}

export async function getProduct(slug: string): Promise<Product | null> {
  const r = await one('select * from products where slug = $1 and not system', [slug]);
  return r ? toProduct(r) : null;
}

/** By id: used for orders that already exist, so internal products are allowed here. */
export async function getProductById(id: string): Promise<Product | null> {
  const r = await one('select * from products where id = $1', [id]);
  return r ? toProduct(r) : null;
}

export async function getRules(productId: string): Promise<{ price: PriceRule[]; promise: PromiseRule }> {
  const price = await query('select config, quantity, size_key, price_kobo, rate_per_sqft_kobo, min_area_sqft, active, cost_kobo from price_rules where product_id = $1', [productId]);
  const pr = await one('select * from promise_rules where product_id = $1', [productId]);
  return {
    price: price as PriceRule[],
    promise: {
      eligible_24h: pr?.eligible_24h ?? false,
      max_quantity: pr?.max_quantity ?? null,
      max_area_sqft: pr?.max_area_sqft ?? null,
      max_size_rank: pr?.max_size_rank ?? null,
      excluded_choices: pr?.excluded_choices ?? [],
      standard_days: pr?.standard_days ?? 3,
    },
  };
}

export async function listZones(): Promise<Zone[]> {
  return (await query('select * from delivery_zones order by sort')) as Zone[];
}

export async function zoneForArea(area: string | null | undefined): Promise<Zone | null> {
  if (!area) return null;
  const r = await one('select * from delivery_zones where $1 = any(areas)', [area]);
  return (r as Zone) ?? null;
}

/** Quantity steps a customer can pick, from the active price rules. */
export async function quantitySteps(productId: string): Promise<number[]> {
  const rows = await query<{ quantity: number }>('select distinct quantity from price_rules where product_id = $1 and active and quantity is not null order by quantity', [productId]);
  return rows.map((r) => r.quantity);
}

/** "From ₦15,000 for 100" style text for catalogue cards, from numbers already read. */
export function fromTextOf(p: Pick<Product, 'pricing_mode' | 'slug'>, n: { lo: number | null; rate: number | null; firstQty: number | null }): string {
  if (p.pricing_mode === 'area') return n.rate ? `${naira(n.rate)} per sq ft` : 'Ask for a price';
  if (!n.lo) return 'Ask for a price';
  const per = p.pricing_mode === 'tier' ? (n.firstQty && n.firstQty > 1 ? ` for ${n.firstQty.toLocaleString('en-US')}` : ' each') : p.slug === 'picture-frames' ? '' : ' each';
  return `From ${naira(n.lo)}${per}`;
}

export async function fromText(p: Product): Promise<string> {
  const rules = (await getRules(p.id)).price;
  const f = fromPrice(p, rules);
  return fromTextOf(p, { lo: f.kobo, rate: f.ratePerSqft, firstQty: f.quantity });
}

export type CatalogCard = { product: Product; from: string; cover: string | null; coverAlt: string; fast: boolean };

/** Everything the catalogue needs in two queries: products with their cover photo, and every price rule to work out "from" text. */
export async function listCatalog(includeInactive = false, withSample = false): Promise<CatalogCard[]> {
  const rows = await query<any>(
    `select p.*,
       (select id from product_images i where i.product_id = p.id order by i.sort, i.created_at limit 1) as cover_id,
       (select alt from product_images i where i.product_id = p.id order by i.sort, i.created_at limit 1) as cover_alt,
       coalesce((select eligible_24h from promise_rules pr where pr.product_id = p.id), false) as fast
     from products p where not p.system ${includeInactive ? '' : 'and p.active'} ${withSample ? '' : 'and not p.sample'} order by p.sort, p.name`,
  );
  const rules = await query<any>('select product_id, config, quantity, size_key, price_kobo, rate_per_sqft_kobo, min_area_sqft, active, cost_kobo from price_rules where active');
  const byProduct = new Map<string, PriceRule[]>();
  for (const r of rules) byProduct.set(r.product_id, [...(byProduct.get(r.product_id) ?? []), r as PriceRule]);
  return rows.map((r) => {
    const product = toProduct(r);
    const f = fromPrice(product, byProduct.get(product.id) ?? []);
    return { product, from: fromTextOf(product, { lo: f.kobo, rate: f.ratePerSqft, firstQty: f.quantity }), cover: r.cover_id ?? null, coverAlt: r.cover_alt || r.name, fast: !!r.fast };
  });
}

export type ProductImage = { id: string; alt: string; sort: number; width_px: number | null; height_px: number | null };
export async function productImages(productId: string): Promise<ProductImage[]> {
  return query<ProductImage>('select id, alt, sort, width_px, height_px from product_images where product_id = $1 order by sort, created_at', [productId]);
}

/** The categories in use, in the order products first appear. Customers get filter chips when there are two or more. */
export const CATEGORY_ORDER = ['Cards and stationery', 'Marketing prints', 'Banners and signs', 'Tees and Totes', 'Frames and gifts', 'IDs and events'];
export function categoriesOf(cards: { product: Product }[]): string[] {
  const seen: string[] = [];
  for (const c of cards) {
    const k = c.product.category.trim();
    if (k && !seen.includes(k)) seen.push(k);
  }
  // The usual groups come in the usual order; any group the team adds follows them.
  const rank = (k: string) => { const i = CATEGORY_ORDER.indexOf(k); return i === -1 ? CATEGORY_ORDER.length : i; };
  return seen.map((k, i) => ({ k, i })).sort((a, b) => rank(a.k) - rank(b.k) || a.i - b.i).map((x) => x.k);
}

export { imageUrl } from './catalog-urls';

/** The smallest price a customer could pay for this product, in kobo: for search engines and "from" text. */
export async function lowestPriceKobo(p: Product): Promise<number | null> {
  const f = fromPrice(p, (await getRules(p.id)).price);
  return f.kobo ?? f.ratePerSqft;
}
