import { one, query, tx } from './db';
import { deleteFile } from './storage';
import { eraseBrandKit, dropUnusedFiles } from './brandKit';
import { eraseReviewPhotosFor } from './reviewPhotos';
import { exportStudio, eraseStudio } from './studio/privacy';
import { handOverOnDelete } from './businessAccounts';

/** Everything we hold about a customer, in a form they can keep. */
export async function exportData(customerId: string) {
  const c = await one<any>('select id, name, email, email_verified, phone, whatsapp_phone, account_type, default_area, marketing_opt_in, nudge_ok, reminders_ok, lang, created_at, last_sign_in_at, business_id from customers where id = $1', [customerId]);
  if (!c) return null;
  const business = c.business_id ? await one<any>('select name, tax_id from businesses where id = $1', [c.business_id]) : null;
  const orders = await query<any>(
    `select o.code, o.status, o.total_kobo, o.delivery_fee_kobo, o.created_at, o.paid_at, o.delivered_at, o.address, o.pickup, o.delivery_window,
            (select json_agg(json_build_object('product', coalesce(i.label, p.name), 'quantity', i.quantity, 'price_kobo', i.line_total_kobo))
               from order_items i join products p on p.id = i.product_id where i.order_id = o.id) as items
       from orders o where o.customer_id = $1 order by o.created_at`, [customerId]);
  const reviews = await query<any>(
    `select r.rating, r.body, r.public_ok, r.photo_status, r.photo_public_ok, (r.photo_key is not null) as has_photo, r.created_at
       from reviews r join orders o on o.id = r.order_id where o.customer_id = $1`, [customerId]);
  const claims = await query<any>('select cl.kind, cl.description, cl.status, cl.resolution, cl.created_at from claims cl join orders o on o.id = cl.order_id where o.customer_id = $1', [customerId]);
  const signIns = await query<any>('select method, at from sign_ins where customer_id = $1 order by at', [customerId]);
  const mine = [c.phone, c.whatsapp_phone].filter(Boolean);
  const customRequests = await query<any>(
    `select code, kind, event_plan, title, details, quantity_text, size_text, budget_kobo, need_by, status, quote_price_kobo, quote_days, quote_note, decline_reason, created_at
     from custom_requests where customer_id = $1 or phone = any($2::text[]) or ($3::text is not null and lower(email) = lower($3::text)) order by created_at`,
    [customerId, mine, c.email ?? null],
  );
  const couponUses = await query<any>(
    'select cp.code, r.discount_kobo, r.created_at from coupon_redemptions r join coupons cp on cp.id = r.coupon_id where r.customer_id = $1 order by r.created_at',
    [customerId],
  );
  const brandKit = await one<any>('select display_name, tagline, primary_hex, secondary_hex, accent_hex, fonts, tone, phone_line, address_line, website, notes, updated_at from brand_kits where customer_id = $1', [customerId]);
  const brandFiles = await query<any>('select kind, title, mime, bytes, created_at from brand_assets where customer_id = $1 order by created_at', [customerId]);
  const myCodes = await query<any>("select code, source, percent_off, amount_off_kobo, active, created_at from coupons where owner_customer_id = $1 order by created_at", [customerId]);
  const referrals = await query<any>(
    `select r.amount_kobo, r.created_at, cp.code as reward_code from referral_rewards r left join coupons cp on cp.id = r.reward_coupon_id where r.referrer_id = $1 order by r.created_at`, [customerId]);
  const studio = await exportStudio(customerId).catch(() => null);
  const reminders = await query<any>("select kind, weekday, next_at, active, last_sent_at, sent_count, created_at from reminders where customer_id = $1 order by created_at", [customerId]);
  const nameLists = await query<any>(
    `select o.code, i.names from order_items i join orders o on o.id = i.order_id where o.customer_id = $1 and i.names is not null order by o.created_at`, [customerId]);
  const { business_id: _b, ...profile } = c;
  return {
    exported_at: new Date().toISOString(), note: 'Everything Brandit holds about you. Amounts are in kobo (100 kobo = 1 naira).',
    profile, business, orders, custom_requests: customRequests, coupons_used: couponUses, reviews, problem_reports: claims, sign_ins: signIns,
    brand_kit: brandKit, brand_files: brandFiles, my_codes: myCodes, referral_rewards: referrals, reminders, name_lists: nameLists, studio,
  };
}

export type DeleteResult = { ok: true } | { ok: false; reason: 'IN_PROGRESS'; count: number } | { ok: false; reason: 'NOT_FOUND' };

/**
 * Erase a person. Their name, contact details, sign-in links and delivery addresses go, and so do the files they uploaded
 * for finished orders. The order and invoice records stay, because the law requires accounts to be kept,
 * but they no longer point to a person. Not allowed while an order is still being made, so nobody pays and loses the print.
 */
