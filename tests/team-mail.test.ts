import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';

process.env.PGLITE_DIR = 'memory';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-teammail-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.NEXT_PUBLIC_APP_URL = 'https://brandit.test';
delete process.env.PAYSTACK_SECRET_KEY;
delete process.env.SMS_API_KEY;
delete process.env.ALERT_EMAILS;

let db: typeof import('../lib/db');
let orders: typeof import('../lib/orders');
let payments: typeof import('../lib/payments');
let messages: typeof import('../lib/messages');
let ta: typeof import('../lib/teamAlerts');
let tn: typeof import('../lib/teamNotify');
let biz: typeof import('../lib/business');
let custom: typeof import('../lib/custom');

beforeAll(async () => {
  db = await import('../lib/db');
  orders = await import('../lib/orders');
  payments = await import('../lib/payments');
  messages = await import('../lib/messages');
  ta = await import('../lib/teamAlerts');
  tn = await import('../lib/teamNotify');
  biz = await import('../lib/business');
  custom = await import('../lib/custom');
  await db.ready();
});
afterEach(async () => {
  delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM; delete process.env.ALERT_EMAILS; delete process.env.ALERT_PHONE;
  vi.unstubAllGlobals();
  await db.query("delete from settings where key = 'business'");
  biz.clearBusinessCache();
});

const mailOn = () => { process.env.RESEND_API_KEY = 're_x'; process.env.EMAIL_FROM = 'Brandit <hello@thebrandit.ng>'; };
const resend = (answer: () => Response = () => new Response('{"id":"1"}', { status: 200 })) => {
  const f = vi.fn(async (_u: string, init: any) => { void init; return answer(); });
  vi.stubGlobal('fetch', f);
  return { f, sent: () => f.mock.calls.filter((c) => String(c[0]).includes('resend')).map((c) => JSON.parse((c[1] as any).body)) };
};

async function paidOrder(email = 'buyer@example.com') {
  const d: any = await orders.createDraft({ slug: 'business-cards', quantity: 100, area: 'Yaba' });
  expect(d.error).toBeUndefined();
  await orders.setArtworkPath(d.id, 'design', { purpose: 'test' });
  const c = await orders.saveCheckout(d.id, { name: 'Ada Buyer', phone: '0803 123 4567', email, pickup: false, area: 'Yaba', addressLine: '12 Test Street, Yaba' });
  expect(c).toEqual({ ok: true });
  const o = (await orders.getOrder(d.id))!;
  const p = await payments.initPayment(o, email);
  const r = await orders.confirmPayment({ reference: p.reference, amountKobo: o.total_kobo, method: 'card' });
  expect(r.ok).toBe(true);
  return o;
}

describe('who gets the team email', () => {
  it('splits what was typed, lower-cases it and drops repeats', () => {
    expect(ta.parseEmails('Hello@TheBrandit.ng, sales@thebrandit.ng;  hello@thebrandit.ng\nops@x.ng')).toEqual({ ok: ['hello@thebrandit.ng', 'sales@thebrandit.ng', 'ops@x.ng'], bad: [] });
    expect(ta.parseEmails('hello@thebrandit.ng, nope, a@b').bad).toEqual(['nope', 'a@b']);
  });
  it('uses what was typed, then ALERT_EMAILS, then hello@ and sales@', () => {
    expect(ta.teamEmailsFrom('ops@x.ng', {} as any)).toEqual(['ops@x.ng']);
    expect(ta.teamEmailsFrom('', { ALERT_EMAILS: 'a@x.ng b@x.ng' } as any)).toEqual(['a@x.ng', 'b@x.ng']);
    expect(ta.teamEmailsFrom('', {} as any)).toEqual(['hello@thebrandit.ng', 'sales@thebrandit.ng']);
    expect(ta.teamEmailsFrom('garbage', {} as any)).toEqual(['hello@thebrandit.ng', 'sales@thebrandit.ng']);
  });
  it('is checked and saved in Business details', async () => {
    expect(biz.checkBusiness({ alert_emails: 'Hello@thebrandit.ng, sales@thebrandit.ng' })).toMatchObject({ ok: true, value: { alert_emails: 'hello@thebrandit.ng, sales@thebrandit.ng' } });
    expect(biz.checkBusiness({ alert_emails: 'hello@thebrandit.ng, oops' })).toMatchObject({ ok: false, field: 'alert_emails' });
    expect(biz.checkBusiness({ alert_emails: Array.from({ length: 7 }, (_, i) => `a${i}@x.ng`).join(',') })).toMatchObject({ ok: false, field: 'alert_emails' });
    expect(biz.makeBusiness({}, {} as any).alertEmails).toEqual(['hello@thebrandit.ng', 'sales@thebrandit.ng']);
    expect(biz.makeBusiness({ alert_emails: 'ops@x.ng' }, {} as any).alertEmails).toEqual(['ops@x.ng']);
  });
});

