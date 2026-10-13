import { sendReceiptEmail } from './receipts';
import { query, one, tx, type Q } from './db';
import { getProductById, getRules, zoneForArea } from './catalog';
import { getSettings } from './settings';
import { makeQuote, slotsUsedOn, sizeRankOf } from './quote';
import { priceItem, priceOrder } from './pricing';
import { promise as makePromise, type PromiseResult } from './promise';
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
export async function getItem(orderId: string): Promise<Row | null> {
  return one('select * from order_items where order_id = $1 order by id limit 1', [orderId]);
}

// ---------- Draft ----------
export async function createDraft(input: Parameters<typeof makeQuote>[0]): Promise<{ id: string } | { error: string }> {
  const now = new Date();
  const quote = await makeQuote(input, now);
  if (!quote.ok) return { error: quote.message };
  const s = await getSettings();
  const totals = priceOrder({ itemsKobo: [quote.priceKobo], deliveryFeeKobo: quote.zone?.fee_kobo ?? 0, pickup: !!input.pickup, vatRate: s.vat_rate, pricesIncludeVat: s.prices_include_vat });
  const id = await tx(async (q) => {
    const n = (await q.query<{ n: number }>("select nextval('order_seq')::int as n"))[0].n;
    const o = await q.query<{ id: string }>(
      `insert into orders (code, public_token, status, subtotal_kobo, delivery_fee_kobo, vat_kobo, total_kobo, zone_id, area, pickup, speed, production_day, promised_at, promise_reasons, hold_expires_at, need_by)
       values ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
      [`BR-${n}`, token(14), totals.subtotalKobo, totals.deliveryKobo, totals.vatKobo, totals.totalKobo, quote.zone?.id ?? null, input.area ?? null, !!input.pickup, quote.tier, quote.productionDay, quote.arriveBy, JSON.stringify(quote.reasons), new Date(now.getTime() + s.hold_minutes * 60000).toISOString(), input.needBy ?? null],
    );
    await q.query(
      `insert into order_items (order_id, product_id, config, size_key, quantity, width_ft, height_ft, line_total_kobo)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [o[0].id, quote.product.id, JSON.stringify(quote.config), quote.sizeKey, Math.trunc(Number(input.quantity)), input.widthFt ?? null, input.heightFt ?? null, quote.priceKobo],
    );
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

/**
 * Re-price and re-promise a draft or unpaid order. The server decides the price, always.
 * A coupon that stopped being valid (it expired, or the customer's details show they used it before) is taken off,
 * and the reason comes back so the customer is told before they pay a different amount.
 */
export async function recomputeOrder(orderId: string, now = new Date()): Promise<{ ok: true; couponMessage?: string } | { ok: false; error: string }> {
  const o = await getOrder(orderId);
  const item = o && (await getItem(orderId));
  if (!o || !item) return { ok: false, error: 'Order not found.' };
  const product = await getProductById(item.product_id);
  if (!product) return { ok: false, error: 'Product not found.' };
  const s = await getSettings();

  // Custom orders carry a price a person quoted. Everything else is priced from the rules.
  const custom = o.custom_request_id ? await one<Row>('select * from custom_requests where id = $1', [o.custom_request_id]) : null;
  let priceKobo: number;
  let zone: Awaited<ReturnType<typeof zoneForArea>>;
  let quote: Awaited<ReturnType<typeof makeQuote>> | null = null;
  if (custom) {
    if (!custom.quote_price_kobo) return { ok: false, error: 'This custom quote is not ready yet.' };
    priceKobo = custom.quote_price_kobo;
    zone = await zoneForArea(o.area);
  } else {
    quote = await makeQuote(
      { slug: product.slug, quantity: item.quantity, config: item.config, sizeKey: item.size_key ?? undefined, widthFt: item.width_ft ?? undefined, heightFt: item.height_ft ?? undefined, area: o.area, pickup: o.pickup, needBy: iso(o.need_by) },
      now,
    );
    if (!quote.ok) return { ok: false, error: quote.message };
    priceKobo = quote.priceKobo;
    zone = quote.zone;
  }
  const design = custom ? 0 : item.artwork_path === 'design' ? (item.design_brief?.fix ? s.fix_fee_kobo : s.design_fee_kobo) : 0;
  const deliveryFee = o.pickup ? 0 : (zone?.fee_kobo ?? 0);

  let discount = 0;
  let couponId: string | null = o.coupon_id ?? null;
  let couponCode: string | null = o.coupon_code ?? null;
  let couponMessage: string | undefined;
  if (couponId && couponCode) {
    const v = await validateCoupon(couponCode, { subtotalKobo: priceKobo, designKobo: design, deliveryKobo: deliveryFee, productId: product.id, orderId: o.id, identity: await identityOf(o), now, custom: !!custom });
    if (v.ok) discount = v.discountKobo;
    else { couponId = null; couponCode = null; couponMessage = v.message; }
  }

  const t = priceOrder({ itemsKobo: [priceKobo], deliveryFeeKobo: zone?.fee_kobo ?? 0, pickup: o.pickup, designFeeKobo: design, discountKobo: discount, vatRate: s.vat_rate, pricesIncludeVat: s.prices_include_vat });
  // Design jobs (and custom jobs) set their arrival time when the customer approves the proof.
  const designJob = item.artwork_path === 'design';
  const promise = quote && quote.ok ? quote : null;
  await tx(async (q) => {
    await q.query('update order_items set line_total_kobo = $2 where id = $1', [item.id, priceKobo]);
    await q.query(
      `update orders set subtotal_kobo=$2, delivery_fee_kobo=$3, design_fee_kobo=$4, vat_kobo=$5, total_kobo=$6, zone_id=$7,
         speed=$8, production_day=$9, promised_at=$10, promise_reasons=$11, hold_expires_at=$12, discount_kobo=$13, coupon_id=$14, coupon_code=$15 where id=$1`,
      [orderId, t.subtotalKobo, t.deliveryKobo, t.designKobo, t.vatKobo, t.totalKobo, zone?.id ?? null,
        designJob || !promise ? null : promise.tier, designJob || !promise ? null : promise.productionDay, designJob || !promise ? null : promise.arriveBy, JSON.stringify(promise?.reasons ?? []),
        new Date(now.getTime() + s.hold_minutes * 60000).toISOString(), t.discountKobo, couponId, couponCode],
    );
  });
  return couponMessage ? { ok: true, couponMessage } : { ok: true };
}

export async function setArtworkPath(orderId: string, path: 'upload' | 'design', brief?: Record<string, unknown>) {
  const item = await getItem(orderId);
  if (!item) return;
  await query('update order_items set artwork_path = $2, design_brief = $3, preview_approved_at = case when $2 = $4 then preview_approved_at else null end where id = $1', [item.id, path, brief ? JSON.stringify(brief) : null, 'upload']);
  await recomputeOrder(orderId);
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

export async function saveCheckout(orderId: string, d: CheckoutInput, signedInCustomerId?: string | null): Promise<{ ok: true; couponMessage?: string } | { ok: false; error: string; field?: string }> {
  const o = await getOrder(orderId);
  if (!o || !['draft', 'awaiting_payment'].includes(o.status)) return { ok: false, error: 'This order can no longer be changed.' };
  const phone = normalizePhone(d.phone);
  if (!phone) return { ok: false, error: 'Enter a Nigerian mobile number, like 0803 123 4567.', field: 'phone' };
  const name = d.name?.trim();
  if (!name || name.length < 2) return { ok: false, error: 'Tell us your name so the rider knows who to look for.', field: 'name' };
  const email = d.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'Enter an email address for your receipt.', field: 'email' };
  let zoneArea: string | null = null;
  if (!d.pickup) {
    const zone = await zoneForArea(d.area);
    if (!zone) return { ok: false, error: 'Choose your area so we can show the delivery fee and arrival time.', field: 'area' };
    if (!d.addressLine || d.addressLine.trim().length < 5) return { ok: false, error: 'Add the street address and a landmark.', field: 'address' };
    zoneArea = d.area!;
  }

  const windowsOn = (await getSettings()).windows_enabled;
  const customerId = await tx(async (q: Q) => {
    let c: { id: string; business_id: string | null }[];
    if (signedInCustomerId) {
      // A signed-in customer keeps one account: the number typed here becomes where we send updates.
      c = await q.query<{ id: string; business_id: string | null }>(
        `update customers set name = coalesce(nullif($2, ''), name),
           email = case when email_verified then email else $3 end,
           whatsapp_phone = case when phone = $4 then null else $4 end
         where id = $1 returning id, business_id`,
        [signedInCustomerId, name, email, phone],
      );
      if (!c[0]) throw new Error('Customer not found');
    } else {
      c = await q.query<{ id: string; business_id: string | null }>(
        `insert into customers (phone, name, email) values ($1,$2,$3)
         on conflict (phone) do update set name = excluded.name, email = case when customers.email_verified then customers.email else excluded.email end returning id, business_id`,
        [phone, name, email],
      );
    }
    let businessId = c[0].business_id;
    const company = d.company?.trim();
    if (company) {
      const b = await q.query<{ id: string }>('select id from businesses where id = $1 and lower(name) = lower($2)', [businessId, company]);
      businessId = b[0]?.id ?? (await q.query<{ id: string }>('insert into businesses (name) values ($1) returning id', [company]))[0].id;
      await q.query('update customers set business_id = $2 where id = $1', [c[0].id, businessId]);
      const tin = d.taxId?.trim().slice(0, 30);
      if (tin) await q.query('update businesses set tax_id = $2 where id = $1', [businessId, tin]);
    }
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
export async function promiseFor(orderId: string, now = new Date()) {
  const o = await getOrder(orderId);
  const item = o && (await getItem(orderId));
  if (!o || !item) return null;
  const product = await getProductById(item.product_id);
  if (!product) return null;
  const s = await getSettings();
  const zone = await zoneForArea(o.area);
  const day = productionDay(now, s);
  const used = await slotsUsedOn(day, o.id);
  const custom = o.custom_request_id ? await one<Row>('select quote_days from custom_requests where id = $1', [o.custom_request_id]) : null;
  let input;
  if (custom) {
    // A custom job is never 24-hour. It takes as many working days as the quote says, counted from approval.
    input = {
      rule: { eligible_24h: false, max_quantity: null, max_area_sqft: null, max_size_rank: null, excluded_choices: [], standard_days: custom.quote_days ?? 5 },
      settings: s, zoneEligible24h: zone ? zone.eligible_24h : true, pickup: o.pickup, quantity: item.quantity,
      totalAreaSqft: null, sizeRank: null, choices: [] as string[], slotsUsed: used, now,
    };
  } else {
    const { price, promise: rule } = await getRules(product.id);
    const priced = priceItem(product.pricing_mode, price, { quantity: item.quantity, config: item.config, sizeKey: item.size_key ?? undefined, widthFt: item.width_ft ?? undefined, heightFt: item.height_ft ?? undefined });
    input = {
      rule, settings: s, zoneEligible24h: zone ? zone.eligible_24h : true, pickup: o.pickup, quantity: item.quantity,
      totalAreaSqft: priced.areaSqft, sizeRank: sizeRankOf(product, item.size_key), choices: Object.entries(item.config as Record<string, string>).map(([k, v]) => `${k}:${v}`), slotsUsed: used, now,
    };
  }
  const fresh = makePromise(input);
  const standard = makePromise({ ...input, settings: { ...s, slots_paused: true } });
  return { order: o, item, product, settings: s, fresh, standard };
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
  const item = pair!.item;
  const design = item.artwork_path === 'design';
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
    const job = await q.query<{ id: string }>('insert into jobs (order_id, order_item_id, stage, press_id) values ($1,$2,$3,$4) returning id', [order.id, item.id, 'paid', hub?.id ?? null]);
    await q.query("insert into job_events (job_id, from_stage, to_stage, note) values ($1, null, 'paid', 'Payment confirmed')", [job[0].id]);
    await q.query("update jobs set stage = 'file_check', updated_at = now() where id = $1", [job[0].id]);
    await q.query("insert into job_events (job_id, from_stage, to_stage, note) values ($1, 'paid', 'file_check', 'Sent to the file desk')", [job[0].id]);
    await recordRedemption(q, { id: order.id, coupon_id: order.coupon_id ?? null, discount_kobo: order.discount_kobo ?? 0, customer_id: order.customer_id ?? null });
    await q.query("insert into events (name, props) values ('paid', $1)", [JSON.stringify({ order: order.code, total_kobo: order.total_kobo, coupon: order.coupon_code ?? null })]);

    const link = `${appUrl()}/track/${order.public_token}`;
    await queueMessage(q, { orderId: order.id, template: 'paid', vars: { code: order.code, arrive_line: arriveLine({ speed, promisedAt, pickup: order.pickup }, now), link } });
    if (changed) await queueMessage(q, { orderId: order.id, template: 'new_time', vars: { arrive_line: arriveLine({ speed, promisedAt, pickup: order.pickup }, now), link } });
    return { duplicate: false as const };
  });

  await flushMessages();
  if (!result.duplicate) await sendReceiptEmail(order.id).catch((e) => console.error('[brandit] receipt email failed:', e?.message ?? e));
  return { ok: true, orderId: order.id, duplicate: result.duplicate };
}

// ---------- Customer views ----------
export async function ordersForCustomer(customerId: string): Promise<Row[]> {
  return query(
    `select o.id, o.code, o.public_token, o.status, o.total_kobo, o.created_at, o.promised_at, o.speed, coalesce(i.label, p.name) as product_name, o.custom_request_id, i.quantity, i.config, i.size_key, i.width_ft, i.height_ft
     from orders o join order_items i on i.order_id = o.id join products p on p.id = i.product_id
     where o.customer_id = $1 and o.status <> 'draft' order by o.created_at desc limit 50`,
    [customerId],
  );
}

/** "Same again": copy a past order's choices and its approved file into a fresh draft at today's price. */
export async function reorder(publicToken: string, customerId: string): Promise<{ id: string } | { error: string }> {
  const o = await getOrderByToken(publicToken);
  if (!o || o.customer_id !== customerId) return { error: 'We could not find that order.' };
  if (o.custom_request_id) return { error: 'A custom order cannot be repeated in one tap. Send a new custom request and we will quote it again.' };
  const item = await getItem(o.id);
  const product = item && (await getProductById(item.product_id));
  if (!item || !product) return { error: 'We could not find that order.' };
  const d = await createDraft({ slug: product.slug, quantity: item.quantity, config: item.config, sizeKey: item.size_key ?? undefined, widthFt: item.width_ft ?? undefined, heightFt: item.height_ft ?? undefined, area: o.area, pickup: o.pickup });
  if ('error' in d) return d;
  const newItem = await getItem(d.id);
  const art = item.artwork_file_id && (await one('select * from files where id = $1', [item.artwork_file_id]));
  if (art && newItem) {
    const f = await one<{ id: string }>(
      `insert into files (order_id, order_item_id, kind, storage_key, original_name, mime, bytes, width_px, height_px, check_result)
       values ($1,$2,'artwork',$3,$4,$5,$6,$7,$8,$9) returning id`,
      [d.id, newItem.id, art.storage_key, art.original_name, art.mime, art.bytes, art.width_px, art.height_px, JSON.stringify(art.check_result ?? {})],
    );
    await query("update order_items set artwork_path='upload', artwork_file_id=$2, preview_approved_at = $3 where id=$1", [newItem.id, f!.id, item.preview_approved_at ?? new Date().toISOString()]);
  }
  await query('update orders set customer_id=$2, business_id=$3, address=$4 where id=$1', [d.id, o.customer_id, o.business_id, o.address ? JSON.stringify(o.address) : null]);
  return d;
}
