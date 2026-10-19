import { beforeAll, describe, expect, it } from 'vitest';
import { deflateSync, crc32 } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';

process.env.PGLITE_DIR = 'memory';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-growth-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.NEXT_PUBLIC_APP_URL = 'https://brandit.test';
delete process.env.PAYSTACK_SECRET_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.SMS_API_KEY;
delete process.env.WHATSAPP_ACCESS_TOKEN;

function makePng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc((w + 1) * h))), chunk('IEND', Buffer.alloc(0))]);
}

let db: typeof import('../lib/db');
let orders: typeof import('../lib/orders');
let payments: typeof import('../lib/payments');
let jobs: typeof import('../lib/jobs');
let art: typeof import('../lib/artwork');
let coupons: typeof import('../lib/coupons');
let settings: typeof import('../lib/settings');
let nudge: typeof import('../lib/nudge');
let referrals: typeof import('../lib/referrals');
let templates: typeof import('../lib/templates');
let eventPlan: typeof import('../lib/eventPlan');
let custom: typeof import('../lib/custom');
let rider: typeof import('../lib/rider');
let campaigns: typeof import('../lib/campaigns');
let kit: typeof import('../lib/brandKit');
let rp: typeof import('../lib/reviewPhotos');
let privacy: typeof import('../lib/privacy');
let storage: typeof import('../lib/storage');
let messages: typeof import('../lib/messages');

beforeAll(async () => {
  db = await import('../lib/db');
  orders = await import('../lib/orders');
  payments = await import('../lib/payments');
  jobs = await import('../lib/jobs');
  art = await import('../lib/artwork');
  coupons = await import('../lib/coupons');
  settings = await import('../lib/settings');
  nudge = await import('../lib/nudge');
  referrals = await import('../lib/referrals');
  templates = await import('../lib/templates');
  eventPlan = await import('../lib/eventPlan');
  custom = await import('../lib/custom');
  rider = await import('../lib/rider');
  campaigns = await import('../lib/campaigns');
  kit = await import('../lib/brandKit');
  rp = await import('../lib/reviewPhotos');
  privacy = await import('../lib/privacy');
  storage = await import('../lib/storage');
  messages = await import('../lib/messages');
  await db.ready();
});

let seq = 0;
const person = () => { const n = ++seq; return { name: `Tester${n} Person`, phone: `0803 ${String(500 + n).padStart(3, '0')} ${String(1000 + n)}`, email: `tester${n}@example.com` }; };
const customerOf = async (id: string) => (await db.one<any>('select c.* from orders o join customers c on c.id = o.customer_id where o.id = $1', [id]))!;

/** A draft with delivery details saved: this is where a customer who never pays is left. */
async function checkedOut(opts: { who?: ReturnType<typeof person>; area?: string; pickup?: boolean; window?: 'morning' | 'afternoon' | null; upload?: boolean; code?: string } = {}) {
  const who = opts.who ?? person();
  const area = opts.area ?? 'Yaba';
  const d: any = await orders.createDraft({ slug: 'business-cards', quantity: 100, area, pickup: opts.pickup });
  expect(d.error).toBeUndefined();
  if (opts.upload) {
    const up = await art.saveArtwork(d.id, { name: 'card.png', type: 'image/png', buf: makePng(1050, 600) });
    expect(up.ok && up.attached).toBe(true);
  } else await orders.setArtworkPath(d.id, 'design', { purpose: 'growth test' });
  if (opts.code) {
    const o = (await orders.getOrder(d.id))!;
    const item = (await orders.getItem(d.id))!;
    const v = await coupons.validateCoupon(opts.code, { subtotalKobo: item.line_total_kobo, designKobo: o.design_fee_kobo, deliveryKobo: o.delivery_fee_kobo, productId: item.product_id, orderId: d.id, identity: { phone: (await import('../lib/phone')).normalizePhone(who.phone), email: who.email } });
    expect(v.ok, JSON.stringify(v)).toBe(true);
    if (v.ok) await db.query('update orders set coupon_id = $2, coupon_code = $3 where id = $1', [d.id, v.coupon.id, v.coupon.code]);
  }
  const c = await orders.saveCheckout(d.id, { ...who, pickup: !!opts.pickup, area, addressLine: '12 Test Street, Yaba', window: opts.window ?? null });
  expect(c.ok, JSON.stringify(c)).toBe(true);
  return { id: d.id as string, who };
}
async function pay(id: string) {
  const o = (await orders.getOrder(id))!;
  const c = await customerOf(id);
  const p = await payments.initPayment(o, c.email ?? 'buyer@example.com');
  const r = await orders.confirmPayment({ reference: p.reference, amountKobo: o.total_kobo, method: 'card' });
  expect(r.ok).toBe(true);
}
const actor = async (email: string) => (await db.one<any>('select id, name, role, press_id from staff where email = $1', [email]))!;
const messagesFor = (id: string, template?: string) =>
  db.query<any>(`select * from messages where order_id = $1 ${template ? 'and template = $2' : ''} order by id`, template ? [id, template] : [id]);

// Lagos is UTC+1 all year. 11:30 UTC is 12:30 in Lagos.
const T0 = new Date('2026-10-12T08:00:00Z');
const at = (mins: number) => new Date(T0.getTime() + mins * 60_000);