describe('the emails', () => {
  it('builds a paid-order alert with everything a person needs', () => {
    const a = tn.orderPaidAlert({
      code: 'BR-1042', totalKobo: 1_650_000, pickup: false, area: 'Yaba', promisedAt: new Date('2026-11-05T10:00:00Z'), speed: '24h', couponCode: 'WELCOME',
      customer: { name: 'Ada Buyer', phone: '+2348031234567', email: 'ada@example.com' },
      items: [{ name: 'Business cards', quantity: 100, artwork: 'upload' }, { name: 'Flyers', quantity: 500, artwork: 'design' }],
      consoleUrl: 'https://brandit.test/console/orders/BR-1042', now: new Date('2026-11-04T09:00:00Z'),
    });
    expect(a.subject).toBe('New order BR-1042: ₦16,500 · 2 products');
    expect(a.replyTo).toBe('ada@example.com');
    const text = ta.teamText(a);
    expect(text).toContain('Ada Buyer · +2348031234567 · ada@example.com');
    expect(text).toContain('100 x Business cards (customer file)');
    expect(text).toContain('500 x Flyers (Brandit designs it)');
    expect(text).toContain('coupon WELCOME');
    expect(text).toContain('Yaba');
    expect(text).toContain('https://brandit.test/console/orders/BR-1042');
    expect(ta.teamHtml(a)).toContain('Open the order');
  });
  it('escapes anything a customer typed', () => {
    const a = tn.customRequestAlert({ id: 'x', code: 'CQ-1', event: false, title: '<script>alert(1)</script>', name: 'A"B', phone: '0803', email: null, quantityText: null, sizeText: null, budgetKobo: null, needBy: null, files: 0, details: '<b>hi</b>' });
    const html = ta.teamHtml(a);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;');
  });
  it('tells an event plan from a custom request', () => {
    const base = { id: 'i', code: 'CQ-9', title: 'Wedding, 20 Dec', name: 'Bola', phone: '0803', email: 'b@x.ng', quantityText: '4 items', sizeText: null, budgetKobo: 50_000_000, needBy: '2026-12-15', files: 2, details: 'Programme and banner' };
    const ev = tn.customRequestAlert({ ...base, event: true });
    expect(ev.kind).toBe('event_plan');
    expect(ev.subject).toMatch(/^New event plan CQ-9/);
    expect(ta.teamText(ev)).toContain('₦500,000');
    expect(ta.teamText(ev)).toContain('2 attached');
    expect(tn.customRequestAlert({ ...base, event: false }).kind).toBe('custom_request');
  });
});

