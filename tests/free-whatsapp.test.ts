import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';

process.env.PGLITE_DIR = 'memory';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-freewa-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.NEXT_PUBLIC_APP_URL = 'https://brandit.test';
delete process.env.SMS_API_KEY;
delete process.env.WHATSAPP_ACCESS_TOKEN;
delete process.env.WHATSAPP_PHONE_NUMBER_ID;

let db: typeof import('../lib/db');
let messages: typeof import('../lib/messages');
let outbox: typeof import('../lib/outbox');
let ta: typeof import('../lib/teamAlerts');

beforeAll(async () => {
  db = await import('../lib/db');
  messages = await import('../lib/messages');
  outbox = await import('../lib/outbox');
  ta = await import('../lib/teamAlerts');
  await db.ready();
});
afterEach(async () => {
  for (const k of ['RESEND_API_KEY', 'EMAIL_FROM', 'SMS_API_KEY', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID']) delete process.env[k];
  vi.unstubAllGlobals();
  await db.query("delete from messages where audience = 'customer'");
});

const mailOn = () => { process.env.RESEND_API_KEY = 're_x'; process.env.EMAIL_FROM = 'Brandit <hello@thebrandit.ng>'; };
const stub = (answer: (u: string) => Response = () => new Response('{}', { status: 200 })) => {
  const f = vi.fn(async (u: string, _init?: unknown) => answer(String(u)));
  vi.stubGlobal('fetch', f);
  return { f, to: (needle: string) => f.mock.calls.filter((c) => String(c[0]).includes(needle)).map((c) => JSON.parse((c[1] as any).body)) };
};

async function customer(opts: { email?: string | null; phone?: string | null } = {}) {
  const phone = opts.phone === undefined ? `+23480${Math.floor(10000000 + Math.random() * 89999999)}` : opts.phone;
  const c = (await db.one<any>("insert into customers (phone, name, email) values ($1,'Ada Obi',$2) returning id", [phone, opts.email ?? null]))!;
  const o = (await db.one<any>("insert into orders (code, customer_id, status, total_kobo, public_token, promised_at) values ('BR-8' || floor(random()*9000+1000)::int, $1, 'paid', 1650000, md5(random()::text), now() + interval '1 day') returning id, code", [c.id]))!;
  return { c, o, phone };
}
const send = async (orderId: string, template: string, vars: Record<string, string> = {}) => {
  await db.tx((q) => messages.queueMessage(q, { orderId, template: template as any, vars: { link: 'https://brandit.test/track/abc', code: 'BR-1', arrive_line: 'Arriving tomorrow.', ...vars } }));
  await messages.flushMessages();
  return db.query<any>('select * from messages where order_id = $1 and audience = \'customer\' order by id', [orderId]);
};

describe('links and rules', () => {
  it('builds a WhatsApp link with the number and the message typed', () => {
    const href = outbox.waLink('+234 803 123 4567', 'Hi Ada, your proof is ready: https://x.ng/p?a=1&b=2')!;
    expect(href).toBe(`https://wa.me/2348031234567?text=${encodeURIComponent('Hi Ada, your proof is ready: https://x.ng/p?a=1&b=2')}`);
    expect(outbox.waLink(null, 'hi')).toBeNull();
    expect(outbox.waLink('12', 'hi')).toBeNull();
  });
  it('keeps urgent messages and optional ones apart', () => {
    for (const t of outbox.URGENT) expect(outbox.OPTIONAL.has(t)).toBe(false);
    expect(outbox.outboxWanted('printing', true, true)).toBe(false);   // an email went and nothing needs doing
    expect(outbox.outboxWanted('proof_ready', true, true)).toBe(true); // an email went but the customer must act
    expect(outbox.outboxWanted('printing', true, false)).toBe(true);   // nothing reached them
    expect(outbox.outboxWanted('printing', false, false)).toBe(false); // no number to open WhatsApp with
  });
  it('turns web addresses in an email into links and escapes the rest', () => {
    const m = ta.customerMail({ template: 'proof_ready', body: 'Look <b>here</b>: https://brandit.test/p/1?x=1&y=2. Thanks' });
    expect(m.subject).toBe('Your proof is ready. Please approve it');
    expect(m.html).toContain('&lt;b&gt;');
    expect(m.html).toContain('<a href="https://brandit.test/p/1?x=1&amp;y=2"');
    expect(m.html).not.toContain('y=2."');
  });
});

describe('with no email, no SMS and no Meta account', () => {
  it('leaves the message for a person, and counts it', async () => {
    const t = await customer();
    const rows = await send(t.o.id, 'printing');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'to_send', channel: 'whatsapp_manual' });
    expect(rows[0].sent_at).toBeNull();
    const list = await outbox.outboxList();
    const mine = list.now.find((m) => m.id === rows[0].id)!;
    expect(mine.code).toBe(t.o.code);
    expect(outbox.waLink(mine.to_phone, mine.body)).toContain(`https://wa.me/${t.phone!.replace(/\D/g, '')}?text=`);
    expect(await outbox.outboxCount()).toBeGreaterThanOrEqual(1);
  });
  it('puts reminders and offers in the optional list', async () => {
    const t = await customer();
    const rows = await send(t.o.id, 'reorder_reminder', { name: 'Ada', product: 'Business cards', stop: 'https://brandit.test/stop' });
    const list = await outbox.outboxList();
    expect(list.optional.some((m) => m.id === rows[0].id)).toBe(true);
    expect(list.now.some((m) => m.id === rows[0].id)).toBe(false);
  });
  it('drops a message nobody sent in three days', async () => {
    const t = await customer();
    const rows = await send(t.o.id, 'printing');
    await db.query("update messages set created_at = now() - interval '4 days' where id = $1", [rows[0].id]);
    await messages.flushMessages();
    expect((await db.one<any>('select status from messages where id = $1', [rows[0].id]))!.status).toBe('expired');
  });
  it('fails honestly when there is no number and no email', async () => {
    const t = await customer({ phone: null });
    const rows = await send(t.o.id, 'printing');
    expect(rows[0].status).toBe('failed');
    expect(rows[0].error).toMatch(/no phone number or email/i);
  });
  it('never calls Meta', async () => {
    const s = stub();
    const t = await customer();
    await send(t.o.id, 'proof_ready');
    expect(s.f.mock.calls.filter((c) => String(c[0]).includes('facebook'))).toHaveLength(0);
  });
});

