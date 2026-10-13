import { query, one, tx } from './db';
import { getSettings } from './settings';
import { normalizePhone } from './phone';
import { token } from './password';
import { appUrl, flushMessages, queueMessage } from './messages';
import { putFile, deleteFile } from './storage';
import { sniffMime } from './inspect';
import { customProductId } from './productAdmin';
import { recomputeOrder } from './orders';
import { naira } from './money';
import { lagosParts } from './time';

/*
 * Custom orders. A customer describes a job that does not fit the price list. A person at Brandit sends a
 * price and a time. The customer accepts and pays. From payment on, it is an ordinary order that goes through
 * the same file check, proof, print and delivery.
 *
 * Statuses: new -> quoted -> accepted. Or declined (by us) or cancelled (by the customer). "Expired" is not
 * stored: a quoted request whose time ran out simply reads as expired.
 */
type Row = Record<string, any>;

export type CustomStatus = 'new' | 'quoted' | 'expired' | 'accepted' | 'declined' | 'cancelled';
export const MAX_REF_FILES = 5;
export const MAX_REF_MB = 15;
const OPEN_LIMIT = 5;

export const effectiveStatus = (r: Row, now = new Date()): CustomStatus =>
  r.status === 'quoted' && r.quote_valid_until && new Date(r.quote_valid_until) <= now ? 'expired' : (r.status as CustomStatus);

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim().slice(0, max) : '');
const block = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '');

export type CustomInput = {
  productSlug?: string | null;
  name: string;
  phone: string;
  email?: string;
  title: string;
  details: string;
  quantityText?: string;
  sizeText?: string;
  budget?: string;
  needBy?: string;
};
export type RefFile = { name: string; buf: Buffer };
export type CreateResult = { ok: true; id: string; code: string; token: string } | { ok: false; error: string; field?: string };

