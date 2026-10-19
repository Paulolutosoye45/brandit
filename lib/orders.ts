import { sendReceiptEmail } from './receipts';
import { query, one, tx, type Q } from './db';
import { getProductById, getRules, zoneForArea } from './catalog';
import { getSettings } from './settings';
import { studioFeeKobo, STUDIO_WAIT } from './studio/fees';
import { makeQuote, slotsUsedOn, sizeRankOf, promiseChoices } from './quote';
import { priceOrder } from './pricing';
import { priceConfigured } from './priceEngine';
import { promise as makePromise, slowest, type PromiseResult } from './promise';
import { nameSql, noFileKind } from './lines';
import { markSampleLine } from './samplePack';
import { claimBusiness } from './businessAccounts';
import { describeArrival, productionDay } from './time';
import { windowToStore } from './windows';
import { normalizePhone } from './phone';
import { token } from './password';
import { appUrl, flushMessages, queueMessage } from './messages';
import { validateCoupon, recordRedemption, type Identity } from './coupons';

type Row = Record<string, any>;

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

export async function getOrder(id: string): Promise<Row | null> {
  return one('select * from orders where id = $1', [id]);
}
export async function getOrderByToken(tok: string): Promise<Row | null> {
  return one('select * from orders where public_token = $1', [tok]);
}
/** One line of an order: the one asked for, or the first. */
export async function getItem(orderId: string, itemId?: string | null): Promise<Row | null> {
  if (itemId) return one('select * from order_items where order_id = $1 and id = $2', [orderId, itemId]);
  return one('select * from order_items where order_id = $1 order by position, id limit 1', [orderId]);
}
/** Every line of an order, in the order the customer added them. */
export async function getItems(orderId: string): Promise<Row[]> {
  return query('select * from order_items where order_id = $1 order by position, id', [orderId]);
}

export const OPEN = ['draft', 'awaiting_payment'];
export const isOpen = (o: Row | null | undefined) => !!o && OPEN.includes(o.status);

// ---------- Draft ----------
export type LineInput = Parameters<typeof makeQuote>[0];

