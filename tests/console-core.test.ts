import { beforeAll, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';

process.env.PGLITE_DIR = 'memory';
process.env.DEMO_MODE = 'true';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-console-${process.pid}`);
delete process.env.PAYSTACK_SECRET_KEY;
delete process.env.RESEND_API_KEY;

let db: typeof import('../lib/db');
let A: typeof import('../lib/audit');
let Biz: typeof import('../lib/business');
let Cus: typeof import('../lib/customers');
let PA: typeof import('../lib/paymentsAdmin');
let SR: typeof import('../lib/staffReset');
let CP: typeof import('../lib/contentPages');
let FAQ: typeof import('../lib/faqContent');
let HC: typeof import('../lib/homeContent');
let ST: typeof import('../lib/stock');
let MC: typeof import('../lib/messageCatalog');
let Msg: typeof import('../content/messages');
let Pw: typeof import('../lib/password');

let adminId = '';
let leadId = '';
const staffOf = (role: 'admin' | 'production_lead' | 'support', id = '') => ({ id: id || null, name: `Test ${role}`, role });
let seq = 0;
const uniq = () => `${++seq}${Math.random().toString(36).slice(2, 6)}`;

beforeAll(async () => {
  db = await import('../lib/db');
  await db.ready();
  A = await import('../lib/audit');
  Biz = await import('../lib/business');
  Cus = await import('../lib/customers');
  PA = await import('../lib/paymentsAdmin');
  SR = await import('../lib/staffReset');
  CP = await import('../lib/contentPages');
  FAQ = await import('../lib/faqContent');
  HC = await import('../lib/homeContent');
  ST = await import('../lib/stock');
  MC = await import('../lib/messageCatalog');
  Msg = await import('../content/messages');
  Pw = await import('../lib/password');
  adminId = (await db.one<{ id: string }>("select id from staff where role = 'admin' limit 1"))!.id;
  leadId = (await db.one<{ id: string }>("select id from staff where role = 'production_lead' limit 1"))!.id;
}, 120_000);

/* ---------------------------------------------------------------- the record of who changed what */
describe('audit record', () => {
  it('writes a line, shortens long words, and keeps the person even if they leave', async () => {
    await A.audit({ id: null, name: 'Ngozi' }, { area: 'settings', action: 'x'.repeat(200), target: 't'.repeat(500), summary: 'y'.repeat(900), detail: { a: 1 } });
    const r = await db.one<any>("select * from audit_log where actor = 'Ngozi' order by at desc limit 1");
    expect(r.action.length).toBeLessThanOrEqual(60);
    expect(r.target.length).toBeLessThanOrEqual(120);
    expect(r.summary.length).toBeLessThanOrEqual(400);
    expect(r.staff_id).toBeNull();
    expect(r.detail).toEqual({ a: 1 });
  });

  it('never throws: a record that cannot be saved must not undo the change it describes', async () => {
    const circular: any = {}; circular.self = circular;
    await expect(A.audit({ name: 'Ngozi' }, { area: 'settings', action: 'bad', summary: 'x', detail: circular })).resolves.toBeUndefined();
  });

  it('lists newest first, filters by area, and searches words literally', async () => {
    await A.audit({ name: 'Audit One' }, { area: 'refund', action: 'refund', target: 'BR-1', summary: 'Refunded 100% of it' });
    await A.audit({ name: 'Audit One' }, { area: 'team', action: 'added', target: 'Ada', summary: 'Added a person' });
    const refunds = await A.recentAudit({ area: 'refund' });
    expect(refunds.rows.length).toBeGreaterThan(0);
    expect(refunds.rows.every((r) => r.area === 'refund')).toBe(true);
    const lit = await A.recentAudit({ q: '100%' });
    expect(lit.rows.some((r) => r.summary.includes('100%'))).toBe(true);
    // A lone % must be a letter to look for, not "match everything".
    const pct = await A.recentAudit({ q: '%', limit: 200 });
    expect(pct.rows.every((r) => `${r.actor}${r.summary}${r.target}${r.action}`.includes('%'))).toBe(true);
    const all = await A.recentAudit({ limit: 200 });
    const times = all.rows.map((r) => +new Date(r.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('shows price changes in the same list, and pages with a "more" flag', async () => {
    await db.query("insert into price_history (actor, product_name, kind, summary) values ('Price Person', 'Flyers', 'price_set', 'Flyers 100: ₦20,000')");
    const r = await A.recentAudit({ q: 'Price Person' });
    expect(r.rows[0]).toMatchObject({ source: 'price', area: 'catalogue', target: 'Flyers' });
    for (let i = 0; i < 4; i++) await A.audit({ name: 'Pager' }, { area: 'content', action: 'p', summary: `page ${i}` });
    const p1 = await A.recentAudit({ q: 'Pager', limit: 2 });
    expect(p1.rows).toHaveLength(2);
    expect(p1.more).toBe(true);
    const p2 = await A.recentAudit({ q: 'Pager', limit: 2, offset: 2 });
    expect(p2.more).toBe(false);
    expect(p2.rows).toHaveLength(2);
  });
});

/* ---------------------------------------------------------------- business details */
describe('business details', () => {
  it('turns a Nigerian number into the international form and rejects nonsense', () => {
    const ok = Biz.checkBusiness({ whatsapp: '0803 123 4567', phone: '+234 803 123 4567', email: 'Hello@TheBrandit.ng', hours: '  Mon   to Sat  ' });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.whatsapp).toBe('2348031234567');
      expect(ok.value.email).toBe('hello@thebrandit.ng');
      expect(ok.value.hours).toBe('Mon to Sat');
    }
    expect(Biz.checkBusiness({ whatsapp: '08031234' })).toMatchObject({ ok: false, field: 'whatsapp' });
    expect(Biz.checkBusiness({ whatsapp: '020 7946 0958' })).toMatchObject({ ok: false, field: 'whatsapp' });
    const uk = Biz.checkBusiness({ whatsapp: '+44 20 7946 0958' });
    expect(uk.ok && uk.value.whatsapp).toBe('442079460958');
    expect(Biz.checkBusiness({ phone: 'call me' })).toMatchObject({ ok: false, field: 'phone' });
    expect(Biz.checkBusiness({ email: 'not-an-email' })).toMatchObject({ ok: false, field: 'email' });
    expect(Biz.checkBusiness({})).toMatchObject({ ok: true });
  });

  it('uses the hosting settings when nothing is typed, and never invents a detail', () => {
    const none = Biz.makeBusiness({}, {} as any);
    expect(none.whatsapp).toBeNull();
    expect(none.whatsappLink('hi')).toBeNull();
    expect(none.email).toBeNull();
    const env = Biz.makeBusiness({}, { NEXT_PUBLIC_WHATSAPP: '+234 800 000 0000', NEXT_PUBLIC_SUPPORT_EMAIL: 'a@b.ng', LEGAL_REVIEWED: 'YES' } as any);
    expect(env.whatsapp).toBe('2348000000000');
    expect(env.whatsappLink('Hi there')).toBe('https://wa.me/2348000000000?text=Hi%20there');
    expect(env.legalReviewed).toBe(true);
    const typed = Biz.makeBusiness({ whatsapp: '2348031234567', email: 'x@y.ng' }, { NEXT_PUBLIC_WHATSAPP: '2348000000000', NEXT_PUBLIC_SUPPORT_EMAIL: 'a@b.ng' } as any);
    expect(typed.whatsapp).toBe('2348031234567');
    expect(typed.email).toBe('x@y.ng');
  });

  it('saves, and the form shows only what was typed', async () => {
    const r = await Biz.saveBusiness({ whatsapp: '0803 123 4567', address: '12 Allen Avenue, Ikeja', hours: 'Mon to Fri, 9 to 5' });
    expect(r.ok).toBe(true);
    const b = await Biz.getBusiness();
    expect(b.whatsapp).toBe('2348031234567');
    expect(b.address).toBe('12 Allen Avenue, Ikeja');
    const f = await Biz.businessForm();
    expect(f.phone).toBe('');
    expect(await Biz.saveBusiness({ email: 'nope' })).toMatchObject({ ok: false });
    expect((await Biz.getBusiness()).address).toBe('12 Allen Avenue, Ikeja'); // a refused save changes nothing
  });
});

/* ---------------------------------------------------------------- customers */
describe('customers in the console', () => {
  const mk = async (o: { name: string; phone: string; email?: string; type?: string; optIn?: boolean; spend?: number[] }) => {
    const c = await db.one<any>("insert into customers (phone, name, email, account_type, marketing_opt_in) values ($1,$2,$3,$4,$5) returning id", [o.phone, o.name, o.email ?? null, o.type ?? 'personal', !!o.optIn]);
    for (const k of o.spend ?? []) await db.query("insert into orders (code, customer_id, status, total_kobo, paid_at, public_token) values ($1,$2,'paid',$3, now(), md5(random()::text))", [`BR-C${uniq()}`, c.id, k]);
    return c.id as string;
  };
  let ids: Record<string, string> = {};
  beforeAll(async () => {
    ids.once = await mk({ name: 'Once Buyer', phone: '+2348031110001', spend: [100_000] });
    ids.twice = await mk({ name: 'Twice Buyer', phone: '+2348031110002', email: 'twice@example.com', optIn: true, spend: [200_000, 300_000] });
    ids.biz = await mk({ name: 'Biz Owner', phone: '+2348031110003', type: 'business' });
    ids.formula = await mk({ name: '=HYPERLINK("http://evil.example")', phone: '+2348031110004' });
    ids.comma = await mk({ name: 'Obi, Ada "Boss"', phone: '+2348031110005' });
  });

  it('finds people by the way a phone number is written, and by name', async () => {
    const byPhone = await Cus.listCustomers({ q: '0803 111 0002' });
    expect(byPhone.rows.map((r) => r.id)).toEqual([ids.twice]);
    const byName = await Cus.listCustomers({ q: 'twice buy' });
    expect(byName.total).toBe(1);
    expect((await Cus.listCustomers({ q: '%' })).total).toBe(0); // a lone % is just a letter
  });

  it('filters, counts only paid orders, and sorts by spend', async () => {
    const repeat = await Cus.listCustomers({ filter: 'repeat' });
    expect(repeat.rows.map((r) => r.id)).toContain(ids.twice);
    expect(repeat.rows.map((r) => r.id)).not.toContain(ids.once);
    const twice = repeat.rows.find((r) => r.id === ids.twice)!;
    expect(twice.orders).toBe(2);
    expect(twice.spent_kobo).toBe(500_000);
    expect((await Cus.listCustomers({ filter: 'business' })).rows.map((r) => r.id)).toContain(ids.biz);
    expect((await Cus.listCustomers({ filter: 'agreed' })).rows.map((r) => r.id)).toEqual([ids.twice]);
    const bySpend = await Cus.listCustomers({ sort: 'spent', pageSize: 5 });
    expect(bySpend.rows[0].id).toBe(ids.twice);
    const paged = await Cus.listCustomers({ pageSize: 5, page: 2 });
    expect(paged.page).toBe(2);
    expect(paged.pages).toBeGreaterThanOrEqual(1);
  });

  it('writes a spreadsheet that cannot run a customer\'s name as a formula', async () => {
    const rows = await Cus.exportRows();
    const csv = Cus.customersCsv(rows);
    expect(csv.startsWith('﻿Name,')).toBe(true);
    expect(csv).toContain('\r\n');
    const lines = csv.split('\r\n');
    const formula = lines.find((l) => l.includes('HYPERLINK'))!;
    expect(formula.startsWith(`"'=HYPERLINK`)).toBe(true); // neutralised with a leading apostrophe, and quoted for its quote marks
    expect(formula).toContain(',+2348031110004,'); // a phone number is left as it is
    expect(Cus.customersCsv([{ ...rows[0], name: '+cmd|calc!A0' }])).toContain("'+cmd|calc!A0");
    expect(csv).toContain('"Obi, Ada ""Boss"""');
    const twice = lines.find((l) => l.includes('Twice Buyer'))!;
    expect(twice).toContain(',5000.00,');
    expect(twice.endsWith(',yes')).toBe(true);
  });

  it('shows a customer in full, keeps notes, and refuses a bad id', async () => {
    expect(await Cus.customerDetail('not-an-id')).toBeNull();
    const d = (await Cus.customerDetail(ids.twice))!;
    expect(d.stats).toMatchObject({ orders: 2, spent_kobo: 500_000, average_kobo: 250_000 });
    expect(d.orders).toHaveLength(2);
    expect(await Cus.addNote(ids.twice, { id: adminId, name: 'Boss' }, ' ')).toMatchObject({ ok: false });
    expect(await Cus.addNote('00000000-0000-0000-0000-000000000000', { name: 'Boss' }, 'hello there')).toMatchObject({ ok: false });
    expect(await Cus.addNote(ids.twice, { id: adminId, name: 'Boss' }, 'Prefers   WhatsApp\r\n\r\n\r\n\r\nafter 5pm')).toEqual({ ok: true });
    const withNote = (await Cus.customerDetail(ids.twice))!;
    expect(withNote.notes[0].body).toBe('Prefers WhatsApp\n\nafter 5pm');
    await Cus.deleteNote(withNote.notes[0].id, { id: adminId, name: 'Boss' });
    expect((await Cus.customerDetail(ids.twice))!.notes).toHaveLength(0);
    const trail = await A.recentAudit({ q: 'note' });
    expect(trail.rows.some((r) => r.area === 'customer')).toBe(true);
  });
});