describe('unpaid-order reminder', () => {
  it('sends one message with a link back to payment, and only once', async () => {
    const { id } = await checkedOut();
    await db.query("update orders set checkout_saved_at = $2 where id = $1", [id, T0.toISOString()]);
    expect(await nudge.sendNudges(at(60))).toBe(0); // too soon
    expect(await nudge.sendNudges(at(150))).toBeGreaterThanOrEqual(1);
    const m = await messagesFor(id, 'abandoned_nudge');
    expect(m).toHaveLength(1);
    expect(m[0].body).toContain('https://brandit.test/continue/');
    expect(m[0].body).toContain('src=nudge');
    expect(m[0].lang).toBe('en');
    expect((await orders.getOrder(id))!.nudged_at).toBeTruthy();
    await nudge.sendNudges(at(400));
    expect(await messagesFor(id, 'abandoned_nudge')).toHaveLength(1);
  });
  it('never at night: it waits for the morning', async () => {
    const { id } = await checkedOut();
    await db.query("update orders set checkout_saved_at = $2 where id = $1", [id, new Date('2026-10-12T15:00:00Z').toISOString()]); // 4pm Lagos
    expect(await nudge.sendNudges(new Date('2026-10-12T21:30:00Z'))).toBe(0); // 10:30pm Lagos
    expect(await messagesFor(id, 'abandoned_nudge')).toHaveLength(0);
    expect(await nudge.sendNudges(new Date('2026-10-13T07:30:00Z'))).toBeGreaterThanOrEqual(1); // 8:30am Lagos
    expect(await messagesFor(id, 'abandoned_nudge')).toHaveLength(1);
  });
  it('respects the opt-out, the on/off switch, and orders that are too old', async () => {
    const a = await checkedOut();
    await db.query('update customers set nudge_ok = false where id = $1', [(await customerOf(a.id)).id]);
    const b = await checkedOut();
    const old = await checkedOut();
    for (const x of [a, b]) await db.query('update orders set checkout_saved_at = $2 where id = $1', [x.id, T0.toISOString()]);
    await db.query('update orders set checkout_saved_at = $2 where id = $1', [old.id, new Date(T0.getTime() - 60 * 3_600_000).toISOString()]);
    await settings.setSetting('nudge_enabled', false);
    expect(await nudge.sendNudges(at(200))).toBe(0);
    await settings.setSetting('nudge_enabled', true);
    await nudge.sendNudges(at(200));
    expect(await messagesFor(a.id, 'abandoned_nudge')).toHaveLength(0); // opted out
    expect(await messagesFor(old.id, 'abandoned_nudge')).toHaveLength(0); // more than 48 hours
    expect(await messagesFor(b.id, 'abandoned_nudge')).toHaveLength(1);
  });
  it('leaves an order alone once it is paid, and writes in Pidgin for a customer who chose it', async () => {
    const paid = await checkedOut();
    const pcm = await checkedOut();
    for (const x of [paid, pcm]) await db.query('update orders set checkout_saved_at = $2 where id = $1', [x.id, T0.toISOString()]);
    await pay(paid.id);
    await db.query("update customers set lang = 'pcm' where id = $1", [(await customerOf(pcm.id)).id]);
    await nudge.sendNudges(at(200));
    expect(await messagesFor(paid.id, 'abandoned_nudge')).toHaveLength(0);
    const m = await messagesFor(pcm.id, 'abandoned_nudge');
    expect(m).toHaveLength(1);
    expect(m[0].lang).toBe('pcm');
    expect(m[0].body).toMatch(/dey wait/);
  });
  it('sends English to everyone when the team switches Pidgin off', async () => {
    const x = await checkedOut();
    await db.query("update customers set lang = 'pcm' where id = $1", [(await customerOf(x.id)).id]);
    await db.query('update orders set checkout_saved_at = $2 where id = $1', [x.id, T0.toISOString()]);
    await settings.setSetting('pidgin_enabled', false);
    await nudge.sendNudges(at(200));
    await settings.setSetting('pidgin_enabled', true);
    const m = await messagesFor(x.id, 'abandoned_nudge');
    expect(m).toHaveLength(1);
    expect(m[0].lang).toBe('en');
    expect(m[0].body).not.toMatch(/dey wait/);
  });
  it('sends one reminder per person even when two of their orders are waiting', async () => {
    const who = person();
    const one = await checkedOut({ who });
    const two = await checkedOut({ who });
    for (const x of [one, two]) await db.query('update orders set checkout_saved_at = $2 where id = $1', [x.id, T0.toISOString()]);
    await nudge.sendNudges(at(200));
    const n = (await messagesFor(one.id, 'abandoned_nudge')).length + (await messagesFor(two.id, 'abandoned_nudge')).length;
    expect(n).toBe(1);
  });
  it('counts what it earned', async () => {
    const stats = await nudge.nudgeStats(30, at(300));
    expect(stats.sent).toBeGreaterThan(0);
    expect(stats.recoveredKobo).toBeGreaterThanOrEqual(0);
  });
});

