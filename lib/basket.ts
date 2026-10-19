import { cookies } from 'next/headers';
import { one, query } from './db';
import { addLine, createDraft, designFeeOf, getItems, getOrder, isOpen, recomputeOrder, type LineInput } from './orders';
import { sign, verify, sessionCookieOptions, getCustomer } from './session';
import { lineReady, noFileKind, proofStateOf, type ProofState } from './lines';
import { getProductById } from './catalog';
import { getSettings } from './settings';
import { kindOf } from './options';
import type { NameRow } from './nameListCore';

/*
 * The basket is the customer's open, unpaid order. A browser holds a signed cookie pointing at it, so a guest keeps their
 * basket without an account. The moment they sign in, the basket belongs to them and follows them to any device.
 * An order that is paid, cancelled or made from a custom quote is never a basket.
 */

export const BASKET_COOKIE = 'bb';
const DAYS = 30;

export async function readBasketCookie(): Promise<string | null> {
  const p = verify<{ oid: string }>((await cookies()).get(BASKET_COOKIE)?.value);
  return p?.oid && /^[0-9a-f-]{36}$/.test(p.oid) ? p.oid : null;
}
export async function setBasketCookie(orderId: string) {
  (await cookies()).set(BASKET_COOKIE, sign({ oid: orderId }, DAYS * 86_400), sessionCookieOptions(DAYS * 86_400));
}
export async function clearBasketCookie() {
  (await cookies()).delete(BASKET_COOKIE);
}

type Row = Record<string, any>;
const usable = (o: Row | null | undefined): o is Row => !!o && isOpen(o) && !o.custom_request_id;

/** The open basket of this browser or this signed-in customer, if there is one. Attaches a guest basket to the customer who signs in. */
export async function currentBasket(): Promise<Row | null> {
  const me = await getCustomer().catch(() => null);
  const id = await readBasketCookie();
  let o = id ? await getOrder(id) : null;
  if (!usable(o)) o = null;
  // A basket that belongs to someone else's account is not ours to show.
  if (o && o.customer_id && me && o.customer_id !== me.id) o = null;
  if (o && o.customer_id && !me) o = null;
  if (!o && me) {
    o = await one<Row>(
      `select o.* from orders o where o.customer_id = $1 and o.status in ('draft','awaiting_payment') and o.custom_request_id is null
         and exists (select 1 from order_items i where i.order_id = o.id) order by o.created_at desc limit 1`, [me.id]);
  }
  if (o && me && !o.customer_id) {
    await query('update orders set customer_id = $2 where id = $1 and customer_id is null', [o.id, me.id]);
    o.customer_id = me.id;
  }
  return o;
}

/** A line as the basket, the builder and the checkout show it. Nothing about cost. */
export type LineView = {
  id: string;
  slug: string;
  name: string;
  quantity: number;
  sizeLabel: string | null;
  choices: string[];
  priceKobo: number;
  designKobo: number;
  artworkPath: 'upload' | 'design' | 'studio' | null;
  /** For a Studio line: which design (Standard or Premium) and which design in My designs. */
  studioTier: 'standard' | 'premium' | null;
  studioProjectId: string | null;
  artworkFileId: string | null;
  /** When the file on the line is our copy with the extra edge: the file the customer uploaded. */
  artworkOriginalFileId: string | null;
  artworkName: string | null;
  approved: boolean;
  ready: boolean;
  proof: ProofState;
  checkStatus: 'pass' | 'warn' | 'stop' | null;
  checkHeadline: string | null;
  /** The choices as made, so the builder can open this line to change it. */
  config: Record<string, string>;
  sizeKey: string | null;
  widthFt: number | null;
  heightFt: number | null;
  /** This product takes a list of names, and the list on this line (if any). */
  personalise: boolean;
  names: NameRow[] | null;
};

export type BasketView = {
  orderId: string;
  token: string;
  lines: LineView[];
  count: number;
  subtotalKobo: number;
  designKobo: number;
  allReady: boolean;
  area: string | null;
  pickup: boolean;
};