export async function deleteAccount(customerId: string): Promise<DeleteResult> {
  const c = await one<any>('select id, email, phone, whatsapp_phone from customers where id = $1', [customerId]);
  if (!c) return { ok: false, reason: 'NOT_FOUND' };
  const busy = await one<{ n: number }>("select count(*)::int as n from orders where customer_id = $1 and status in ('paid','in_production')", [customerId]);
  if (busy && busy.n > 0) return { ok: false, reason: 'IN_PROGRESS', count: busy.n };

  const mine = [c.phone, c.whatsapp_phone].filter(Boolean);
  const files = await query<{ id: string; storage_key: string }>(
    `select f.id, f.storage_key from files f
       left join orders o on o.id = f.order_id
       left join custom_requests r on r.id = f.custom_request_id
     where f.storage_key <> 'deleted.bin'
       and (o.customer_id = $1 or r.customer_id = $1 or r.phone = any($2::text[]) or ($3::text is not null and lower(r.email) = lower($3::text)))`,
    [customerId, mine, c.email ?? null]);

  await tx(async (q) => {
    await q.query("update orders set status = 'cancelled' where customer_id = $1 and status in ('draft','awaiting_payment')", [customerId]);
    await q.query("update orders set address = case when address is null then null else jsonb_build_object('area', address->>'area') end where customer_id = $1", [customerId]);
    await q.query("update messages set to_phone = null where order_id in (select id from orders where customer_id = $1)", [customerId]);
    await q.query("update reviews set body = null, public_ok = false, featured = false where order_id in (select id from orders where customer_id = $1)", [customerId]);
    await q.query("update deliveries set last_lat = null, last_lng = null, last_accuracy_m = null, last_ping_at = null where order_id in (select id from orders where customer_id = $1)", [customerId]);
    // A company the person owns passes to the member who has been there longest.
    await handOverOnDelete(q, customerId);
    await q.query("update coupons set owner_customer_id = null, active = false where owner_customer_id = $1", [customerId]);
    await q.query("update claims set description = null where order_id in (select id from orders where customer_id = $1)", [customerId]);
    // What a customer typed into a design brief (names, numbers on a card) goes with them.
    await q.query("update order_items set design_brief = null where order_id in (select id from orders where customer_id = $1)", [customerId]);
    // Lists of names printed on cards and shirts, the note to whoever paid, who paid, and the repeat reminders.
    await q.query("update order_items set names = null where order_id in (select id from orders where customer_id = $1)", [customerId]);
    await q.query("update orders set pay_note = null where customer_id = $1", [customerId]);
    await q.query("update payments set payer_name = null, payer_email = null where order_id in (select id from orders where customer_id = $1)", [customerId]);
    await q.query("delete from reminders where customer_id = $1", [customerId]);
    // Custom requests: the person and everything they wrote go. Our prices stay for the accounts. Open ones are closed.
    await q.query(
      `update custom_requests set name = 'Deleted customer', phone = 'deleted', email = null, title = 'Deleted request', details = 'Deleted at the customer''s request.',
         quantity_text = null, size_text = null, budget_kobo = null, need_by = null, quote_note = null, decline_reason = null, customer_id = null, event_plan = null,
         status = case when status in ('new','quoted') then 'cancelled' else status end, updated_at = now()
       where customer_id = $1 or phone = any($2::text[]) or ($3::text is not null and lower(email) = lower($3::text))`,
      [customerId, mine, c.email ?? null]);
    await q.query("update order_items set label = 'Custom order' where label like 'Custom: %' and order_id in (select id from orders where customer_id = $1)", [customerId]);
    await q.query("update coupon_redemptions set customer_id = null, phone = null, email = null where customer_id = $1", [customerId]);
    await q.query("update files set storage_key = 'deleted.bin', original_name = null where id = any($1::uuid[])", [files.map((f) => f.id)]);
    const ids = [c.email, c.phone, c.whatsapp_phone].filter(Boolean);
    if (ids.length) await q.query('delete from login_codes where identifier = any($1::text[])', [ids]);
    await q.query('delete from sign_ins where customer_id = $1', [customerId]);
    await q.query(
      `update customers set name = 'Deleted customer', email = null, email_verified = false, phone = null, whatsapp_phone = null, google_sub = null,
         avatar_url = null, default_area = null, marketing_opt_in = false, business_id = null, business_role = null, profile_completed_at = null where id = $1`, [customerId]);
  });
  // The stored files go last, after the records no longer point at them. A failure here leaves nothing identifiable behind.
  await eraseStudio(customerId).catch((e) => console.error('[brandit] studio erase failed:', e?.message ?? e));
  const reviewKeys = await eraseReviewPhotosFor(customerId).catch(() => [] as string[]);
  const kitKeys = await eraseBrandKit(customerId).catch(() => [] as string[]);
  await Promise.allSettled([...files.map((f) => f.storage_key), ...reviewKeys].map((k) => deleteFile(k)));
  await dropUnusedFiles(kitKeys).catch(() => {});
  return { ok: true };
}