describe('a paid order emails the team', () => {
  it('sends one email to both Brandit mailboxes, replying to the customer', async () => {
    mailOn();
    const r = resend();
    const o = await paidOrder('ada@example.com');
    const team = r.sent().filter((b) => /^New order/.test(b.subject));
    expect(team).toHaveLength(1);
    expect(team[0].to).toEqual(['hello@thebrandit.ng', 'sales@thebrandit.ng']);
    expect(team[0].reply_to).toBe('ada@example.com');
    expect(team[0].subject).toContain(o.code);
    expect(team[0].text).toContain('100 x Business cards');
    expect(team[0].text).toContain(`https://brandit.test/console/orders/${o.code}`);
    const row = await db.one<any>("select * from messages where audience = 'team' and order_id = $1", [o.id]);
    expect(row.status).toBe('sent');
    expect(row.channel).toBe('email');
    expect(row.to_email).toBe('hello@thebrandit.ng,sales@thebrandit.ng');
  });
  it('uses the addresses typed in Business details', async () => {
    mailOn();
    await biz.saveBusiness({ alert_emails: 'ops@thebrandit.ng' });
    const r = resend();
    await paidOrder();
    expect(r.sent().find((b) => /^New order/.test(b.subject))!.to).toEqual(['ops@thebrandit.ng']);
  });
  it('is only sent once even if Paystack calls twice', async () => {
    mailOn();
    const r = resend();
    const d: any = await orders.createDraft({ slug: 'business-cards', quantity: 100, area: 'Yaba' });
    await orders.setArtworkPath(d.id, 'design', { purpose: 'test' });
    await orders.saveCheckout(d.id, { name: 'Twice', phone: '0803 111 2222', email: 't@example.com', pickup: false, area: 'Yaba', addressLine: '1 Test Street' });
    const o = (await orders.getOrder(d.id))!;
    const p = await payments.initPayment(o, 't@example.com');
    await orders.confirmPayment({ reference: p.reference, amountKobo: o.total_kobo });
    await orders.confirmPayment({ reference: p.reference, amountKobo: o.total_kobo });
    expect(r.sent().filter((b) => /^New order/.test(b.subject))).toHaveLength(1);
  });
  it('never breaks the payment when the email fails, and keeps it to try again', async () => {
    mailOn();
    resend(() => new Response('down', { status: 500 }));
    const o = await paidOrder();
    expect((await orders.getOrder(o.id))!.status).toBe('paid');
    const row = await db.one<any>("select * from messages where audience = 'team' and order_id = $1", [o.id]);
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/Email 500/);
    // "Try again" in Messages puts it back in the queue and sends it.
    await db.query("update messages set status = 'queued', error = null where id = $1", [row.id]);
    const r = resend();
    await messages.flushMessages();
    expect((await db.one<any>('select status from messages where id = $1', [row.id]))!.status).toBe('sent');
    expect(r.sent().filter((b) => /^New order/.test(b.subject))).toHaveLength(1);
  });
  it('is only logged when email is not set up, and the order is unharmed', async () => {
    const o = await paidOrder();
    const row = await db.one<any>("select * from messages where audience = 'team' and order_id = $1", [o.id]);
    expect(row.status).toBe('logged');
    expect(row.body).toContain(o.code);
  });
});

describe('custom requests and event plans', () => {
  it('email the team with what the customer wrote', async () => {
    mailOn();
    const r = resend();
    const made = await custom.createCustomRequest({ name: 'Bola', phone: '08031230001', email: 'bola@example.com', title: 'Branded umbrellas', details: 'Fifty umbrellas with our logo in green.', quantityText: '50' }, []);
    expect(made.ok).toBe(true);
    const all = r.sent();
    expect(all.some((b) => b.to[0] === "bola@example.com" && b.subject === "We have your custom request")).toBe(true);
    const mail = all.find((b) => /^New custom request/.test(b.subject))!;
    expect(mail.to).toEqual(['hello@thebrandit.ng', 'sales@thebrandit.ng']);
    expect(mail.subject).toContain('Branded umbrellas');
    expect(mail.reply_to).toBe('bola@example.com');
    expect(mail.text).toContain('Fifty umbrellas');
    expect(mail.text).toContain('/console/custom/');
  });
  it('also sends the old phone alert when an alert phone is set', async () => {
    process.env.ALERT_PHONE = '2348039999999';
    await custom.createCustomRequest({ name: 'Chi', phone: '08031230002', title: 'Mugs', details: 'One hundred mugs with a photo on them.' }, []);
    const phone = await db.query<any>("select to_phone from messages where template = 'custom_alert' order by id desc limit 1");
    expect(phone[0].to_phone).toBe('2348039999999');
    const team = await db.query<any>("select * from messages where audience = 'team' and template = 'team_custom_request' order by id desc limit 1");
    expect(team[0].body).toContain('Mugs');
  });
});

describe('staff alerts', () => {
  it('email the team as well as the alert phone', async () => {
    mailOn();
    const r = resend();
    const res = await messages.sendStaffNow(null, 'site_alert', { what: 'The database is down.' }, process.env, fetch);
    expect(res).toEqual({ ok: true, channel: 'email' });
    const b = r.sent()[0];
    expect(b.to).toEqual(['hello@thebrandit.ng', 'sales@thebrandit.ng']);
    expect(b.subject).toBe('Brandit site alert');
    expect(b.text).toContain('The database is down.');
  });
  it('queues a late-job warning for the team without any alert phone', async () => {
    await db.tx((q) => messages.queueStaffAlert(q, 'at_risk', { code: 'BR-77', arrive: 'tomorrow', stage: 'Printing' }));
    expect((await db.query("select 1 from messages where template = 'at_risk'")).length).toBe(0);
    const team = await db.one<any>("select * from messages where template = 'team_at_risk' order by id desc limit 1");
    expect(team.body).toContain('BR-77');
  });
});