describe('with email set up', () => {
  it('emails a customer who has an email, with a way to reply, and sends no WhatsApp for a plain update', async () => {
    mailOn();
    const s = stub();
    const t = await customer({ email: 'ada@example.com' });
    const rows = await send(t.o.id, 'printing');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'sent', channel: 'email' });
    const mail = s.to('resend')[0];
    expect(mail.to).toEqual(['ada@example.com']);
    expect(mail.subject).toBe('Your order is printing now');
    expect(mail.reply_to).toBe('hello@thebrandit.ng');
    expect(mail.html).toContain('Arriving tomorrow.');
  });
  it('also leaves an urgent message for a person to nudge on WhatsApp', async () => {
    mailOn();
    stub();
    const t = await customer({ email: 'ada@example.com' });
    const rows = await send(t.o.id, 'proof_ready');
    expect(rows.map((r: any) => [r.channel, r.status])).toEqual([['email', 'sent'], ['whatsapp_manual', 'to_send']]);
  });
  it('finds the email from the phone number when a message has no order', async () => {
    mailOn();
    const s = stub();
    const t = await customer({ email: 'phone-only@example.com' });
    await db.tx((q) => messages.queueMessage(q, { toPhone: t.phone, template: 'custom_received', vars: { code: 'CQ-3', hours: '4', link: 'https://brandit.test/c/3' } }));
    await messages.flushMessages();
    expect(s.to('resend').some((b) => b.to[0] === 'phone-only@example.com')).toBe(true);
  });
  it('emails a customer who has no phone at all', async () => {
    mailOn();
    const s = stub();
    const t = await customer({ email: 'nophone@example.com', phone: null });
    const rows = await send(t.o.id, 'printing');
    expect(rows[0]).toMatchObject({ status: 'sent', channel: 'email' });
    expect(s.to('resend')).toHaveLength(1);
  });
  it('falls back to a person with WhatsApp when the email provider fails', async () => {
    mailOn();
    stub(() => new Response('down', { status: 503 }));
    const t = await customer({ email: 'ada@example.com' });
    const rows = await send(t.o.id, 'printing');
    expect(rows[0]).toMatchObject({ status: 'to_send', channel: 'whatsapp_manual' });
    expect(rows[0].error).toMatch(/Email failed: Email 503/);
  });
  it('sends a customer without an email to the list', async () => {
    mailOn();
    stub();
    const t = await customer({ email: null });
    const rows = await send(t.o.id, 'printing');
    expect(rows[0].status).toBe('to_send');
  });
});

describe('with SMS but no email', () => {
  it('texts the customer, and still lists urgent ones', async () => {
    process.env.SMS_API_KEY = 'k';
    const s = stub();
    const t = await customer();
    const plain = await send(t.o.id, 'printing');
    expect(plain[0]).toMatchObject({ status: 'sent', channel: 'sms' });
    const urgent = await send(t.o.id, 'file_problem', { issue: 'Too small.' });
    expect(urgent.filter((r: any) => r.template === 'file_problem').map((r: any) => r.channel)).toEqual(['sms', 'whatsapp_manual']);
    expect(s.to('termii').length).toBeGreaterThanOrEqual(2);
  });
});

describe('a business that chooses to pay Meta', () => {
  it('still sends through WhatsApp, as before, and lists nothing', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'x'; process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
    const s = stub();
    const t = await customer({ email: 'ada@example.com' });
    const rows = await send(t.o.id, 'proof_ready');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'sent', channel: 'whatsapp' });
    expect(s.to('facebook')).toHaveLength(1);
  });
});

describe('staff messages to the owner phone', () => {
  it('are logged, not put in the customer list, when nothing automatic is set up', async () => {
    await db.tx((q) => messages.queueMessage(q, { toPhone: '2348039999999', template: 'site_alert', vars: { what: 'Test.' } }));
    await messages.flushMessages();
    const row = await db.one<any>("select * from messages where template = 'site_alert' order by id desc limit 1");
    expect(row.status).toBe('logged');
    expect(row.channel).toBe('demo');
  });
});