describe('referral codes', () => {
  async function customer(name: string) {
    const n = ++seq;
    return (await db.one<any>('insert into customers (name, phone, email) values ($1,$2,$3) returning *', [name, `+23480${String(70000000 + n)}`, `ref${n}@example.com`]))!;
  }
  it('gives each customer one personal code, the same one every time, that follows the settings', async () => {
    const ada = await customer('Ada Obi');
    const a = await referrals.ensureReferralCode(ada.id);
    const b = await referrals.ensureReferralCode(ada.id);
    expect(a!.code).toMatch(/^ADA/);
    expect(b!.id).toBe(a!.id);
    expect(a!.source).toBe('referral');
    expect(a!.first_order_only).toBe(true);
    await referrals.syncReferralCoupons({ referral_friend_percent: 12, referral_friend_cap_kobo: 300_000 });
    expect((await db.one<any>('select percent_off, max_discount_kobo from coupons where id = $1', [a!.id]))).toEqual({ percent_off: 12, max_discount_kobo: 300_000 });
    await referrals.syncReferralCoupons({ referral_friend_percent: 10, referral_friend_cap_kobo: 500_000 });
  });
  it('gives nothing when referrals are switched off', async () => {
    const c = await customer('Bola Ade');
    await settings.setSetting('referral_enabled', false);
    expect(await referrals.ensureReferralCode(c.id)).toBeNull();
    await settings.setSetting('referral_enabled', true);
  });
  it('lets a friend use it once, never the owner, and pays the owner only after delivery', async () => {
    const owner = await customer('Chidi Okafor');
    const code = (await referrals.ensureReferralCode(owner.id))!;
    const prod = (await db.one<any>("select id from products where slug = 'business-cards'"))!;
    // The owner cannot use their own code.
    const own = await coupons.validateCoupon(code.code, { subtotalKobo: 1_500_000, designKobo: 0, deliveryKobo: 0, productId: prod.id, identity: { customerId: owner.id } });
    expect(own.ok).toBe(false);
    if (!own.ok) expect(own.message).toMatch(/your own referral code/);
    // A friend takes 10% off the print.
    const friend = person();
    const { id } = await checkedOut({ who: friend, code: code.code });
    const o = (await orders.getOrder(id))!;
    expect(o.discount_kobo).toBe(150_000);
    await pay(id);
    expect(await referrals.issueReferralRewards()).toBe(0); // not delivered yet: no reward
    await db.query("update orders set status = 'delivered', delivered_at = now() where id = $1", [id]);
    expect(await referrals.issueReferralRewards()).toBeGreaterThanOrEqual(1);
    const reward = (await db.one<any>("select c.* from referral_rewards w join coupons c on c.id = w.reward_coupon_id where w.referrer_id = $1", [owner.id]))!;
    expect(reward.source).toBe('reward');
    expect(reward.amount_off_kobo).toBe(100_000);
    expect(reward.owner_customer_id).toBe(owner.id);
    expect(reward.ends_at).toBeTruthy();
    const told = await db.query<any>("select * from messages where template = 'referral_reward' and to_phone = $1", [owner.phone]);
    expect(told).toHaveLength(1);
    expect(told[0].body).toContain(reward.code);
    // Safe to run again: no second reward for the same friend.
    expect(await referrals.issueReferralRewards()).toBe(0);
    // The reward is for the owner alone.
    const stranger = await coupons.validateCoupon(reward.code, { subtotalKobo: 1_500_000, designKobo: 0, deliveryKobo: 0, productId: prod.id, identity: { phone: '+2348099990000' } });
    expect(stranger.ok).toBe(false);
    const mine = await coupons.validateCoupon(reward.code, { subtotalKobo: 1_500_000, designKobo: 0, deliveryKobo: 0, productId: prod.id, identity: { customerId: owner.id } });
    expect(mine.ok).toBe(true);
    // The friend cannot use the same code on a second order.
    const again = await coupons.validateCoupon(code.code, { subtotalKobo: 1_500_000, designKobo: 0, deliveryKobo: 0, productId: prod.id, identity: { phone: (await import('../lib/phone')).normalizePhone(friend.phone) } });
    expect(again.ok).toBe(false);
    const summary = await referrals.referralSummary(owner.id);
    expect(summary!.friendsOrdered).toBe(1);
    expect(summary!.earned).toBe(1);
    expect(summary!.rewards[0].usable).toBe(true);
  });
  it('stops paying out after the cap, but still records the order so it is not looked at again', async () => {
    const owner = await customer('Dayo Bello');
    const code = (await referrals.ensureReferralCode(owner.id))!;
    await settings.setSetting('referral_max_rewards', 0);
    const { id } = await checkedOut({ code: code.code });
    await pay(id);
    await db.query("update orders set status = 'delivered', delivered_at = now() where id = $1", [id]);
    await referrals.issueReferralRewards();
    const w = await db.query<any>('select reward_coupon_id, amount_kobo from referral_rewards where referrer_id = $1', [owner.id]);
    expect(w).toEqual([{ reward_coupon_id: null, amount_kobo: 0 }]);
    await settings.setSetting('referral_max_rewards', 20);
  });
  it('reports what the programme did', async () => {
    const s = await referrals.referralStats(90);
    expect(s.codes).toBeGreaterThanOrEqual(3);
    expect(s.friendOrders).toBeGreaterThanOrEqual(2);
    expect(s.rewards).toBeGreaterThanOrEqual(1);
  });
});