/** Naira typed by a person ("150,000", "₦150000") into whole kobo, or null when it is not a usable amount. */
export function parseNaira(v: unknown): number | null {
  const s = String(v ?? '').replace(/[₦,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const k = Math.round(Number(s) * 100);
  return Number.isSafeInteger(k) ? k : null;
}
export const MAX_QUOTE_KOBO = 2_000_000_000; // ₦20 million, comfortably inside the database's integer range

export type PlanAttach = { kind: 'event'; plan: unknown };

export async function createCustomRequest(i: CustomInput, files: RefFile[], customerId?: string | null, attach?: PlanAttach): Promise<CreateResult> {
  const name = clean(i.name, 80);
  if (name.length < 2) return { ok: false, error: 'Tell us your name so we know who to talk to.', field: 'name' };
  const phone = normalizePhone(i.phone);
  if (!phone) return { ok: false, error: 'Enter a Nigerian mobile number, like 0803 123 4567. We send your price there.', field: 'phone' };
  const email = clean(i.email, 120).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'That email address does not look right. Fix it or leave it empty.', field: 'email' };
  const title = clean(i.title, 80);
  if (title.length < 3) return { ok: false, error: 'In a few words, what do you need? For example "Branded tote bags".', field: 'title' };
  const details = block(i.details, 2000);
  if (details.length < 10) return { ok: false, error: 'Tell us a little more: how many, what size, what it is for. A sentence or two is enough.', field: 'details' };

  let budget: number | null = null;
  if (clean(i.budget, 20)) {
    budget = parseNaira(i.budget);
    if (budget == null || budget > MAX_QUOTE_KOBO) return { ok: false, error: 'Write your budget as a number of naira, like 150000. You can leave it empty.', field: 'budget' };
  }
  let needBy: string | null = null;
  if (clean(i.needBy, 12)) {
    const d = clean(i.needBy, 12);
    const today = lagosParts(new Date()).ymd;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) return { ok: false, error: 'Pick the date you need it by from the calendar, or leave it empty.', field: 'need_by' };
    if (d < today) return { ok: false, error: 'That date has passed. Pick today or a later day.', field: 'need_by' };
    if (d > `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`) return { ok: false, error: 'Pick a date within the next year.', field: 'need_by' };
    needBy = d;
  }

  const open = await one<{ n: number }>("select count(*)::int as n from custom_requests where phone = $1 and status in ('new','quoted')", [phone]);
  if ((open?.n ?? 0) >= OPEN_LIMIT) return { ok: false, error: `You already have ${OPEN_LIMIT} requests waiting. Open one of them, or message us on WhatsApp and we will help.` };

  const s = await getSettings();
  const cap = Math.min(s.max_upload_mb, MAX_REF_MB) * 1_000_000;
  if (files.length > MAX_REF_FILES) return { ok: false, error: `You can attach up to ${MAX_REF_FILES} files.`, field: 'files' };
  const prepared: { name: string; mime: string; buf: Buffer; ext: string }[] = [];
  for (const f of files) {
    if (f.buf.length > cap) return { ok: false, error: `"${f.name}" is larger than ${cap / 1_000_000} MB. Send a smaller copy.`, field: 'files' };
    const mime = sniffMime(f.buf) ?? (f.buf.length > 12 && f.buf.subarray(0, 4).toString('ascii') === 'RIFF' && f.buf.subarray(8, 12).toString('ascii') === 'WEBP' ? 'image/webp' : null);
    if (!mime) return { ok: false, error: `"${f.name}" is not a photo or PDF. Attach JPG, PNG, WebP or PDF files.`, field: 'files' };
    prepared.push({ name: f.name, mime, buf: f.buf, ext: mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'pdf' });
  }

  let productId: string | null = null;
  const slug = clean(i.productSlug, 60);
  if (slug) productId = (await one<{ id: string }>('select id from products where slug = $1 and active and not system', [slug]))?.id ?? null;

  const keys: string[] = [];
  try {
    for (const f of prepared) keys.push(await putFile(f.buf, f.ext));
    const made = await tx(async (q) => {
      const n = (await q.query<{ n: number }>("select nextval('custom_seq')::int as n"))[0].n;
      const code = `CQ-${n}`;
      const tok = token(16);
      const r = await q.query<{ id: string }>(
        `insert into custom_requests (code, public_token, product_id, customer_id, name, phone, email, title, details, quantity_text, size_text, budget_kobo, need_by, kind, event_plan)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
        [code, tok, productId, customerId ?? null, name, phone, email || null, title, details, clean(i.quantityText, 80) || null, clean(i.sizeText, 80) || null, budget, needBy, attach?.kind ?? 'custom', attach ? JSON.stringify(attach.plan) : null],
      );
      for (let k = 0; k < prepared.length; k++) {
        await q.query(
          `insert into files (custom_request_id, kind, storage_key, original_name, mime, bytes) values ($1,'custom_ref',$2,$3,$4,$5)`,
          [r[0].id, keys[k], prepared[k].name.slice(0, 200), prepared[k].mime, prepared[k].buf.length],
        );
      }
      await q.query("insert into events (name, props) values ('custom_requested', $1)", [JSON.stringify({ code, files: prepared.length, product: slug || null, kind: attach?.kind ?? 'custom' })]);
      const link = `${appUrl()}/custom-order/${tok}`;
      await queueMessage(q, { toPhone: phone, template: 'custom_received', vars: { code, hours: String(s.custom_reply_hours), link } });
      if (process.env.ALERT_PHONE) await queueMessage(q, { toPhone: process.env.ALERT_PHONE, template: 'custom_alert', vars: { code, title, who: name } });
      return { id: r[0].id, code, token: tok };
    });
    await flushMessages().catch((e) => console.error('[brandit] custom request messages failed:', e?.message ?? e));
    return { ok: true, ...made };
  } catch (e) {
    for (const k of keys) await deleteFile(k).catch(() => {});
    throw e;
  }
}

export const getByToken = (tok: string) => one<Row>('select r.*, p.name as product_name, p.slug as product_slug from custom_requests r left join products p on p.id = r.product_id where r.public_token = $1', [tok]);
export const getById = (id: string) => one<Row>('select r.*, p.name as product_name, p.slug as product_slug, s.name as quoted_by_name, o.code as order_code from custom_requests r left join products p on p.id = r.product_id left join staff s on s.id = r.quoted_by left join orders o on o.id = r.order_id where r.id = $1', [id]);
export const requestFiles = (id: string) => query<Row>("select id, original_name, mime, bytes from files where custom_request_id = $1 and storage_key <> 'deleted.bin' order by created_at", [id]);

// ---------- Staff: send a price, or say no ----------
export type QuoteInput = { price: string; days: string; validDays?: string; note?: string };
export type ActionResult = { ok: true } | { ok: false; error: string };

export async function quoteRequest(id: string, staffId: string, q: QuoteInput, now = new Date()): Promise<ActionResult> {
  const r = await one<Row>('select * from custom_requests where id = $1', [id]);
  if (!r) return { ok: false, error: 'We could not find that request.' };
  if (!['new', 'quoted'].includes(r.status)) return { ok: false, error: r.status === 'accepted' ? 'The customer already accepted a price, so it cannot change.' : 'This request is closed.' };
  const price = parseNaira(q.price);
  if (price == null || price <= 0) return { ok: false, error: 'Enter the price in naira, like 85000.' };
  if (price > MAX_QUOTE_KOBO) return { ok: false, error: 'That price is too large. The most a quote can be is ₦20,000,000.' };
  const days = Math.trunc(Number(q.days));
  if (!(days >= 1 && days <= 60)) return { ok: false, error: 'Enter how many working days it takes, from 1 to 60.' };
  const s = await getSettings();
  const validDays = q.validDays?.trim() ? Math.trunc(Number(q.validDays)) : s.custom_quote_valid_days;
  if (!(validDays >= 1 && validDays <= 60)) return { ok: false, error: 'A price can stay valid for 1 to 60 days.' };
  const note = block(q.note, 600);
  const until = new Date(now.getTime() + validDays * 86_400_000);
  const link = `${appUrl()}/custom-order/${r.public_token}`;
  const stored = await tx(async (t) => {
    const done = await t.query(
      `update custom_requests set status = 'quoted', quote_price_kobo = $2, quote_days = $3, quote_note = $4, quote_valid_until = $5, quoted_by = $6, quoted_at = $7, updated_at = $7
       where id = $1 and status in ('new','quoted') returning id`,
      [id, price, days, note || null, until.toISOString(), staffId, now.toISOString()],
    );
    if (!done.length) return false;
    await queueMessage(t, { toPhone: r.phone, template: 'custom_quote_ready', vars: { code: r.code, price: naira(price), days: String(days), link } });
    await t.query("insert into events (name, props) values ('custom_quoted', $1)", [JSON.stringify({ code: r.code, price_kobo: price, days })]);
    return true;
  });
  if (!stored) return { ok: false, error: 'Someone just changed this request. Reload the page and look again.' };
  await flushMessages().catch(() => {});
  return { ok: true };
}

export async function declineRequest(id: string, reason: string, now = new Date()): Promise<ActionResult> {
  const r = await one<Row>('select * from custom_requests where id = $1', [id]);
  if (!r) return { ok: false, error: 'We could not find that request.' };
  if (!['new', 'quoted'].includes(r.status)) return { ok: false, error: 'This request is already closed.' };
  const why = clean(reason, 300);
  if (why.length < 5) return { ok: false, error: 'Write a short, kind reason. The customer will read it.' };
  await tx(async (t) => {
    await t.query("update custom_requests set status = 'declined', decline_reason = $2, updated_at = $3 where id = $1", [id, why, now.toISOString()]);
    await queueMessage(t, { toPhone: r.phone, template: 'custom_declined', vars: { code: r.code, reason: why.endsWith('.') ? why : `${why}.`, link: `${appUrl()}/custom-order/${r.public_token}` } });
  });
  await flushMessages().catch(() => {});
  return { ok: true };
}

// ---------- Customer: say no, or say yes ----------
export async function cancelByCustomer(tok: string, now = new Date()): Promise<ActionResult> {
  const done = await query("update custom_requests set status = 'cancelled', updated_at = $2 where public_token = $1 and status in ('new','quoted') returning id", [tok, now.toISOString()]);
  return done.length ? { ok: true } : { ok: false, error: 'This request can no longer be cancelled.' };
}

export type AcceptResult = { ok: true; orderId: string; paid: boolean } | { ok: false; error: string };

/**
 * The customer accepts the price. We open an order for exactly that price and send them to pay.
 * Safe to call twice: the second call finds the order the first one made.
 */
export async function acceptQuote(tok: string, now = new Date()): Promise<AcceptResult> {
  const first = await getByToken(tok);
  if (!first) return { ok: false, error: 'We could not find that request.' };

  // Looked up before the transaction opens: nothing inside a transaction may use the shared connection.
  const fallbackProduct = first.product_id ?? (await customProductId());
  const made = await tx(async (q) => {
    const r = (await q.query<Row>('select * from custom_requests where id = $1 for update', [first.id]))[0];
    if (r.order_id) return { orderId: r.order_id as string, fresh: false };
    if (r.status !== 'quoted' || !r.quote_price_kobo) return { error: r.status === 'new' ? 'We have not sent a price yet. We will message you when it is ready.' : 'This request is closed.' };
    if (!r.quote_valid_until || new Date(r.quote_valid_until) <= now) return { error: 'This price has expired. Message us and we will refresh it.' };
    const pid = r.product_id ?? fallbackProduct;
    const n = (await q.query<{ n: number }>("select nextval('order_seq')::int as n"))[0].n;
    const o = await q.query<{ id: string }>(
      `insert into orders (code, public_token, status, customer_id, area, need_by, custom_request_id, subtotal_kobo, total_kobo, hold_expires_at)
       values ($1,$2,'draft',$3,$4,$5,$6,$7,$7,$8) returning id`,
      [`BR-${n}`, token(14), r.customer_id, r.area, r.need_by, r.id, r.quote_price_kobo, new Date(now.getTime() + 15 * 60_000).toISOString()],
    );
    const brief = { custom: true, request: r.code, title: r.title, details: r.details, quantity_text: r.quantity_text, size_text: r.size_text, quote_note: r.quote_note, purpose: r.title, wording: r.details, ...(r.kind === 'event' && r.event_plan ? { event_plan: r.event_plan } : {}) };
    const item = await q.query<{ id: string }>(
      `insert into order_items (order_id, product_id, config, quantity, line_total_kobo, artwork_path, design_brief, label)
       values ($1,$2,'{}',1,$3,'design',$4,$5) returning id`,
      [o[0].id, pid, r.quote_price_kobo, JSON.stringify(brief), `${r.kind === 'event' ? 'Event' : 'Custom'}: ${r.title}`.slice(0, 100)],
    );
    await q.query('update files set order_id = $2, order_item_id = $3 where custom_request_id = $1', [r.id, o[0].id, item[0].id]);
    await q.query("update custom_requests set status = 'accepted', order_id = $2, updated_at = $3 where id = $1", [r.id, o[0].id, now.toISOString()]);
    await q.query("insert into events (name, props) values ('custom_accepted', $1)", [JSON.stringify({ code: r.code, price_kobo: r.quote_price_kobo })]);
    return { orderId: o[0].id as string, fresh: true };
  });
  if ('error' in made) return { ok: false, error: made.error as string };
  const order = await one<Row>('select status from orders where id = $1', [made.orderId]);
  if (!order) return { ok: false, error: 'We could not open your order. Message us and we will sort it out.' };
  if (['draft', 'awaiting_payment'].includes(order.status)) await recomputeOrder(made.orderId, now);
  return { ok: true, orderId: made.orderId, paid: !['draft', 'awaiting_payment'].includes(order.status) };
}

// ---------- Lists for the console ----------
export type ListFilter = 'todo' | 'waiting' | 'won' | 'closed';
export async function listRequests(filter: ListFilter, now = new Date()): Promise<Row[]> {
  const where = {
    todo: "r.status = 'new'",
    waiting: "r.status = 'quoted'",
    won: "r.status = 'accepted'",
    closed: "r.status in ('declined','cancelled')",
  }[filter];
  return query<Row>(
    `select r.*, p.name as product_name, o.status as order_status, o.code as order_code
     from custom_requests r left join products p on p.id = r.product_id left join orders o on o.id = r.order_id
     where ${where} order by ${filter === 'todo' ? 'r.created_at asc' : 'r.updated_at desc'} limit 100`,
  ).then((rows) => rows.map((r) => ({ ...r, effective: effectiveStatus(r, now) })));
}

/** A customer's own requests that have not become an order yet (those show up as orders). Open ones, and recent closed ones. */
export async function requestsForCustomer(customerId: string, now = new Date()): Promise<Row[]> {
  const rows = await query<Row>(
    `select id, code, public_token, title, status, quote_price_kobo, quote_valid_until, created_at
       from custom_requests
      where customer_id = $1 and order_id is null and (status in ('new','quoted') or created_at > $2)
      order by created_at desc limit 20`,
    [customerId, new Date(now.getTime() - 14 * 86_400_000).toISOString()],
  );
  return rows.map((r) => ({ ...r, effective: effectiveStatus(r, now) }));
}

export async function requestCounts(): Promise<{ todo: number; waiting: number; won: number; closed: number }> {
  const r = await one<any>(
    `select count(*) filter (where status = 'new')::int as todo, count(*) filter (where status = 'quoted')::int as waiting,
            count(*) filter (where status = 'accepted')::int as won, count(*) filter (where status in ('declined','cancelled'))::int as closed
     from custom_requests`,
  );
  return r ?? { todo: 0, waiting: 0, won: 0, closed: 0 };
}

// ---------- Housekeeping (called by the sweep) ----------
/**
 * Requests nobody is coming back for are closed, and their reference files that never reached an order are deleted:
 * an unanswered request after 90 days, a price that expired 30 days ago, and any declined or cancelled request after 30 days.
 */
export async function cleanupStale(now = new Date()): Promise<{ closed: number; files: number }> {
  const day = 86_400_000;
  const closed = await query(
    `update custom_requests set status = 'cancelled', updated_at = $1
     where (status = 'new' and created_at < $2) or (status = 'quoted' and quote_valid_until < $3) returning id`,
    [now.toISOString(), new Date(now.getTime() - 90 * day).toISOString(), new Date(now.getTime() - 30 * day).toISOString()],
  );
  const old = await query<{ id: string; storage_key: string }>(
    `select f.id, f.storage_key from files f join custom_requests r on r.id = f.custom_request_id
     where f.order_id is null and f.storage_key <> 'deleted.bin' and r.status in ('declined','cancelled') and r.updated_at < $1`,
    [new Date(now.getTime() - 30 * day).toISOString()],
  );
  for (const f of old) {
    await deleteFile(f.storage_key).catch(() => {});
    await query("update files set storage_key = 'deleted.bin' where id = $1", [f.id]);
  }
  return { closed: closed.length, files: old.length };
}