/* ---------------------------------------------------------------- payments and refunds */
describe('refunds in the console', () => {
  const pay = async (totalKobo: number, status = 'success') => {
    const c = await db.one<any>("insert into customers (phone, name) values ($1,'Refund Test') returning id", [`+23480${Math.floor(10000000 + Math.random() * 89999999)}`]);
    const o = await db.one<any>("insert into orders (code, customer_id, status, total_kobo, public_token, paid_at) values ($1,$2,'paid',$3, md5(random()::text), now()) returning *", [`BR-R${uniq()}`, c.id, totalKobo]);
    const p = await db.one<any>("insert into payments (order_id, provider_ref, amount_kobo, status, method) values ($1,$2,$3,$4,'card') returning *", [o.id, `ref-${uniq()}`, totalKobo, status]);
    return { o, p };
  };
  const refunded = async (orderId: string) => (await db.one<any>("select coalesce(-sum(amount_kobo),0)::int as n from payments where order_id = $1 and status = 'refund'", [orderId])).n;

  it('asks for a reason, a note when the reason is "something else", and an amount', async () => {
    const { p } = await pay(100_000);
    const admin = staffOf('admin', adminId);
    expect(await PA.consoleRefund(admin, { paymentId: p.id, amountKobo: 1000, reason: '' })).toMatchObject({ ok: false });
    expect(await PA.consoleRefund(admin, { paymentId: p.id, amountKobo: 1000, reason: 'other', note: 'x' })).toMatchObject({ ok: false, error: expect.stringMatching(/reason is/) });
    expect(await PA.consoleRefund(admin, { paymentId: p.id, amountKobo: 0, reason: 'duplicate' })).toMatchObject({ ok: false });
    expect(await PA.consoleRefund(admin, { paymentId: p.id, amountKobo: 10.5, reason: 'duplicate' })).toMatchObject({ ok: false });
  });

  it('only a production lead or an admin can send one', async () => {
    const { p, o } = await pay(100_000);
    expect(await PA.consoleRefund(staffOf('support', adminId), { paymentId: p.id, amountKobo: 1000, reason: 'duplicate' })).toMatchObject({ ok: false, error: expect.stringMatching(/Only a production lead/) });
    expect(await refunded(o.id)).toBe(0);
  });

  it('caps a production lead at the reprint limit; an admin can go above it, but never above what is left', async () => {
    const { p, o } = await pay(9_000_000);
    const lead = staffOf('production_lead', leadId);
    const admin = staffOf('admin', adminId);
    expect(await PA.consoleRefund(lead, { paymentId: p.id, amountKobo: 6_000_000, reason: 'quality' })).toMatchObject({ ok: false, error: expect.stringMatching(/Ask an admin/) });
    expect(await PA.consoleRefund(lead, { paymentId: p.id, amountKobo: 2_000_000, reason: 'quality' })).toMatchObject({ ok: true });
    expect(await PA.consoleRefund(admin, { paymentId: p.id, amountKobo: 8_000_000, reason: 'quality' })).toMatchObject({ ok: false, error: expect.stringMatching(/left to refund/) });
    expect(await PA.consoleRefund(admin, { paymentId: p.id, amountKobo: 7_000_000, reason: 'quality' })).toMatchObject({ ok: true, message: expect.stringContaining('marked refunded') });
    expect(await refunded(o.id)).toBe(9_000_000);
    expect((await db.one<any>('select status from orders where id = $1', [o.id])).status).toBe('refunded');
    expect(await PA.consoleRefund(admin, { paymentId: p.id, amountKobo: 1000, reason: 'quality' })).toMatchObject({ ok: false, error: expect.stringMatching(/already been refunded/) });
  });

  it('a part refund keeps the order going, tells the customer, and writes the record', async () => {
    const { p, o } = await pay(500_000);
    const r = await PA.consoleRefund(staffOf('admin', adminId), { paymentId: p.id, amountKobo: 100_000, reason: 'late', note: 'Two days late' });
    expect(r).toMatchObject({ ok: true });
    expect((await db.one<any>('select status from orders where id = $1', [o.id])).status).toBe('paid');
    const row = await db.one<any>("select * from payments where order_id = $1 and status = 'refund'", [o.id]);
    expect(row.refund_reason).toBe('We were late: Two days late');
    expect(row.staff_id).toBe(adminId);
    expect(row.raw.refund_of).toBe(p.provider_ref);
    expect((await db.one<any>("select count(*)::int as n from messages where order_id = $1 and template = 'refund_issued'", [o.id])).n).toBe(1);
    expect((await A.recentAudit({ area: 'refund', q: o.code })).rows).toHaveLength(1);
  });

  it('two people pressing Refund at once send one refund, not two', async () => {
    const { p, o } = await pay(400_000);
    const admin = staffOf('admin', adminId);
    const results = await Promise.all([
      PA.consoleRefund(admin, { paymentId: p.id, amountKobo: 400_000, reason: 'duplicate' }),
      PA.consoleRefund(admin, { paymentId: p.id, amountKobo: 400_000, reason: 'duplicate' }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await refunded(o.id)).toBe(400_000);
  });

  it('only money Paystack collected can be refunded; a wrong-amount payment refunds what was really taken', async () => {
    const { p: pending } = await pay(100_000, 'pending');
    expect(await PA.consoleRefund(staffOf('admin', adminId), { paymentId: pending.id, amountKobo: 1000, reason: 'duplicate' })).toMatchObject({ ok: false, error: expect.stringMatching(/collected/) });
    expect(PA.collectedKobo({ status: 'success', amount_kobo: 5000, raw: null })).toBe(5000);
    expect(PA.collectedKobo({ status: 'amount_mismatch', amount_kobo: 5000, raw: { amount: 7000 } })).toBe(7000);
    expect(PA.collectedKobo({ status: 'amount_mismatch', amount_kobo: 5000, raw: {} })).toBeNull();
    expect(PA.collectedKobo({ status: 'pending', amount_kobo: 5000, raw: null })).toBeNull();
    const { p: odd } = await pay(100_000, 'amount_mismatch');
    await db.query("update payments set raw = '{\"amount\": 150000}' where id = $1", [odd.id]);
    expect(await PA.consoleRefund(staffOf('admin', adminId), { paymentId: odd.id, amountKobo: 150_000, reason: 'duplicate' })).toMatchObject({ ok: true });
  });

  it('lists payments by what needs a look, finds by order code, and counts', async () => {
    const { o } = await pay(123_000, 'review');
    const attention = await PA.listPayments({ filter: 'attention' });
    expect(attention.rows.some((r) => r.order_id === o.id)).toBe(true);
    expect(attention.rows.every((r) => ['review', 'amount_mismatch'].includes(r.status))).toBe(true);
    expect((await PA.listPayments({ filter: 'all', q: o.code })).rows).toHaveLength(1);
    const paid = await PA.listPayments({ filter: 'paid', size: 5 });
    expect(paid.rows.length).toBeLessThanOrEqual(5);
    const counts = (await PA.paymentCounts())!;
    expect(counts.attention).toBeGreaterThan(0);
    expect(counts.paid_30d).toBeGreaterThan(0);
  });
});

/* ---------------------------------------------------------------- team PIN reset */
describe('staff PIN reset', () => {
  const ipOf = () => `10.0.${seq++ % 250}.${Math.floor(Math.random() * 250)}`;
  const pinOf = async (email: string) => (await db.one<any>('select pin_hash from staff where lower(email) = $1', [email]))!.pin_hash as string;

  it('gives the same answer for an email nobody uses, and no code', async () => {
    const r = await SR.issueStaffReset('nobody@nowhere.test', ipOf());
    expect(r).toEqual({ ok: true });
    expect(await SR.issueStaffReset('not an email', ipOf())).toMatchObject({ ok: false });
  });

  it('sets a new PIN with the emailed code, once', async () => {
    const email = 'lead@brandit.test';
    const before = await pinOf(email);
    const issued = await SR.issueStaffReset(email, ipOf());
    expect(issued.ok && issued.demoCode).toMatch(/^\d{6}$/);
    const code = (issued as any).demoCode as string;
    expect(await SR.completeStaffReset(email, code, '482916', '482917')).toMatchObject({ ok: false, field: 'pin' });
    expect(await SR.completeStaffReset(email, code, '123456', '123456')).toMatchObject({ ok: false, field: 'pin' }); // too easy
    expect(await SR.completeStaffReset(email, code, '482916', '482916')).toEqual({ ok: true });
    const after = await pinOf(email);
    expect(after).not.toBe(before);
    expect(Pw.checkPin('482916', after)).toBe(true);
    expect(await SR.completeStaffReset(email, code, '739150', '739150')).toMatchObject({ ok: false, field: 'code' }); // the code works once
    expect((await A.recentAudit({ area: 'security', q: email })).rows.map((r) => r.action)).toEqual(expect.arrayContaining(['pin_reset', 'pin_reset_requested']));
  });

  it('locks after five wrong tries, even for the right code', async () => {
    const email = 'files@brandit.test';
    const code = ((await SR.issueStaffReset(email, ipOf())) as any).demoCode as string;
    const wrong = code === '111111' ? '222222' : '111111';
    for (let i = 0; i < 5; i++) expect(await SR.completeStaffReset(email, wrong, '482916', '482916')).toMatchObject({ ok: false, error: expect.stringMatching(/not right/) });
    expect(await SR.completeStaffReset(email, code, '482916', '482916')).toMatchObject({ ok: false, error: expect.stringMatching(/Too many/) });
  });

  it('refuses an expired code', async () => {
    const email = 'support@brandit.test';
    const code = ((await SR.issueStaffReset(email, ipOf())) as any).demoCode as string;
    await db.query("update staff_reset_codes set expires_at = now() - interval '1 minute' where staff_id = (select id from staff where lower(email) = $1)", [email]);
    expect(await SR.completeStaffReset(email, code, '482916', '482916')).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
  });
});

/* ---------------------------------------------------------------- policy pages */
describe('policy pages', () => {
  const who = { id: null, name: 'Content Person' };
  const body = 'This is our own version of the page, written by the team after a lawyer read it. It is long enough to publish.';

  it('validates, saves, keeps every version, and can go back', async () => {
    expect(CP.isPolicySlug('terms')).toBe(true);
    expect(CP.isPolicySlug('../etc/passwd')).toBe(false);
    expect(await CP.savePage(who, 'terms', { title: 'T', body })).toMatchObject({ ok: false });
    expect(await CP.savePage(who, 'terms', { title: 'Terms', body: 'too short' })).toMatchObject({ ok: false });
    expect(await CP.savePage(who, 'terms', { title: 'Terms', body: 'x'.repeat(CP.MAX_BODY + 1) })).toMatchObject({ ok: false });
    expect(await CP.pageOverride('terms')).toBeNull();
    expect(await CP.savePage(who, 'terms', { title: 'Terms v1', body, note: 'First' })).toEqual({ ok: true });
    expect(await CP.savePage(who, 'terms', { title: 'Terms v2', body: `${body} Changed.`, note: 'Second' })).toEqual({ ok: true });
    expect((await CP.pageOverride('terms'))!.title).toBe('Terms v2');
    const versions = await CP.pageVersions('terms');
    expect(versions.map((v) => v.title)).toEqual(['Terms v2', 'Terms v1']);
    expect(await CP.restoreVersion(who, 'terms', versions[1].id)).toEqual({ ok: true });
    expect((await CP.pageOverride('terms'))!.title).toBe('Terms v1');
    expect(await CP.restoreVersion(who, 'privacy', versions[0].id)).toMatchObject({ ok: false }); // a version of another page
    await CP.revertPage(who, 'terms');
    expect(await CP.pageOverride('terms')).toBeNull();
    expect((await CP.pageVersions('terms')).length).toBeGreaterThanOrEqual(3); // history stays
  });

  it('fills in the contact details, and leaves a gap rather than inventing one', () => {
    const b = Biz.makeBusiness({ whatsapp: '2348031234567', hours: 'Mon to Sat' }, {} as any);
    const out = CP.fillPlaceholders('Chat {{whatsapp}} or {{ email }} ({{hours}}), reply in {{reply_within}}. {{unknown}}', b);
    expect(out).toContain('+2348031234567');
    expect(out).toContain('or  (Mon to Sat)');
    expect(out).toContain('{{unknown}}');
  });
});

/* ---------------------------------------------------------------- questions and answers */
describe('questions and answers', () => {
  it('lays the team\'s edits over the built-in answers', async () => {
    const { getSettings } = await import('../lib/settings');
    const groups = FAQ.builtInFaq(await getSettings(), await Biz.getBusiness());
    expect(groups.length).toBeGreaterThan(2);
    const g0 = groups[0];
    const first = g0.items[0];
    const second = g0.items[1];
    const rows = [
      { id: 'r1', key: FAQ.faqKey(first.q), group_id: g0.id, question: '', answer: '', hidden: true, position: 0 },
      { id: 'r2', key: FAQ.faqKey(second.q), group_id: g0.id, question: '', answer: 'Our own words.', hidden: false, position: 1 },
      { id: 'r3', key: null, group_id: g0.id, question: 'Do you print on mugs?', answer: 'Not yet.', hidden: false, position: 2 },
      { id: 'r4', key: null, group_id: 'no-such-group', question: 'Orphan question?', answer: 'Goes to the first group.', hidden: false, position: 3 },
      { id: 'r5', key: null, group_id: g0.id, question: 'Hidden one?', answer: 'x', hidden: true, position: 4 },
    ];
    const shown = FAQ.applyFaqEdits(groups, rows);
    const qs = shown[0].items.map((i) => i.q);
    expect(qs).not.toContain(first.q);
    expect(shown[0].items.find((i) => i.q === second.q)!.a).toBe('Our own words.');
    expect(qs).toContain('Do you print on mugs?');
    expect(qs).toContain('Orphan question?');
    expect(qs).not.toContain('Hidden one?');
    expect(groups[0].items[0].q).toBe(first.q); // the built-in list itself is not changed
    const editor = FAQ.editableFaq(groups, rows);
    const e1 = editor.find((i) => i.key === FAQ.faqKey(first.q))!;
    expect(e1).toMatchObject({ hidden: true, custom: false, builtInAnswer: first.a });
    expect(editor.find((i) => i.key === FAQ.faqKey(second.q))).toMatchObject({ edited: true, a: 'Our own words.' });
    expect(editor.filter((i) => i.custom)).toHaveLength(3);
  });

  it('makes the same key for the same question however it is typed', () => {
    expect(FAQ.faqKey('How long does it take?')).toBe('how-long-does-it-take');
    expect(FAQ.faqKey('  HOW long does it TAKE ?? ')).toBe('how-long-does-it-take');
  });
});

/* ---------------------------------------------------------------- homepage words */
describe('homepage words', () => {
  it('uses the built-in wording for anything junk or blank', () => {
    expect(HC.mergeHome(null)).toEqual(HC.HOME_DEFAULT);
    expect(HC.mergeHome({ headline: 5, featured: 'x', announce: 'y', founding: { limit: -4 } })).toEqual({ ...HC.HOME_DEFAULT, founding: { on: false, limit: 100, perk: '' } });
    expect(HC.mergeHome({ featured: ['a', 1, 'b'] }).featured).toEqual(['a', 'b']);
  });

  it('allows only our own pages or https links in the announcement bar', () => {
    expect(HC.safeLink('')).toBe('');
    expect(HC.safeLink('/products?c=Cards')).toBe('/products?c=Cards');
    expect(HC.safeLink('https://thebrandit.ng/x')).toBe('https://thebrandit.ng/x');
    for (const bad of ['//evil.example', 'javascript:alert(1)', 'http://thebrandit.ng', 'data:text/html,hi', 'products']) expect(HC.safeLink(bad)).toBeNull();
  });

  it('checks what is typed, drops products that are not on sale, and saves', async () => {
    const base = { headline: '  Print   that works  ', subline: '', announce_on: false, announce_text: '', announce_link: '', featured: [], founding_on: false, founding_limit: '100', founding_perk: '' };
    expect(await HC.saveHome({ ...base, announce_on: true })).toMatchObject({ ok: false, field: 'announce_text' });
    expect(await HC.saveHome({ ...base, announce_on: true, announce_text: 'Sale', announce_link: 'javascript:x' })).toMatchObject({ ok: false, field: 'announce_link' });
    expect(await HC.saveHome({ ...base, founding_on: true, founding_limit: '3' })).toMatchObject({ ok: false, field: 'founding_limit' });
    const ok = await HC.saveHome({ ...base, headline: 'H'.repeat(100), announce_on: true, announce_text: 'Free delivery in Lagos', announce_link: '/products', featured: ['flyers', 'flyers', 'no-such-product', 'business-cards'], founding_on: true, founding_limit: '250' });
    expect(ok.ok).toBe(true);
    const home = await HC.getHome();
    expect(home.headline).toHaveLength(70);
    expect(home.featured).toEqual(['flyers', 'business-cards']);
    expect(home.announce).toEqual({ on: true, text: 'Free delivery in Lagos', link: '/products' });
    expect(home.founding).toMatchObject({ on: true, limit: 250 });
  });

  it('counts each paying customer once for the Founding counter', async () => {
    const before = await HC.foundingCount();
    const c = await db.one<any>("insert into customers (phone, name) values ('+2348039990001','Founder') returning id");
    for (let i = 0; i < 2; i++) await db.query("insert into orders (code, customer_id, status, total_kobo, public_token) values ($1,$2,'paid',1000, md5(random()::text))", [`BR-F${uniq()}`, c.id]);
    await db.query("insert into orders (code, customer_id, status, total_kobo, public_token) values ($1,$2,'draft',1000, md5(random()::text))", [`BR-F${uniq()}`, c.id]);
    expect(await HC.foundingCount()).toBe(before + 1);
  });
});

/* ---------------------------------------------------------------- stock */
describe('stock on and off', () => {
  let pid = '';
  beforeAll(async () => {
    const opts = [
      { key: 'colour', label: 'Colour', default: 'white', choices: [{ value: 'white', label: 'White' }, { value: 'black', label: 'Black' }, { value: 'red', label: 'Red', unpriced: true }] },
      { key: 'quantity_note', label: 'Notes', choices: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
    ];
    const r = await db.one<any>(
      `insert into products (slug, name, blurb, pricing_mode, options, sizes, check_class, active, sort, description, highlights, category, packages, qty_custom, qty_min, qty_max, allow_custom)
       values ('stock-test-tee','Stock test tee','x','tier',$1,'[]','print',true,999,'',$2,'Tees and Totes','[]',false,1,100,false) returning id`,
      [JSON.stringify(opts), []],
    );
    pid = r.id;
  });
  const who = { get id() { return adminId; }, name: 'Stock Person' };

  it('lists only the choices that are really stock (colour, size, paper), with what is off', async () => {
    const list = await ST.stockList();
    const p = list.find((x) => x.id === pid)!;
    expect(p.options.map((o) => o.key)).toEqual(['colour']);
    expect(p.outCount).toBe(0);
    expect(p.options[0].choices.find((c) => c.value === 'red')).toMatchObject({ inStock: true, waitingForPrice: true });
  });

  it('switches a choice off and on, moves the standard choice, and keeps the record', async () => {
    const off = await ST.setChoiceStock(who, pid, 'colour', 'white', false);
    expect(off).toMatchObject({ ok: true });
    let p = (await ST.stockList()).find((x) => x.id === pid)!;
    expect(p.outCount).toBe(1);
    const stored = (await db.one<any>('select options from products where id = $1', [pid])).options;
    expect(stored[0].default).toBe('black'); // the first choice a customer can still pick
    expect((await ST.setChoiceStock(who, pid, 'colour', 'white', true))).toMatchObject({ ok: true });
    p = (await ST.stockList()).find((x) => x.id === pid)!;
    expect(p.outCount).toBe(0);
    expect((await A.recentAudit({ area: 'catalogue', q: 'Stock test tee' })).rows.map((r) => r.action)).toEqual(expect.arrayContaining(['stock_off', 'stock_on']));
  });

  it('never switches off the last choice a customer can pick', async () => {
    expect(await ST.setChoiceStock(who, pid, 'colour', 'white', false)).toMatchObject({ ok: true });
    // Red is waiting for a price, so black is the only one left that can be chosen.
    expect(await ST.setChoiceStock(who, pid, 'colour', 'black', false)).toMatchObject({ ok: false, error: expect.stringMatching(/at least one choice/) });
    expect(await ST.setChoiceStock(who, pid, 'colour', 'nope', false)).toMatchObject({ ok: false });
    expect(await ST.setChoiceStock(who, '00000000-0000-0000-0000-000000000000', 'colour', 'black', false)).toMatchObject({ ok: false });
  });
});

/* ---------------------------------------------------------------- message catalogue */
describe('message catalogue', () => {
  it('lists every message exactly once, and says when each one is sent', () => {
    const keys = MC.allKeys();
    const grouped = MC.GROUPS.flatMap((g) => g.keys);
    expect([...grouped].sort()).toEqual([...keys].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const k of keys) expect(MC.WHEN[k], `${k} has no "when it is sent" line`).toBeTruthy();
  });

  it('previews every message in both languages with no blank or unfilled values', () => {
    for (const k of MC.allKeys()) {
      for (const lang of ['en', 'pcm'] as const) {
        const text = MC.preview(k, lang);
        expect(text.length, `${k}/${lang}`).toBeGreaterThan(10);
        expect(text, `${k}/${lang}`).not.toMatch(/undefined|\{\{|\$\{|\bnull\b/);
      }
    }
  });

  it('keeps staff messages in English and marks them as staff messages', () => {
    for (const k of Msg.STAFF_TEMPLATES) {
      expect(MC.isStaffTemplate(k)).toBe(true);
      expect(MC.preview(k, 'pcm')).toBe(MC.preview(k, 'en'));
    }
    expect(MC.isStaffTemplate('paid')).toBe(false);
  });
});