describe('ready-made templates', () => {
  it('starts with real templates for the products on sale, each with questions', async () => {
    const all = await templates.listTemplates();
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const t of all) {
      expect(t.fields.length, t.slug).toBeGreaterThan(0);
      expect(t.product_slug, t.slug).toBeTruthy();
    }
  });
  const answersFor = (t: { fields: { key: string; required: boolean; kind: string }[] }) =>
    Object.fromEntries(t.fields.filter((f) => f.required).map((f) => [f.key, f.kind === 'date' ? '2026-12-13' : 'Grace Chapel']));
  it('turns answers into a design order with the wording written out for the designer', async () => {
    const t = (await templates.getTemplate('church-programme'))!;
    const r = await templates.startFromTemplate(t.slug, { answers: answersFor(t) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const o = (await orders.getOrder(r.orderId))!;
    expect(o.template_id).toBe(t.id);
    const item = (await orders.getItem(r.orderId))!;
    expect(item.artwork_path).toBe('design');
    expect(item.design_brief.wording).toContain('Grace Chapel');
    expect(item.design_brief.template.slug).toBe('church-programme');
    expect(o.subtotal_kobo).toBeGreaterThan(0);
  });
  it('says which required answer is missing and refuses a quantity that is not on the list', async () => {
    const t = (await templates.getTemplate('church-programme'))!;
    const missing = await templates.startFromTemplate(t.slug, { answers: {} });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.field).toBe(t.fields.find((f) => f.required)!.key);
    const wrongQty = await templates.startFromTemplate(t.slug, { answers: answersFor(t), quantity: 7 });
    expect(wrongQty.ok).toBe(false);
    if (!wrongQty.ok) expect(wrongQty.field).toBe('quantity');
  });
  it('hides a template that is switched off and refuses to start from it', async () => {
    const t = (await templates.getTemplate('church-programme'))!;
    await templates.setTemplateActive(t.id, false);
    expect((await templates.listTemplates()).some((x) => x.slug === t.slug)).toBe(false);
    expect((await templates.startFromTemplate(t.slug, { answers: answersFor(t) })).ok).toBe(false);
    expect((await templates.listTemplates({ all: true })).some((x) => x.slug === t.slug)).toBe(true);
    await templates.setTemplateActive(t.id, true);
  });
  it('lets the team make a template, with checks', async () => {
    const prod = (await templates.templateProductChoices()).find((p) => p.pricing_mode === 'tier')!;
    const base = { title: 'Open day invite', category: 'School', blurb: '', includes: '', productId: prod.id, quantity: '100', sizeKey: '', widthFt: '', heightFt: '', purpose: 'Invitation', fields: 'School name* | Full name\nDate | When | date', layout: 'invite', palette: 'royal', lines: 'You are invited' };
    await expect(templates.createTemplate({ ...base, title: 'x' })).rejects.toThrow(/name/);
    await expect(templates.createTemplate({ ...base, fields: '' })).rejects.toThrow(/question/);
    await expect(templates.createTemplate({ ...base, quantity: '0' })).rejects.toThrow(/Quantity/);
    const made = await templates.createTemplate(base);
    expect(made.slug).toBe('open-day-invite');
    const twin = await templates.createTemplate(base);
    expect(twin.slug).not.toBe(made.slug);
    await templates.deleteTemplate(twin.id);
    expect(await templates.getTemplate(twin.slug, { all: true })).toBeNull();
  });
  it('brings the brand kit colours and logo note into the brief when the customer has a kit', async () => {
    const who = person();
    const { id: oid } = await checkedOut({ who });
    const c = await customerOf(oid);
    await kit.saveBrandKit(c.id, { display_name: 'Tola Bakes', primary_hex: '#7A1F2B', phone_line: '0803 000 0000' });
    const t = (await templates.getTemplate('church-programme'))!;
    const r = await templates.startFromTemplate(t.slug, { answers: answersFor(t), customerId: c.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const item = (await orders.getItem(r.orderId))!;
    expect(item.design_brief.brand_kit.name).toBe('Tola Bakes');
    expect(item.design_brief.colours).toContain('#7A1F2B');
  });
});

describe('plan my event', () => {
  const future = (days: number) => new Date(Date.now() + days * 86_400_000 + 3_600_000).toISOString().slice(0, 10);
  const contact = () => { const p = person(); return { name: p.name, phone: p.phone, email: p.email }; };
  it('creates one request that carries the whole plan, due two days before the event', async () => {
    const date = future(40);
    const r = await eventPlan.createEventPlan({ type: 'wedding', date, guests: 200, items: [{ key: 'invitations', qty: 100 }, { key: 'banner', qty: 1 }], extra: 'A cake topper', notes: 'Navy and gold' }, contact(), []);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const row = (await db.one<any>('select kind, event_plan, need_by::text as need_by, title, details from custom_requests where id = $1', [r.id]))!;
    expect(row.kind).toBe('event');
    expect(row.event_plan.items).toHaveLength(2);
    expect(row.event_plan.items[0].label).toBe('Invitation cards');
    const want = new Date(new Date(`${date}T00:00:00Z`).getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
    expect(row.need_by.slice(0, 10)).toBe(want);
    expect(row.details).toContain('A cake topper');
    expect(row.title).toMatch(/^Wedding on /);
  });
  it('refuses a date that has passed or is too far away', async () => {
    const past = await eventPlan.createEventPlan({ type: 'wedding', date: '2026-01-01', guests: 100, items: [{ key: 'posters', qty: 5 }] }, contact(), []);
    expect(past.ok).toBe(false);
    const far = await eventPlan.createEventPlan({ type: 'wedding', date: future(500), guests: 100, items: [{ key: 'posters', qty: 5 }] }, contact(), []);
    expect(far.ok).toBe(false);
  });
  it('becomes one order at the one quoted price, with the plan in its brief', async () => {
    const r = await eventPlan.createEventPlan({ type: 'church', date: future(60), guests: 120, items: [{ key: 'programmes', qty: 120 }, { key: 'rollup', qty: 1 }] }, contact(), []);
    if (!r.ok) throw new Error('setup');
    const lead = await actor('lead@brandit.test');
    const q = await custom.quoteRequest(r.id, lead.id, { price: '185000', days: '6' });
    expect(q.ok).toBe(true);
    const a = await custom.acceptQuote(r.token);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const o = (await orders.getOrder(a.orderId))!;
    expect(o.subtotal_kobo).toBe(18_500_000);
    const item = (await orders.getItem(a.orderId))!;
    expect(item.label).toMatch(/^Event: /);
    expect(item.design_brief.event_plan.items).toHaveLength(2);
    // Accepting twice finds the same order.
    const again = await custom.acceptQuote(r.token);
    expect(again.ok && again.orderId).toBe(a.orderId);
  });
  it('gives a guide price from the same price list, and says plainly when it cannot', async () => {
    const e = await eventPlan.estimatePlan([{ key: 'programmes', qty: 100 }, { key: 'flyers', qty: 90_000 }, { key: 'nonsense', qty: 3 }]);
    expect(e.rows.find((x) => x.key === 'programmes')!.kobo).toBeGreaterThan(0);
    expect(e.rows.find((x) => x.key === 'flyers')!.kobo).toBeNull(); // far beyond the price list: a person prices it
    expect(e.rows.some((x) => x.key === 'nonsense')).toBe(false);
    expect(e.complete).toBe(false);
    expect(e.totalKobo).toBeGreaterThan(0);
    const stats = await eventPlan.eventPlanStats(30);
    expect(stats.requests).toBeGreaterThanOrEqual(2);
    expect(stats.accepted).toBeGreaterThanOrEqual(1);
  });
});

describe('delivery windows at checkout', () => {
  it('keeps the choice for a delivery, drops it for pickup, and ignores it when switched off', async () => {
    const standard = await checkedOut({ area: 'Ikorodu', window: 'morning' });
    expect((await orders.getOrder(standard.id))!.delivery_window).toBe('morning');
    const pickup = await checkedOut({ pickup: true, window: 'morning' });
    expect((await orders.getOrder(pickup.id))!.delivery_window).toBeNull();
    await settings.setSetting('windows_enabled', false);
    const off = await checkedOut({ area: 'Ikorodu', window: 'afternoon' });
    expect((await orders.getOrder(off.id))!.delivery_window).toBeNull();
    await settings.setSetting('windows_enabled', true);
  });
  it('does not change the promise', async () => {
    const a = await checkedOut({ area: 'Ikorodu', window: 'morning' });
    const b = await checkedOut({ area: 'Ikorodu', window: 'afternoon' });
    const pa = (await orders.getOrder(a.id))!, pb = (await orders.getOrder(b.id))!;
    expect(pa.speed).toBe(pb.speed);
    expect(new Date(pa.promised_at).toISOString().slice(11)).toBe(new Date(pb.promised_at).toISOString().slice(11));
  });
});

describe('rider link and live position', () => {
  async function onTheRoad() {
    const { id } = await checkedOut({ upload: true });
    await pay(id);
    const jobId = (await db.one<any>('select id from jobs where order_id = $1', [id]))!.id as string;
    const desk = await actor('files@brandit.test'), lead = await actor('lead@brandit.test'), dispatcher = await actor('dispatch@brandit.test');
    await db.query('update order_items set preview_approved_at = now() where order_id = $1', [id]);
    await jobs.moveJob(jobId, 'printing', { actor: desk });
    await jobs.moveJob(jobId, 'quality_check', { actor: lead });
    const item = (await orders.getItem(id))!;
    await art.saveSimpleFile(id, item.id, 'qc_photo', { name: 'done.png', type: 'image/png', buf: makePng(40, 40) });
    await jobs.saveDelivery(id, dispatcher, { rider_name: 'Musa Danjuma', rider_phone: '08030000000' });
    const tok = (await db.one<any>('select rider_token from deliveries where order_id = $1', [id]))!.rider_token as string;
    return { id, jobId, tok, lead };
  }
  it('gives every delivery its own private link', async () => {
    const a = await onTheRoad();
    const b = await onTheRoad();
    expect(a.tok).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(a.tok).not.toBe(b.tok);
  });
  it('shows nothing until the order is on the road, and nothing for a wrong link', async () => {
    const a = await onTheRoad();
    expect((await rider.riderView(a.tok)).state).toBe('waiting');
    expect((await rider.riderView('x'.repeat(24))).state).toBe('missing');
    expect((await rider.riderView('../../etc')).state).toBe('missing');
    expect((await rider.startTrip(a.tok)).ok).toBe(false);
    expect((await rider.markNearby(a.tok)).ok).toBe(false);
    expect((await rider.submitCode(a.tok, '1234')).ok).toBe(false);
  });
  it('shares position only after the rider starts, rate-limits it, and shows the customer only a fresh one', async () => {
    const a = await onTheRoad();
    await jobs.moveJob(a.jobId, 'out_for_delivery', { actor: a.lead });
    const v = await rider.riderView(a.tok);
    expect(v.state).toBe('active');
    if (v.state === 'active') {
      expect(v.customer).toMatch(/^Tester/);
      expect(v.started).toBe(false);
      expect(JSON.stringify(v)).not.toMatch(/delivery_code|@example\.com/);
    }
    const t0 = new Date('2026-10-12T10:00:00Z');
    expect((await rider.recordPing(a.tok, { lat: 6.5, lng: 3.3 }, t0)).ok).toBe(false); // trip not started
    expect((await rider.startTrip(a.tok)).ok).toBe(true);
    expect((await rider.recordPing(a.tok, { lat: 6.5, lng: 3.3, accuracy: 12 }, t0)).ok).toBe(true);
    expect((await rider.recordPing(a.tok, { lat: 0, lng: 0 }, new Date(t0.getTime() + 30_000))).ok).toBe(false);
    expect((await rider.recordPing(a.tok, { lat: 'no', lng: 3 }, new Date(t0.getTime() + 30_000))).ok).toBe(false);
    await rider.recordPing(a.tok, { lat: 6.6, lng: 3.4 }, new Date(t0.getTime() + 3_000)); // too soon: ignored
    expect((await db.one<any>('select last_lat from deliveries where order_id = $1', [a.id]))!.last_lat).toBe(6.5);
    await rider.recordPing(a.tok, { lat: 6.6, lng: 3.4 }, new Date(t0.getTime() + 12_000));
    expect((await db.one<any>('select last_lat from deliveries where order_id = $1', [a.id]))!.last_lat).toBe(6.6);
    expect((await rider.liveFor(a.id, new Date(t0.getTime() + 5 * 60_000)))!.mapUrl).toContain('6.60000,3.40000');
    expect(await rider.liveFor(a.id, new Date(t0.getTime() + 16 * 60_000))).toBeNull(); // stale: not shown
  });
  it('tells the customer once that the rider is close', async () => {
    const a = await onTheRoad();
    await jobs.moveJob(a.jobId, 'out_for_delivery', { actor: a.lead });
    expect((await rider.markNearby(a.tok)).ok).toBe(true);
    expect(((await rider.markNearby(a.tok)) as { message?: string }).message).toMatch(/already knows/);
    const m = await messagesFor(a.id, 'rider_nearby');
    expect(m).toHaveLength(1);
    expect(m[0].body).toContain('Musa');
    expect(m[0].body).toContain((await orders.getOrder(a.id))!.delivery_code);
  });
  it('locks after five wrong codes, then completes with the right one, and erases the position', async () => {
    const a = await onTheRoad();
    await jobs.moveJob(a.jobId, 'out_for_delivery', { actor: a.lead });
    const code = String((await orders.getOrder(a.id))!.delivery_code);
    const wrong = code === '0000' ? '1111' : '0000';
    const t0 = new Date('2026-10-12T12:00:00Z');
    await rider.startTrip(a.tok);
    await rider.recordPing(a.tok, { lat: 6.45, lng: 3.39 }, t0);
    expect((await rider.submitCode(a.tok, '12', t0)).ok).toBe(false); // wrong length costs nothing
    for (let i = 0; i < 4; i++) expect((await rider.submitCode(a.tok, wrong, t0)).ok).toBe(false);
    const fifth = await rider.submitCode(a.tok, wrong, t0);
    expect(fifth.ok).toBe(false);
    const locked = await rider.submitCode(a.tok, code, new Date(t0.getTime() + 60_000));
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.error).toMatch(/Too many/);
    expect((await orders.getOrder(a.id))!.status).not.toBe('delivered');
    const done = await rider.submitCode(a.tok, code, new Date(t0.getTime() + 16 * 60_000));
    expect(done.ok).toBe(true);
    expect((await orders.getOrder(a.id))!.status).toBe('delivered');
    const d = (await db.one<any>('select last_lat, last_lng, last_ping_at from deliveries where order_id = $1', [a.id]))!;
    expect(d).toEqual({ last_lat: null, last_lng: null, last_ping_at: null });
    expect((await rider.riderView(a.tok)).state).toBe('done');
    expect((await rider.submitCode(a.tok, code)).ok).toBe(false);
  });
  it('sweeps up any position left behind on a delivered order or older than a day', async () => {
    const a = await onTheRoad();
    await db.query("update deliveries set last_lat = 6.4, last_lng = 3.4, last_ping_at = now() - interval '2 days', started_at = now() where order_id = $1", [a.id]);
    expect(await rider.cleanupRiderData()).toBeGreaterThanOrEqual(1);
    expect((await db.one<any>('select last_lat from deliveries where order_id = $1', [a.id]))!.last_lat).toBeNull();
  });
});

describe('seasonal pages', () => {
  const input = (over: Partial<import('../lib/campaigns').CampaignInput> = {}) => ({
    title: 'Wedding season', headline: 'Print for the big day', intro: '', theme: 'burgundy', startsOn: '2026-10-01', endsOn: '2026-12-31', note: 'Order by 10 December', couponCode: '', productSlugs: ['flyers'], templateSlugs: [], showOnHome: true, ...over,
  });
  it('starts hidden, goes live on the dates in Lagos time, and ends after the last day', async () => {
    const c = await campaigns.createCampaign(input({ title: 'Test season one' }));
    expect(c.active).toBe(false);
    expect(campaigns.phaseNow(c, new Date('2026-10-12T10:00:00Z'))).toBe('hidden');
    await campaigns.setCampaignActive(c.id, true);
    const live = (await campaigns.getCampaign(c.slug))!;
    expect(campaigns.phaseNow(live, new Date('2026-10-12T10:00:00Z'))).toBe('live');
    expect(campaigns.phaseNow(live, new Date('2026-09-30T22:59:00Z'))).toBe('upcoming'); // 11:59pm in Lagos on 30 Sep
    expect(campaigns.phaseNow(live, new Date('2026-09-30T23:00:00Z'))).toBe('live');    // midnight in Lagos on 1 Oct
    expect(campaigns.phaseNow(live, new Date('2026-12-31T22:59:00Z'))).toBe('live');
    expect(campaigns.phaseNow(live, new Date('2026-12-31T23:00:00Z'))).toBe('ended');
    expect((await campaigns.liveCampaigns(new Date('2026-10-12T10:00:00Z'))).some((x) => x.id === c.id)).toBe(true);
    expect((await campaigns.liveCampaigns(new Date('2027-01-05T10:00:00Z'))).some((x) => x.id === c.id)).toBe(false);
  });
  it('checks what staff type', async () => {
    await expect(campaigns.createCampaign(input({ title: 'x' }))).rejects.toThrow(/name/);
    await expect(campaigns.createCampaign(input({ startsOn: '2026-12-31', endsOn: '2026-12-01' }))).rejects.toThrow(/before/);
    await expect(campaigns.createCampaign(input({ startsOn: '2026-02-30' }))).rejects.toThrow(/first day/);
    await expect(campaigns.createCampaign(input({ couponCode: 'NOSUCHCODE' }))).rejects.toThrow(/no coupon/);
  });
  it('gives two pages with the same name different addresses', async () => {
    const a = await campaigns.createCampaign(input({ title: 'Same name' }));
    const b = await campaigns.createCampaign(input({ title: 'Same name' }));
    expect(a.slug).not.toBe(b.slug);
  });
});

describe('brand kit', () => {
  async function owner() {
    const n = ++seq;
    return (await db.one<any>('insert into customers (name, phone, email) values ($1,$2,$3) returning id', [`Kit Owner${n}`, `+23481${String(10000000 + n)}`, `kit${n}@example.com`]))!.id as string;
  }
  it('saves a kit and refuses a bad colour or website', async () => {
    const id = await owner();
    await kit.saveBrandKit(id, { display_name: 'Tola Bakes', tagline: 'Fresh daily', primary_hex: '0b1f33', website: 'tolabakes.ng', notes: 'Never use red' });
    const k = (await kit.brandKitFor(id))!;
    expect(k.primary_hex).toBe('#0B1F33');
    expect(k.display_name).toBe('Tola Bakes');
    await expect(kit.saveBrandKit(id, { primary_hex: 'blue' })).rejects.toThrow(/colour/);
    await expect(kit.saveBrandKit(id, { website: 'javascript:alert(1)' })).rejects.toThrow(/website/);
    expect((await kit.brandKitFor(id))!.primary_hex).toBe('#0B1F33'); // the failed save changed nothing
  });
  it('keeps logo files exactly as uploaded, makes a thumbnail, and only the owner can remove them', async () => {
    const id = await owner(), other = await owner();
    const png = makePng(800, 800);
    const a = await kit.addAsset(id, 'logo', 'Main logo', { name: 'logo.png', buf: png });
    expect(a.has_thumb).toBe(true);
    const row = (await db.one<any>('select storage_key from brand_assets where id = $1', [a.id]))!;
    expect((await storage.getFile(row.storage_key)).equals(png)).toBe(true);
    expect(await kit.deleteAsset(other, a.id)).toBe(false);
    expect((await kit.listAssets(id))).toHaveLength(1);
    expect(await kit.deleteAsset(id, a.id)).toBe(true);
    await expect(storage.getFile(row.storage_key)).rejects.toThrow();
  });
  it('refuses files that are not images or PDFs, and stops at twenty', async () => {
    const id = await owner();
    await expect(kit.addAsset(id, 'logo', 'x', { name: 'x.exe', buf: Buffer.from('MZ not a picture') })).rejects.toThrow(/not a JPG/);
    await expect(kit.addAsset(id, 'banana' as any, 'x', { name: 'x.png', buf: makePng(300, 300) })).rejects.toThrow(/kind/);
    for (let i = 0; i < kit.MAX_ASSETS; i++) await db.query("insert into brand_assets (customer_id, kind, title, storage_key, mime, bytes) values ($1,'other','f','k','image/png',1)", [id]);
    await expect(kit.addAsset(id, 'logo', 'one more', { name: 'x.png', buf: makePng(300, 300) })).rejects.toThrow(/up to 20/);
    await db.query('delete from brand_assets where customer_id = $1', [id]);
  });
  it('saves an approved design from a past order, shares the file safely, and never saves ID cards', async () => {
    const { id: oid } = await checkedOut({ upload: true });
    await pay(oid);
    const o = (await orders.getOrder(oid))!;
    const cust = await customerOf(oid);
    const a = await kit.saveOrderDesign(cust.id, o.public_token);
    expect(a.kind).toBe('design');
    await expect(kit.saveOrderDesign(cust.id, o.public_token)).rejects.toThrow(/already/);
    const stranger = await owner();
    await expect(kit.saveOrderDesign(stranger, o.public_token)).rejects.toThrow(/could not find/);
    // Removing it from the kit must not delete the file the order still needs.
    const shared = (await db.one<any>('select storage_key from brand_assets where id = $1', [a.id]))!.storage_key as string;
    expect(await kit.deleteAsset(cust.id, a.id)).toBe(true);
    await expect(storage.getFile(shared)).resolves.toBeInstanceOf(Buffer);
    // ID cards hold other people's details.
    const idc: any = await orders.createDraft({ slug: 'id-cards', quantity: 10, area: 'Yaba' });
    if (!idc.error) {
      await db.query('update orders set customer_id = $2, status = $3 where id = $1', [idc.id, cust.id, 'paid']);
      const t = (await orders.getOrder(idc.id))!;
      await expect(kit.saveOrderDesign(cust.id, t.public_token)).rejects.toThrow(/ID card/);
    }
  });
  it('gives the designer a snapshot of the kit', async () => {
    const id = await owner();
    expect(await kit.brandSnapshot(id)).toBeNull();
    await kit.saveBrandKit(id, { display_name: 'Tola Bakes', primary_hex: '#7A1F2B', phone_line: '0803 000 0000', address_line: 'Lekki' });
    await kit.addAsset(id, 'logo', 'Logo', { name: 'logo.png', buf: makePng(500, 500) });
    await kit.addAsset(id, 'other', 'Private note', { name: 'n.png', buf: makePng(300, 300) });
    const s = (await kit.brandSnapshot(id))!;
    expect(s.name).toBe('Tola Bakes');
    expect(s.colours).toContain('#7A1F2B');
    expect(s.contact).toBe('0803 000 0000 · Lekki');
    expect(s.assets.map((x) => x.kind)).toEqual(['logo']); // "other" files are not handed to the designer
  });
});

describe('photo reviews', () => {
  async function delivered() {
    const { id } = await checkedOut();
    await pay(id);
    await db.query("update orders set status = 'delivered', delivered_at = now() where id = $1", [id]);
    return { id, token: (await orders.getOrder(id))!.public_token as string };
  }
  const photo = () => ({ name: 'job.png', buf: makePng(600, 600) });
  it('needs a delivered order and a real rating, and only one review per order', async () => {
    const { id: draftId } = await checkedOut();
    const early = await rp.submitReview({ token: (await orders.getOrder(draftId))!.public_token, rating: 5 });
    expect(early.ok).toBe(false);
    const d = await delivered();
    expect((await rp.submitReview({ token: d.token, rating: 9 })).ok).toBe(false);
    expect((await rp.submitReview({ token: d.token, rating: 5, body: 'Lovely work' })).ok).toBe(true);
    const twice = await rp.submitReview({ token: d.token, rating: 4 });
    expect(twice.ok).toBe(false);
  });
  it('keeps a photo private until a person approves it, and public only with every yes', async () => {
    const d = await delivered();
    const r = await rp.submitReview({ token: d.token, rating: 5, body: 'Neat work and on time, thank you', publicOk: true, photoOk: true, photo: photo() });
    expect(r).toEqual({ ok: true, hasPhoto: true });
    const rev = (await db.one<any>('select * from reviews where order_id = $1', [d.id]))!;
    expect(rev.photo_status).toBe('pending');
    expect(rev.photo_public_ok).toBe(true);
    expect(await rp.readReviewPhoto(rev.id, 'full', false)).toBeNull();      // the public sees nothing
    expect((await rp.readReviewPhoto(rev.id, 'thumb', true))!.mime).toBe('image/webp'); // staff who moderate can look
    const staff = await actor('support@brandit.test');
    await rp.moderatePhoto(rev.id, staff.id, 'approve');
    expect(await rp.readReviewPhoto(rev.id, 'full', false)).toBeNull();      // approved, but staff have not picked the review
    await db.query('update reviews set featured = true where id = $1', [rev.id]);
    expect(await rp.readReviewPhoto(rev.id, 'full', false)).not.toBeNull();  // every yes is in
    await db.query('update reviews set photo_public_ok = false where id = $1', [rev.id]);
    expect(await rp.readReviewPhoto(rev.id, 'full', false)).toBeNull();      // the customer said no to the photo
    await expect(rp.moderatePhoto(rev.id, staff.id, 'reject')).rejects.toThrow(/already been checked/);
  });
  it('deletes a rejected photo at once', async () => {
    const d = await delivered();
    await rp.submitReview({ token: d.token, rating: 4, photo: photo() });
    const rev = (await db.one<any>('select id, photo_key, photo_thumb_key, photo_public_ok from reviews where order_id = $1', [d.id]))!;
    expect(rev.photo_public_ok).toBe(false); // no consent given, so none assumed
    const staff = await actor('support@brandit.test');
    await rp.moderatePhoto(rev.id, staff.id, 'reject');
    await expect(storage.getFile(rev.photo_key)).rejects.toThrow();
    await expect(storage.getFile(rev.photo_thumb_key)).rejects.toThrow();
    const after = (await db.one<any>('select photo_status, photo_key from reviews where id = $1', [rev.id]))!;
    expect(after).toEqual({ photo_status: 'rejected', photo_key: null });
  });
  it('removes the location and camera details a phone puts inside a photo', async () => {
    const sharp = (await import('sharp')).default;
    const jpg = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#c33' } }).jpeg().withExif({ IFD0: { Copyright: 'private-secret-owner', ImageDescription: 'taken at home' } }).toBuffer();
    expect((await sharp(jpg).metadata()).exif).toBeTruthy(); // the test picture really carries details
    const d = await delivered();
    expect((await rp.submitReview({ token: d.token, rating: 5, photo: { name: 'phone.jpg', buf: jpg } })).ok).toBe(true);
    const rev = (await db.one<any>('select photo_key, photo_thumb_key from reviews where order_id = $1', [d.id]))!;
    for (const k of [rev.photo_key, rev.photo_thumb_key]) {
      const stored = await storage.getFile(k);
      expect((await sharp(stored).metadata()).exif).toBeUndefined();
      expect(stored.toString('latin1')).not.toContain('private-secret-owner');
    }
  });
  it('turns away a file that is not a picture without losing the customer\'s review', async () => {
    const d = await delivered();
    const bad = await rp.submitReview({ token: d.token, rating: 5, photo: { name: 'x.png', buf: Buffer.from('this is not a picture at all') } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.field).toBe('photo');
    expect(await db.one('select 1 as x from reviews where order_id = $1', [d.id])).toBeNull(); // nothing stored: they can try again
    expect((await rp.submitReview({ token: d.token, rating: 5, body: 'Fine without a photo' })).ok).toBe(true);
  });
  it('removes photos nobody checked within sixty days, and keeps the review', async () => {
    const d = await delivered();
    await rp.submitReview({ token: d.token, rating: 5, body: 'Good', photo: photo() });
    const rev = (await db.one<any>('select id, photo_key from reviews where order_id = $1', [d.id]))!;
    expect(await rp.cleanupReviewPhotos(new Date(Date.now() + 30 * 86_400_000))).toBe(0);
    expect(await rp.cleanupReviewPhotos(new Date(Date.now() + 61 * 86_400_000))).toBeGreaterThanOrEqual(1);
    await expect(storage.getFile(rev.photo_key)).rejects.toThrow();
    expect((await db.one<any>('select body, photo_status from reviews where id = $1', [rev.id]))).toEqual({ body: 'Good', photo_status: 'rejected' });
  });
  it('shows an approved photo on the home page review only when every condition holds', async () => {
    const { featuredReviews } = await import('../lib/publicReviews');
    const d = await delivered();
    await rp.submitReview({ token: d.token, rating: 5, body: 'Neat work and it came on time', publicOk: true, photoOk: true, photo: photo() });
    const rev = (await db.one<any>('select id from reviews where order_id = $1', [d.id]))!;
    await db.query('update reviews set featured = true where id = $1', [rev.id]);
    expect((await featuredReviews(20)).find((r) => r.id === rev.id)!.has_photo).toBe(false); // not approved yet
    await rp.moderatePhoto(rev.id, (await actor('support@brandit.test')).id, 'approve');
    expect((await featuredReviews(20)).find((r) => r.id === rev.id)!.has_photo).toBe(true);
  });
});

describe('privacy covers the new data', () => {
  it('exports the brand kit, codes and preferences, then erases kit, photos, codes and rider position', async () => {
    const { id } = await checkedOut();
    await pay(id);
    const c = await customerOf(id);
    await kit.saveBrandKit(c.id, { display_name: 'Erase Me Bakes', primary_hex: '#112233' });
    const logo = await kit.addAsset(c.id, 'logo', 'Logo', { name: 'l.png', buf: makePng(500, 500) });
    const logoKey = (await db.one<any>('select storage_key from brand_assets where id = $1', [logo.id]))!.storage_key as string;
    const code = (await referrals.ensureReferralCode(c.id))!;
    await db.query("update orders set status = 'delivered', delivered_at = now() where id = $1", [id]);
    const token = (await orders.getOrder(id))!.public_token as string;
    await rp.submitReview({ token, rating: 5, body: 'Lovely', publicOk: true, photoOk: true, photo: { name: 'p.png', buf: makePng(500, 500) } });
    const rev = (await db.one<any>('select photo_key, photo_thumb_key from reviews where order_id = $1', [id]))!;
    await db.query("update deliveries set last_lat = 6.4, last_lng = 3.4, last_ping_at = now() where order_id = $1", [id]).catch(() => {});

    const data: any = await privacy.exportData(c.id);
    expect(data.brand_kit.display_name).toBe('Erase Me Bakes');
    expect(data.brand_files).toHaveLength(1);
    expect(data.my_codes.map((x: any) => x.code)).toContain(code.code);
    expect(data.profile).toMatchObject({ nudge_ok: true, lang: 'en' });
    expect(data.reviews[0]).toMatchObject({ photo_status: 'pending', has_photo: true });
    expect(JSON.stringify(data)).not.toMatch(/storage_key|photo_key/);

    expect(await privacy.deleteAccount(c.id)).toEqual({ ok: true });
    expect(await db.one('select 1 as x from brand_kits where customer_id = $1', [c.id])).toBeNull();
    expect(await db.query('select 1 from brand_assets where customer_id = $1', [c.id])).toHaveLength(0);
    await expect(storage.getFile(logoKey)).rejects.toThrow();
    await expect(storage.getFile(rev.photo_key)).rejects.toThrow();
    await expect(storage.getFile(rev.photo_thumb_key)).rejects.toThrow();
    expect((await db.one<any>('select photo_status, photo_key, body from reviews where order_id = $1', [id]))).toEqual({ photo_status: 'none', photo_key: null, body: null });
    const cp = (await db.one<any>('select active, owner_customer_id from coupons where id = $1', [code.id]))!;
    expect(cp).toEqual({ active: false, owner_customer_id: null });
    const bad = await coupons.validateCoupon(code.code, { subtotalKobo: 1_500_000, designKobo: 0, deliveryKobo: 0, productId: (await db.one<any>("select id from products where slug = 'business-cards'"))!.id, identity: { phone: '+2348099990001' } });
    expect(bad.ok).toBe(false);
  });
});

describe('migration 006 on a database that already has shop data', () => {
  it('keeps what is there, adds safe defaults, seeds starting content once, and can be applied twice', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { MIGRATIONS } = await import('../lib/schema');
    const { seedGrowthContent } = await import('../lib/growth-content');
    const pg = new PGlite();
    const q = { query: async (sql: string, params?: unknown[]) => (await pg.query(sql, params as any[])).rows as any[] };
    const idx = MIGRATIONS.findIndex((m) => m.id.startsWith('006'));
    expect(idx).toBeGreaterThan(0);
    for (const m of MIGRATIONS.slice(0, idx)) { await pg.exec(m.sql); if (m.after) await m.after(q as any); }
    for (const slug of ['business-cards', 'flyers', 'posters', 'flex-banners', 'roll-up-banners', 'tees-and-totes', 'stickers', 'id-cards']) {
      await pg.exec(`insert into products (slug, name, pricing_mode) values ('${slug}', '${slug}', 'tier') on conflict do nothing`);
    }
    await pg.exec("insert into customers (phone, name) values ('+2348030000000', 'Old Customer')");
    await pg.exec("insert into coupons (code, kind, percent_off) values ('OLD10', 'percent', 10)");
    await pg.exec("insert into orders (code, public_token, status, customer_id, total_kobo, paid_at) select 'BR-OLD', 'oldtoken', 'delivered', id, 100000, now() from customers limit 1");
    await pg.exec("insert into order_items (order_id, product_id, quantity, line_total_kobo) select o.id, p.id, 100, 100000 from orders o, products p where p.slug = 'business-cards'");
    await pg.exec("insert into reviews (order_id, rating, body) select id, 5, 'Fast and neat work, thank you' from orders limit 1");
    const before = (await q.query('select count(*)::int as n from products'))[0].n;
    for (const m of MIGRATIONS.slice(idx)) { await pg.exec(m.sql); if (m.after) await m.after(q as any); }

    expect((await q.query("select lang, nudge_ok from customers where phone = '+2348030000000'"))[0]).toEqual({ lang: 'en', nudge_ok: true });
    expect((await q.query("select source, owner_customer_id from coupons where code = 'OLD10'"))[0]).toEqual({ source: 'manual', owner_customer_id: null });
    expect((await q.query('select photo_status, photo_public_ok, photo_key from reviews'))[0]).toEqual({ photo_status: 'none', photo_public_ok: false, photo_key: null });
    expect((await q.query("select delivery_window, nudged_at, template_id from orders where code = 'BR-OLD'"))[0]).toEqual({ delivery_window: null, nudged_at: null, template_id: null });
    expect((await q.query('select count(*)::int as n from products'))[0].n).toBe(before);
    const seeded = (await q.query('select count(*)::int as n from templates'))[0].n;
    expect(seeded).toBeGreaterThan(0);
    await seedGrowthContent(q as any); // running the seed again must not duplicate anything
    expect((await q.query('select count(*)::int as n from templates'))[0].n).toBe(seeded);
    await pg.close();
  });
});