export async function viewOf(orderId: string): Promise<BasketView | null> {
  const o = await getOrder(orderId);
  if (!o) return null;
  const items = await getItems(orderId);
  const st = await getSettings();
  const lines: LineView[] = [];
  for (const it of items) {
    const p = await getProductById(it.product_id);
    if (!p) continue;
    const file = it.artwork_file_id ? await one<Row>('select original_name, check_result, original_file_id from files where id = $1', [it.artwork_file_id]) : null;
    const size = p.sizes.length > 1 ? p.sizes.find((s) => s.key === it.size_key)?.label ?? null : null;
    const choices: string[] = [];
    for (const opt of p.options) {
      const v = it.config?.[opt.key];
      if (!v || v === opt.default || v === 'auto') continue;
      if (kindOf(opt) === 'split') { choices.push(`${opt.label}: ${v.split(',').filter(Boolean).map((x: string) => { const [k, n] = x.split(':'); const c = opt.choices.find((y) => y.value === k); return `${c?.label ?? k}${n ? ` ${n}` : ''}`; }).join(', ')}`); continue; }
      const labels = v.split(',').filter(Boolean).map((x: string) => opt.choices.find((c) => c.value === x)?.label ?? x);
      choices.push(`${opt.label}: ${labels.join(', ')}`);
    }
    const designKobo = designFeeOf(st, it);
    lines.push({
      id: it.id, slug: p.slug, name: it.label ?? p.name, quantity: it.quantity,
      sizeLabel: it.width_ft ? `${it.width_ft} × ${it.height_ft} ft` : size,
      choices, priceKobo: it.line_total_kobo, designKobo,
      artworkPath: it.artwork_path, studioTier: it.studio_tier ?? null, studioProjectId: it.studio_project_id ?? null, artworkFileId: it.artwork_file_id, artworkOriginalFileId: file?.original_file_id ?? null, artworkName: file?.original_name ?? null,
      approved: !!it.preview_approved_at, ready: lineReady(it as any) && (it.artwork_path === 'design' || it.artwork_path === 'studio' || !!it.artwork_file_id || noFileKind(it as any) !== null),
      proof: proofStateOf(it as any, null),
      checkStatus: file?.check_result?.status ?? null, checkHeadline: file?.check_result?.headline ?? null,
      config: it.config ?? {}, sizeKey: it.size_key ?? null, widthFt: it.width_ft ?? null, heightFt: it.height_ft ?? null,
      personalise: p.personalise, names: it.names ?? null,
    });
  }
  return {
    orderId: o.id, token: o.public_token, lines, count: lines.length,
    subtotalKobo: o.subtotal_kobo, designKobo: o.design_fee_kobo,
    allReady: lines.length > 0 && lines.every((l) => l.ready),
    area: o.area ?? null, pickup: !!o.pickup,
  };
}

/**
 * Put a product in the customer's basket, starting a basket if there is none. The price is worked out here.
 * `area` and `pickup` set where the whole basket goes, because delivery is one drop.
 */
export async function addToBasket(input: LineInput, startedFrom = 'product'): Promise<{ orderId: string; itemId: string } | { error: string }> {
  const me = await getCustomer().catch(() => null);
  const basket = await currentBasket();
  if (basket) {
    // The last choice of area wins: the basket goes to one place.
    if ((input.area && input.area !== basket.area) || (input.pickup != null && !!input.pickup !== !!basket.pickup)) {
      await query('update orders set area = coalesce($2, area), pickup = $3 where id = $1', [basket.id, input.area ?? null, input.pickup != null ? !!input.pickup : basket.pickup]);
    }
    const { area: _a, pickup: _p, needBy: _n, ...line } = input;
    void _a; void _p; void _n;
    const r = await addLine(basket.id, line);
    if ('error' in r) return r;
    await setBasketCookie(basket.id);
    return { orderId: basket.id, itemId: r.itemId };
  }
  const d = await createDraft(input, startedFrom);
  if ('error' in d) return d;
  if (me) await query('update orders set customer_id = $2 where id = $1', [d.id, me.id]);
  await setBasketCookie(d.id);
  const first = (await getItems(d.id))[0];
  return { orderId: d.id, itemId: first.id };
}

/** Make a basket that is not the browser's yet (a reorder, a template) the one the browser carries. */
export async function adoptBasket(orderId: string) {
  const me = await getCustomer().catch(() => null);
  const o = await getOrder(orderId);
  if (!usable(o)) return;
  if (o.customer_id && (!me || o.customer_id !== me.id)) return;
  await setBasketCookie(orderId);
}

/** How many products are in the basket, for the badge. Zero when there is none. */
export async function basketCount(): Promise<number> {
  const b = await currentBasket();
  if (!b) return 0;
  const r = await one<{ n: number }>('select count(*)::int as n from order_items where order_id = $1', [b.id]);
  return r?.n ?? 0;
}

export { recomputeOrder };