export async function createDraft(input: LineInput, startedFrom?: string): Promise<{ id: string } | { error: string }> {
  const now = new Date();
  const quote = await makeQuote(input, now);
  if (!quote.ok) return { error: quote.message };
  const s = await getSettings();
  const totals = priceOrder({ itemsKobo: [quote.priceKobo], deliveryFeeKobo: quote.zone?.fee_kobo ?? 0, pickup: !!input.pickup, vatRate: s.vat_rate, pricesIncludeVat: s.prices_include_vat });
  const id = await tx(async (q) => {
    const n = (await q.query<{ n: number }>("select nextval('order_seq')::int as n"))[0].n;
    const o = await q.query<{ id: string }>(
      `insert into orders (code, public_token, status, subtotal_kobo, delivery_fee_kobo, vat_kobo, total_kobo, zone_id, area, pickup, speed, production_day, promised_at, promise_reasons, hold_expires_at, need_by, started_from)
       values ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
      [`BR-${n}`, token(14), totals.subtotalKobo, totals.deliveryKobo, totals.vatKobo, totals.totalKobo, quote.zone?.id ?? null, input.area ?? null, !!input.pickup, quote.tier, quote.productionDay, quote.arriveBy, JSON.stringify(quote.reasons), new Date(now.getTime() + s.hold_minutes * 60000).toISOString(), input.needBy ?? null, startedFrom ?? null],
    );
    const line = await q.query<{ id: string }>(
      `insert into order_items (order_id, product_id, config, size_key, quantity, width_ft, height_ft, line_total_kobo, position)
       values ($1,$2,$3,$4,$5,$6,$7,$8,0) returning id`,
      [o[0].id, quote.product.id, JSON.stringify(quote.config), quote.sizeKey, quote.quantity, input.widthFt ?? null, input.heightFt ?? null, quote.priceKobo],
    );
    if (quote.product.sample) await markSampleLine(q, line[0].id);
    await q.query("insert into events (name, props) values ('draft_created', $1)", [JSON.stringify({ product: quote.product.slug, tier: quote.tier })]);
    return o[0].id;
  });
  return { id };
}

/** Who a coupon check should count: the customer on the order, once there is one. */
export async function identityOf(o: Row): Promise<Identity> {
  if (!o.customer_id) return {};
  const c = await one<{ id: string; phone: string | null; email: string | null }>('select id, phone, email from customers where id = $1', [o.customer_id]);
  return c ? { customerId: c.id, phone: c.phone, email: c.email } : {};
}

export type RecomputeResult = { ok: true; couponMessage?: string } | { ok: false; error: string; itemId?: string };

/** How a line is priced again: its own choices, and where and how it is going. */
const quoteInputOf = (o: Row, item: Row): LineInput => ({
  slug: '', quantity: item.quantity, config: item.config, sizeKey: item.size_key ?? undefined, widthFt: item.width_ft ?? undefined, heightFt: item.height_ft ?? undefined,
  area: o.area, pickup: o.pickup, needBy: iso(o.need_by),
});

/** What a line's design costs on top of printing: the designer's flat fee, the fix fee, or Studio's price less its print credit. */
export const designFeeOf = (s: Awaited<ReturnType<typeof getSettings>>, item: Row) => {
  if (item.artwork_path === 'design') return item.design_brief?.fix ? s.fix_fee_kobo : s.design_fee_kobo;
  if (item.artwork_path === 'studio' && item.studio_tier) return studioFeeKobo(s, item.studio_tier);
  return 0;
};

/**
 * Re-price and re-promise a draft or unpaid order, line by line. The server decides the price, always.
 * Delivery is one drop, so it is charged once. The order arrives when its slowest line is ready.
 * A coupon that stopped being valid (it expired, or the customer's details show they used it before) is taken off,
 * and the reason comes back so the customer is told before they pay a different amount.
 */
export async function recomputeOrder(orderId: string, now = new Date()): Promise<RecomputeResult> {
  const o = await getOrder(orderId);
  if (!o) return { ok: false, error: 'Order not found.' };
  const items = await getItems(orderId);
  const s = await getSettings();

  // An empty basket costs nothing and promises nothing.
  if (items.length === 0) {
    await query(
      `update orders set subtotal_kobo=0, delivery_fee_kobo=0, design_fee_kobo=0, vat_kobo=0, total_kobo=0, discount_kobo=0, speed=null, production_day=null, promised_at=null, promise_reasons='[]', hold_expires_at=$2 where id=$1`,
      [orderId, new Date(now.getTime() + s.hold_minutes * 60000).toISOString()],
    );
    return { ok: true };
  }

  // Custom orders carry a price a person quoted. Everything else is priced from the rules.
  const custom = o.custom_request_id ? await one<Row>('select * from custom_requests where id = $1', [o.custom_request_id]) : null;
  const priced: { item: Row; productId: string; priceKobo: number; designKobo: number; promise: PromiseResult | null }[] = [];
  let zone: Awaited<ReturnType<typeof zoneForArea>>;
  if (custom) {
    if (!custom.quote_price_kobo) return { ok: false, error: 'This custom quote is not ready yet.' };
    priced.push({ item: items[0], productId: items[0].product_id, priceKobo: custom.quote_price_kobo, designKobo: 0, promise: null });
    zone = await zoneForArea(o.area);
  } else {
    zone = await zoneForArea(o.area);
    for (const item of items) {
      const product = await getProductById(item.product_id);
      if (!product) return { ok: false, error: 'A product in your basket is not sold any more. Remove it to continue.', itemId: item.id };
      const quote = await makeQuote({ ...quoteInputOf(o, item), slug: product.slug }, now);
      if (!quote.ok) return { ok: false, error: items.length > 1 ? `${item.label ?? product.name}: ${quote.message}` : quote.message, itemId: item.id };
      priced.push({ item, productId: product.id, priceKobo: quote.priceKobo, designKobo: designFeeOf(s, item), promise: quote.promiseResult });
      zone = quote.zone;
    }
  }
  const designKobo = priced.reduce((a, l) => a + l.designKobo, 0);
  const deliveryFee = o.pickup ? 0 : (zone?.fee_kobo ?? 0);
  const lineKobo = priced.map((l) => l.priceKobo);

  let discount = 0;
  let couponId: string | null = o.coupon_id ?? null;
  let couponCode: string | null = o.coupon_code ?? null;
  let couponMessage: string | undefined;
  if (couponId && couponCode) {
    const v = await validateCoupon(couponCode, {
      subtotalKobo: lineKobo.reduce((a, b) => a + b, 0), designKobo, deliveryKobo: deliveryFee, productId: priced[0].productId,
      lines: priced.map((l) => ({ productId: l.productId, kobo: l.priceKobo })),
      orderId: o.id, identity: await identityOf(o), now, custom: !!custom,
    });
    if (v.ok) discount = v.discountKobo;
    else { couponId = null; couponCode = null; couponMessage = v.message; }
  }

  const t = priceOrder({ itemsKobo: lineKobo, deliveryFeeKobo: zone?.fee_kobo ?? 0, pickup: o.pickup, designFeeKobo: designKobo, discountKobo: discount, vatRate: s.vat_rate, pricesIncludeVat: s.prices_include_vat });
  // A basket with a designer's line gets its arrival time when the last proof is approved. Otherwise the slowest line decides.
  const anyDesign = priced.some((l) => l.item.artwork_path === 'design' || l.item.artwork_path === 'studio');
  const promise = !anyDesign && !custom && priced.every((l) => l.promise) ? slowest(priced.map((l) => l.promise!)) : null;
  await tx(async (q) => {
    for (const l of priced) await q.query('update order_items set line_total_kobo = $2, studio_fee_kobo = $3 where id = $1', [l.item.id, l.priceKobo, l.item.artwork_path === 'studio' ? l.designKobo : 0]);
    await q.query(
      `update orders set subtotal_kobo=$2, delivery_fee_kobo=$3, design_fee_kobo=$4, vat_kobo=$5, total_kobo=$6, zone_id=$7,
         speed=$8, production_day=$9, promised_at=$10, promise_reasons=$11, hold_expires_at=$12, discount_kobo=$13, coupon_id=$14, coupon_code=$15 where id=$1`,
      [orderId, t.subtotalKobo, t.deliveryKobo, t.designKobo, t.vatKobo, t.totalKobo, zone?.id ?? null,
        promise?.tier ?? null, promise?.productionDay ?? null, promise?.arriveBy ?? null, JSON.stringify(promise?.reasons ?? []),
        new Date(now.getTime() + s.hold_minutes * 60000).toISOString(), t.discountKobo, couponId, couponCode],
    );
  });
  return couponMessage ? { ok: true, couponMessage } : { ok: true };
}

export async function setArtworkPath(orderId: string, path: 'upload' | 'design', brief?: Record<string, unknown>, itemId?: string | null) {
  const item = await getItem(orderId, itemId);
  if (!item) return;
  // Choosing another way to give the artwork lets go of a Studio design on this line (the design itself stays in My designs).
  await query('update order_items set artwork_path = $2, design_brief = $3, studio_tier = null, studio_fee_kobo = 0, studio_project_id = null, preview_approved_at = case when $2 = $4 then preview_approved_at else null end where id = $1', [item.id, path, brief ? JSON.stringify(brief) : null, 'upload']);
  await recomputeOrder(orderId);
}

// ---------- The basket: add, change and remove lines ----------
const CHANGES_PRINT = (before: Row, after: { sizeKey?: string | null; widthFt?: number | null; heightFt?: number | null; config: Record<string, string> }) => {
  // null, undefined and "" all mean "no value", and a number is a number whether it came from the database as text or not.
  const key = (v: unknown) => (v == null || v === '' ? null : String(v));
  const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
  // The database hands the choices back in its own key order, so compare them by name.
  const same = (a: Record<string, string>, b: Record<string, string>) => { const k = new Set([...Object.keys(a), ...Object.keys(b)]); return [...k].every((x) => (a[x] ?? '') === (b[x] ?? '')); };
  return key(before.size_key) !== key(after.sizeKey) || num(before.width_ft) !== num(after.widthFt) || num(before.height_ft) !== num(after.heightFt)
    || !same(before.config ?? {}, after.config ?? {});
};

/** Add a product to an unpaid order. The price is worked out here, from the rules, never taken from the browser. */
export async function addLine(orderId: string, input: Omit<LineInput, 'area' | 'pickup'>, now = new Date()): Promise<{ itemId: string } | { error: string }> {
  const o = await getOrder(orderId);
  if (!o || !isOpen(o) || o.custom_request_id) return { error: 'This order can no longer be changed.' };
  const quote = await makeQuote({ ...input, area: o.area, pickup: o.pickup, needBy: iso(o.need_by) }, now);
  if (!quote.ok) return { error: quote.message };
  const n = (await one<{ n: number }>('select count(*)::int as n from order_items where order_id = $1', [orderId]))!.n;
  if (n >= 12) return { error: 'A basket holds up to 12 products. Pay for this one first, then start another.' };
  const row = await one<{ id: string }>(
    `insert into order_items (order_id, product_id, config, size_key, quantity, width_ft, height_ft, line_total_kobo, position)
     values ($1,$2,$3,$4,$5,$6,$7,$8,(select coalesce(max(position), -1) + 1 from order_items where order_id = $1)) returning id`,
    [orderId, quote.product.id, JSON.stringify(quote.config), quote.sizeKey, quote.quantity, input.widthFt ?? null, input.heightFt ?? null, quote.priceKobo],
  );
  if (quote.product.sample) await markSampleLine({ query }, row!.id);
  await query("insert into events (name, props) values ('line_added', $1)", [JSON.stringify({ order: o.code, product: quote.product.slug })]);
  const r = await recomputeOrder(orderId, now);
  if (!r.ok) return { error: r.error };
  return { itemId: row!.id };
}

/** Change the amount or the choices on a line. The artwork stays unless the size changed, because the file check depends on the size. */
export async function updateLine(orderId: string, itemId: string, patch: { quantity?: number; config?: Record<string, string>; sizeKey?: string | null; widthFt?: number | null; heightFt?: number | null }, now = new Date()): Promise<{ ok: true; reset: boolean } | { error: string }> {
  const o = await getOrder(orderId);
  const item = await getItem(orderId, itemId);
  if (!o || !item || !isOpen(o) || o.custom_request_id) return { error: 'This order can no longer be changed.' };
  const product = await getProductById(item.product_id);
  if (!product) return { error: 'We could not find that product.' };
  const next = {
    quantity: patch.quantity ?? item.quantity,
    config: patch.config ?? item.config ?? {},
    sizeKey: patch.sizeKey !== undefined ? patch.sizeKey : (item.size_key ?? null),
    widthFt: patch.widthFt !== undefined ? patch.widthFt : (item.width_ft ?? null),
    heightFt: patch.heightFt !== undefined ? patch.heightFt : (item.height_ft ?? null),
  };
  const quote = await makeQuote({ slug: product.slug, quantity: next.quantity, config: next.config, sizeKey: next.sizeKey ?? undefined, widthFt: next.widthFt ?? undefined, heightFt: next.heightFt ?? undefined, area: o.area, pickup: o.pickup, needBy: iso(o.need_by) }, now);
  if (!quote.ok) return { error: quote.message };
  const reset = CHANGES_PRINT(item, { sizeKey: quote.sizeKey, widthFt: next.widthFt, heightFt: next.heightFt, config: quote.config });
  await query(
    `update order_items set quantity=$2, config=$3, size_key=$4, width_ft=$5, height_ft=$6, line_total_kobo=$7,
       preview_approved_at = case when $8 then null else preview_approved_at end,
       artwork_path = case when $8 and artwork_path = 'studio' then null else artwork_path end,
       studio_tier = case when $8 then null else studio_tier end,
       studio_project_id = case when $8 then null else studio_project_id end
     where id=$1`,
    [item.id, quote.quantity, JSON.stringify(quote.config), quote.sizeKey, next.widthFt, next.heightFt, quote.priceKobo, reset],
  );
  const r = await recomputeOrder(orderId, now);
  return r.ok ? { ok: true, reset } : { error: r.error };
}

/** Take a line out of an unpaid order. Its files are marked for deletion with the next clean-up. */
export async function removeLine(orderId: string, itemId: string): Promise<{ ok: true; left: number } | { error: string }> {
  const o = await getOrder(orderId);
  const item = await getItem(orderId, itemId);
  if (!o || !item || !isOpen(o) || o.custom_request_id) return { error: 'This order can no longer be changed.' };
  await tx(async (q) => {
    await q.query("update files set order_item_id = null, delete_after = now() where order_item_id = $1", [item.id]);
    await q.query('delete from order_items where id = $1', [item.id]);
  });
  await query("insert into events (name, props) values ('line_removed', $1)", [JSON.stringify({ order: o.code })]);
  const r = await recomputeOrder(orderId);
  if (!r.ok) return { error: r.error };
  const left = (await one<{ n: number }>('select count(*)::int as n from order_items where order_id = $1', [orderId]))!.n;
  return { ok: true, left };
}

/** Where the whole basket goes. Delivery is one drop, so the area and the pickup choice belong to the order, not to a line. */
export async function setDelivery(orderId: string, d: { area?: string | null; pickup?: boolean }, now = new Date()): Promise<{ ok: true } | { error: string }> {
  const o = await getOrder(orderId);
  if (!o || !isOpen(o)) return { error: 'This order can no longer be changed.' };
  const pickup = d.pickup != null ? !!d.pickup : !!o.pickup;
  const area = d.area !== undefined ? d.area : o.area;
  if (area && !(await zoneForArea(area))) return { error: 'We do not deliver to that area yet. Choose pickup, or message us and we will arrange a rider.' };
  await query('update orders set area = $2, pickup = $3 where id = $1', [orderId, area || null, pickup]);
  const r = await recomputeOrder(orderId, now);
  return r.ok ? { ok: true } : { error: r.error };
}

/** The customer looked at the preview and said "this is what will print." */
export async function approveLine(orderId: string, itemId?: string | null): Promise<{ ok: true; itemId: string } | { ok: false; error: string; status: number }> {
  const o = await getOrder(orderId);
  const item = o && (await getItem(orderId, itemId));
  if (!o || !item) return { ok: false, error: 'Order not found.', status: 404 };
  const job = await one('select stage from jobs where order_item_id = $1', [item.id]);
  if (!isOpen(o) && job?.stage !== 'file_check') return { ok: false, error: 'This order is already in production.', status: 409 };
  if (!item.artwork_file_id) return { ok: false, error: 'Upload a file first.', status: 400 };
  const f = await one('select check_result from files where id = $1', [item.artwork_file_id]);
  if (f?.check_result?.status === 'stop') return { ok: false, error: 'That file needs fixing before we can print it.', status: 400 };
  await query('update order_items set preview_approved_at = now() where id = $1', [item.id]);
  return { ok: true, itemId: item.id };
}

// ---------- Checkout ----------
export type CheckoutInput = {
  name: string;
  phone: string;
  email: string;
  company?: string;
  taxId?: string;
  pickup: boolean;
  area?: string;
  addressLine?: string;
  plainPack?: boolean;
  needBy?: string | null;
  window?: 'morning' | 'afternoon' | null;
};

export async function saveCheckout(orderId: string, d: CheckoutInput, signedInCustomerId?: string | null, opts: { staffBuilt?: boolean } = {}): Promise<{ ok: true; couponMessage?: string } | { ok: false; error: string; field?: string }> {
  const o = await getOrder(orderId);
  if (!o || !['draft', 'awaiting_payment'].includes(o.status)) return { ok: false, error: 'This order can no longer be changed.' };
  const phone = normalizePhone(d.phone);
  if (!phone) return { ok: false, error: 'Enter a Nigerian mobile number, like 0803 123 4567.', field: 'phone' };
  const name = d.name?.trim();
  if (!name || name.length < 2) return { ok: false, error: 'Tell us your name so the rider knows who to look for.', field: 'name' };
  const email = d.email?.trim().toLowerCase() ?? '';
  // The team can build an order from a chat with no email. Everyone else needs one for the receipt.
  if ((email || !opts.staffBuilt) && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'Enter an email address for your receipt.', field: 'email' };
  let zoneArea: string | null = null;
  if (!d.pickup) {
    const zone = await zoneForArea(d.area);
    if (!zone) return { ok: false, error: 'Choose your area so we can show the delivery fee and arrival time.', field: 'area' };
    if (!d.addressLine || d.addressLine.trim().length < 5) return { ok: false, error: 'Add the street address and a landmark.', field: 'address' };
    zoneArea = d.area!;
  }

  const windowsOn = (await getSettings()).windows_enabled;
  const customerId = await tx(async (q: Q) => {
    let c: { id: string; business_id: string | null; business_role: string | null }[];
    if (signedInCustomerId) {
      // A signed-in customer keeps one account: the number typed here becomes where we send updates.
      c = await q.query<{ id: string; business_id: string | null; business_role: string | null }>(
        `update customers set name = coalesce(nullif($2, ''), name),
           email = case when email_verified then email else $3 end,
           whatsapp_phone = case when phone = $4 then null else $4 end
         where id = $1 returning id, business_id, business_role`,
        [signedInCustomerId, name, email, phone],
      );
      if (!c[0]) throw new Error('Customer not found');
    } else {
      c = await q.query<{ id: string; business_id: string | null; business_role: string | null }>(
        `insert into customers (phone, name, email) values ($1,$2,$3)
         on conflict (phone) do update set name = excluded.name, email = case when customers.email_verified then customers.email else coalesce(excluded.email, customers.email) end returning id, business_id, business_role`,
        [phone, name, email || null],
      );
    }
    let businessId = c[0].business_id;
    const company = d.company?.trim();
    // Someone who joined a company orders for it: the company name typed here cannot move them out of it.
    if (company && c[0].business_role !== 'member') {
      const b = await q.query<{ id: string }>('select id from businesses where id = $1 and lower(name) = lower($2)', [businessId, company]);
      businessId = b[0]?.id ?? (await q.query<{ id: string }>('insert into businesses (name) values ($1) returning id', [company]))[0].id;
      await q.query('update customers set business_id = $2 where id = $1', [c[0].id, businessId]);
      const tin = d.taxId?.trim().slice(0, 30);
      if (tin) await q.query('update businesses set tax_id = $2 where id = $1', [businessId, tin]);
    }
    if (businessId) await claimBusiness(q, businessId, c[0].id);
    await q.query(
      `update orders set customer_id=$2, business_id=$3, pickup=$4, area=$5, address=$6, plain_pack=$7, need_by=$8, status='awaiting_payment', checkout_saved_at=now(), delivery_window = $9 where id=$1`,
      [orderId, c[0].id, businessId, !!d.pickup, zoneArea, JSON.stringify({ line1: d.addressLine?.trim() ?? null, area: zoneArea, contact_phone: phone, name }), !!d.plainPack && !!company, d.needBy || null, windowToStore(d.window, { pickup: !!d.pickup, enabled: windowsOn })],
    );
    return c[0].id;
  });
  void customerId;
  await query("insert into events (name, props) values ('checkout_saved', $1)", [JSON.stringify({ order: o.code })]);
  return recomputeOrder(orderId);
}

// ---------- Promise for an existing order ----------
/**
 * The promise for an order that exists. Each line gets its own promise from its own rule, and the order arrives with its slowest line.
 * `item` and `product` are the first line, for callers that only care about one.
 */
export async function promiseFor(orderId: string, now = new Date()) {
  const o = await getOrder(orderId);
  const items = o ? await getItems(orderId) : [];
  if (!o || items.length === 0) return null;
  const first = await getProductById(items[0].product_id);
  if (!first) return null;
  const s = await getSettings();
  const zone = await zoneForArea(o.area);
  const day = productionDay(now, s);
  const used = await slotsUsedOn(day, o.id);
  const custom = o.custom_request_id ? await one<Row>('select quote_days from custom_requests where id = $1', [o.custom_request_id]) : null;
  const inputs: Parameters<typeof makePromise>[0][] = [];
  for (const item of items) {
    if (custom) {
      // A custom job is never 24-hour. It takes as many working days as the quote says, counted from approval.
      inputs.push({
        rule: { eligible_24h: false, max_quantity: null, max_area_sqft: null, max_size_rank: null, excluded_choices: [], standard_days: custom.quote_days ?? 5 },
        settings: s, zoneEligible24h: zone ? zone.eligible_24h : true, pickup: o.pickup, quantity: item.quantity,
        totalAreaSqft: null, sizeRank: null, choices: [] as string[], slotsUsed: used, now,
      });
      continue;
    }
    const product = await getProductById(item.product_id);
    if (!product) continue;
    const { price, promise: rule } = await getRules(product.id);
    // The area and the choices matter to the promise. If a price has been taken away since the order was made, the order is
    // still honoured: we fall back to what the order itself says rather than fail a payment that has already left the customer.
    let areaSqft: number | null = null;
    let effective: Record<string, string> = item.config ?? {};
    try {
      const priced = priceConfigured(product, price, { quantity: item.quantity, config: item.config, sizeKey: item.size_key, widthFt: item.width_ft ?? undefined, heightFt: item.height_ft ?? undefined });
      areaSqft = priced.areaSqft;
      effective = priced.effective;
    } catch {
      if (item.width_ft && item.height_ft) areaSqft = Math.ceil(item.width_ft * item.height_ft) * item.quantity;
    }
    inputs.push({
      rule, settings: s, zoneEligible24h: zone ? zone.eligible_24h : true, pickup: o.pickup, quantity: item.quantity,
      totalAreaSqft: areaSqft, sizeRank: sizeRankOf(product, item.size_key), choices: promiseChoices(effective), slotsUsed: used, now,
    });
  }
  if (inputs.length === 0) return null;
  const fresh = slowest(inputs.map((i) => makePromise(i)));
  const standard = slowest(inputs.map((i) => makePromise({ ...i, settings: { ...s, slots_paused: true } })));
  return { order: o, item: items[0], items, product: first, settings: s, fresh, standard };
}

export const arriveLine = (p: { speed: string | null; promisedAt: Date | null; pickup: boolean }, now = new Date()) =>
  p.promisedAt ? `${p.pickup ? 'Ready for pickup' : 'Arriving'} ${describeArrival(p.promisedAt, now)}.` : 'We set your arrival time when you approve your proof.';

// ---------- Payment confirmed ----------
export type PaymentResult = { ok: true; orderId: string; duplicate?: boolean } | { ok: false; reason: 'UNKNOWN_REFERENCE' | 'AMOUNT_MISMATCH' | 'ORDER_STATE' };

/**
 * The only place an order becomes paid. Safe to call twice with the same reference, and it
 * refuses any amount that is not exactly what we asked for.
 */
export async function confirmPayment(p: { reference: string; amountKobo: number; method?: string; raw?: unknown }, now = new Date()): Promise<PaymentResult> {
  const pay = await one('select * from payments where provider_ref = $1', [p.reference]);
  if (!pay) return { ok: false, reason: 'UNKNOWN_REFERENCE' };
  if (pay.status === 'success') return { ok: true, orderId: pay.order_id, duplicate: true };
  const order = await getOrder(pay.order_id);
  if (!order) return { ok: false, reason: 'UNKNOWN_REFERENCE' };
  if (p.amountKobo !== pay.amount_kobo || pay.amount_kobo !== order.total_kobo) {
    await query("update payments set status = 'amount_mismatch', raw = $2 where id = $1", [pay.id, JSON.stringify(p.raw ?? {})]);
    return { ok: false, reason: 'AMOUNT_MISMATCH' };
  }
  if (!['awaiting_payment', 'draft'].includes(order.status)) {
    // Paid already by another reference, or cancelled. Keep the record; staff will see it.
    await query("update payments set status = 'review', raw = $2 where id = $1", [pay.id, JSON.stringify(p.raw ?? {})]);
    return { ok: false, reason: 'ORDER_STATE' };
  }

  const pair = await promiseFor(order.id, now); // reads happen before the transaction
  const items = pair!.items;
  // A basket with a designer's line gets its arrival time when the last proof is approved.
  const design = items.some((i: Row) => i.artwork_path === 'design' || i.artwork_path === 'studio');
  const hub = await one<{ id: string }>('select id from presses where not is_partner limit 1');

  const result = await tx(async (q) => {
    await q.query('select pg_advisory_xact_lock(42)');
    const locked = await q.query<Row>('select * from payments where id = $1 for update', [pay.id]);
    if (locked[0].status === 'success') return { duplicate: true as const };

    let speed: string | null = order.speed;
    let day: string | null = order.production_day;
    let promisedAt: Date | null = order.promised_at ? new Date(order.promised_at) : null;
    let reasons = order.promise_reasons ?? [];
    let changed = false;

    if (design) {
      speed = null; day = null; promisedAt = null;
    } else {
      const holdValid = order.hold_expires_at && new Date(order.hold_expires_at) > now;
      let use: PromiseResult | null = null;
      if (!holdValid) use = pair!.fresh;
      if (!use && speed === '24h' && day) {
        const used = await slotsUsedOn(day, order.id, q);
        if (used >= pair!.settings.daily_24h_slots) use = pair!.standard;
      }
      if (use) {
        changed = !promisedAt || use.arriveBy.getTime() !== promisedAt.getTime();
        speed = use.tier; day = use.productionDay; promisedAt = use.arriveBy; reasons = use.reasons;
      }
    }

    await q.query("update payments set status='success', method=$2, verified_at=$3, raw=$4 where id=$1", [pay.id, p.method ?? null, now.toISOString(), JSON.stringify(p.raw ?? {})]);
    const code = String(Math.floor(1000 + Math.random() * 9000));
    await q.query(
      `update orders set status='paid', paid_at=$2, speed=$3, production_day=$4, promised_at=$5, promise_reasons=$6, delivery_code=$7 where id=$1`,
      [order.id, now.toISOString(), speed, day, promisedAt?.toISOString() ?? null, JSON.stringify(reasons), code],
    );
    // One job for every line, so each one is checked, proofed, printed and inspected on its own.
    for (const item of items) {
      const job = await q.query<{ id: string }>('insert into jobs (order_id, order_item_id, stage, press_id) values ($1,$2,$3,$4) returning id', [order.id, item.id, 'paid', hub?.id ?? null]);
      await q.query("insert into job_events (job_id, from_stage, to_stage, note) values ($1, null, 'paid', 'Payment confirmed')", [job[0].id]);
      await q.query("update jobs set stage = 'file_check', updated_at = now() where id = $1", [job[0].id]);
      await q.query("insert into job_events (job_id, from_stage, to_stage, note) values ($1, 'paid', 'file_check', 'Sent to the file desk')", [job[0].id]);
      // A line made by Studio waits for the customer to approve a design. Its clock does not run until then.
      if (item.artwork_path === 'studio') await q.query("update jobs set clock_paused = true, paused_reason = $2, paused_at = now() where id = $1", [job[0].id, STUDIO_WAIT]);
      // An order the team built from a chat can be paid before the file arrives. The clock waits, and the customer is asked for it right away.
      if (noFileKind(item as any) === 'file_later' && !item.artwork_file_id) {
        await q.query("update jobs set clock_paused = true, paused_reason = $2, paused_at = now() where id = $1", [job[0].id, 'Waiting for the customer to send the artwork file.']);
        await queueMessage(q, { orderId: order.id, template: 'file_problem', vars: { issue: 'We still need your artwork file. We start printing as soon as it is checked.', link: `${appUrl()}/order/${order.id}/artwork?fix=1&item=${item.id}` } });
      }
    }
    await recordRedemption(q, { id: order.id, coupon_id: order.coupon_id ?? null, discount_kobo: order.discount_kobo ?? 0, customer_id: order.customer_id ?? null });
    await q.query("insert into events (name, props) values ('paid', $1)", [JSON.stringify({ order: order.code, total_kobo: order.total_kobo, coupon: order.coupon_code ?? null })]);

    const link = `${appUrl()}/track/${order.public_token}`;
    await queueMessage(q, { orderId: order.id, template: 'paid', vars: { code: order.code, arrive_line: arriveLine({ speed, promisedAt, pickup: order.pickup }, now), link } });
    if (changed) await queueMessage(q, { orderId: order.id, template: 'new_time', vars: { arrive_line: arriveLine({ speed, promisedAt, pickup: order.pickup }, now), link } });
    return { duplicate: false as const };
  });

  await flushMessages();
  if (!result.duplicate && design) {
    // Studio starts now that the money is in. If this fails the five-minute sweep tries again, so a paid design is never left unmade.
    try { await (await import('./studio/inOrder')).applyStudioLines(order.id); } catch (e) { console.error('[brandit] could not start the Studio design:', (e as Error)?.message ?? e); }
  }
  if (!result.duplicate) await sendReceiptEmail(order.id).catch((e) => console.error('[brandit] receipt email failed:', e?.message ?? e));
  return { ok: true, orderId: order.id, duplicate: result.duplicate };
}

// ---------- Customer views ----------
export async function ordersForCustomer(customerId: string): Promise<Row[]> {
  return query(
    `select o.id, o.code, o.public_token, o.status, o.total_kobo, o.created_at, o.promised_at, o.speed, ${nameSql('o')} as product_name, o.custom_request_id,
            (select count(*)::int from order_items x where x.order_id = o.id) as line_count,
            i.quantity, i.config, i.size_key, i.width_ft, i.height_ft
     from orders o join order_items i on i.order_id = o.id and i.id = (select id from order_items x where x.order_id = o.id order by position, id limit 1)
     where o.customer_id = $1 and o.status <> 'draft' order by o.created_at desc limit 50`,
    [customerId],
  );
}

/** "Same again": copy a past order's lines, choices and approved files into a fresh draft at today's prices. */
export async function reorder(publicToken: string, customerId: string): Promise<{ id: string } | { error: string }> {
  const o = await getOrderByToken(publicToken);
  if (!o || o.customer_id !== customerId) return { error: 'We could not find that order.' };
  if (o.custom_request_id) return { error: 'A custom order cannot be repeated in one tap. Send a new custom request and we will quote it again.' };
  const items = await getItems(o.id);
  if (items.length === 0) return { error: 'We could not find that order.' };
  let draftId: string | null = null;
  const skipped: string[] = [];
  for (const item of items) {
    const product = await getProductById(item.product_id);
    if (!product) { skipped.push('a product that is not sold any more'); continue; }
    if (product.sample) { skipped.push('the sample pack (one box is enough; its price comes back as credit)'); continue; }
    const input = { slug: product.slug, quantity: item.quantity, config: item.config, sizeKey: item.size_key ?? undefined, widthFt: item.width_ft ?? undefined, heightFt: item.height_ft ?? undefined };
    let newItemId: string | null = null;
    if (!draftId) {
      const d = await createDraft({ ...input, area: o.area, pickup: o.pickup }, 'reorder');
      if ('error' in d) { skipped.push(`${product.name}: ${d.error}`); continue; }
      draftId = d.id;
      newItemId = (await getItem(d.id))!.id;
    } else {
      const a = await addLine(draftId, input);
      if ('error' in a) { skipped.push(`${product.name}: ${a.error}`); continue; }
      newItemId = a.itemId;
    }
    const art = item.artwork_file_id && (await one('select * from files where id = $1', [item.artwork_file_id]));
    if (art && newItemId) {
      const f = await one<{ id: string }>(
        `insert into files (order_id, order_item_id, kind, storage_key, original_name, mime, bytes, width_px, height_px, check_result)
         values ($1,$2,'artwork',$3,$4,$5,$6,$7,$8,$9) returning id`,
        [draftId, newItemId, art.storage_key, art.original_name, art.mime, art.bytes, art.width_px, art.height_px, JSON.stringify(art.check_result ?? {})],
      );
      await query("update order_items set artwork_path='upload', artwork_file_id=$2, preview_approved_at = $3 where id=$1", [newItemId, f!.id, item.preview_approved_at ?? new Date().toISOString()]);
    } else if (item.artwork_path === 'design' && item.design_brief && newItemId) {
      await query("update order_items set artwork_path='design', design_brief=$2 where id=$1", [newItemId, JSON.stringify(item.design_brief)]);
    }
    // A list of names comes along: the same people usually need the same cards again.
    if (item.names && newItemId) await query('update order_items set names = $2 where id = $1', [newItemId, JSON.stringify(item.names)]);
  }
  if (!draftId) return { error: skipped[0] ? `We could not repeat this order. ${skipped[0]}` : 'We could not find that order.' };
  await query('update orders set customer_id=$2, business_id=$3, address=$4 where id=$1', [draftId, o.customer_id, o.business_id, o.address ? JSON.stringify(o.address) : null]);
  await recomputeOrder(draftId);
  return { id: draftId };
}
