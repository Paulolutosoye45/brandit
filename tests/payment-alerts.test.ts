import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

process.env.PGLITE_DIR = 'memory';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.DEMO_MODE = 'false';

const SECRET = 'sk_test_webhooksecret';
let db: typeof import('../lib/db');
let route: typeof import('../app/api/webhooks/paystack/route');
let alerts: typeof import('../lib/siteAlert');
let sent: { url: string; body: any }[] = [];

beforeAll(async () => {
  db = await import('../lib/db');
  route = await import('../app/api/webhooks/paystack/route');
  alerts = await import('../lib/siteAlert');
  await db.ready();
});
beforeEach(() => {
  sent = [];
  process.env.PAYSTACK_SECRET_KEY = SECRET;
  process.env.ALERT_PHONE = '2348031234567';
  process.env.SMS_API_KEY = 'sms-key';
  alerts.resetSiteAlertMemory();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    let body: any = init?.body;
    try { body = JSON.parse(init.body); } catch { /* not JSON */ }
    sent.push({ url: String(url), body });
    return new Response('{}', { status: 200 });
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete process.env.PAYSTACK_SECRET_KEY; delete process.env.ALERT_PHONE; delete process.env.SMS_API_KEY; });

const hook = (event: unknown, sign = true) => {
  const raw = JSON.stringify(event);
  const sig = sign ? createHmac('sha512', SECRET).update(raw).digest('hex') : 'deadbeef';
  return new Request('http://x/api/webhooks/paystack', { method: 'POST', body: raw, headers: { 'x-paystack-signature': sig } });
};
const texts = () => sent.filter((s) => s.url.includes('termii')).map((s) => s.body.sms as string);

const awaitingOrder = async (total = 150000) => {
  const c = await db.one<any>("insert into customers (phone, name) values ($1,'Alert Test') returning id", [`+23480${Math.floor(10000000 + Math.random() * 89999999)}`]);
  return db.one<any>("insert into orders (code, customer_id, status, total_kobo, public_token) values ('BR-8' || floor(random()*9000+1000)::int, $1, 'awaiting_payment', $2, md5(random()::text)) returning *", [c.id, total]);
};

describe('the Paystack webhook tells the owner when it cannot apply a payment', () => {
  it('alerts for a payment under a reference we do not know', async () => {
    const r = await route.POST(hook({ event: 'charge.success', data: { reference: 'BR-0000-unknown1', amount: 50000, channel: 'card' } }));
    expect(r.status).toBe(200);
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toContain('BR-0000-unknown1');
    expect(texts()[0]).toContain('we have no order with this payment reference');
  });

  it('alerts when the amount paid is not the amount of the order, and leaves the order unpaid', async () => {
    const o = await awaitingOrder(150000);
    await db.query("insert into payments (order_id, provider_ref, amount_kobo, status) values ($1, $2, 150000, 'pending')", [o.id, `${o.code}-mismatch`]);
    await route.POST(hook({ event: 'charge.success', data: { reference: `${o.code}-mismatch`, amount: 100, channel: 'card' } }));
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toContain('the amount paid is not the amount of the order');
    expect((await db.one<any>('select status from orders where id = $1', [o.id]))!.status).toBe('awaiting_payment');
  });

  it('sends one message even if Paystack repeats the notice', async () => {
    const evt = { event: 'charge.success', data: { reference: 'BR-0000-repeat', amount: 1, channel: 'card' } };
    await route.POST(hook(evt));
    await route.POST(hook(evt));
    await route.POST(hook(evt));
    expect(texts()).toHaveLength(1);
  });

  it('says nothing about a payment that was applied normally', async () => {
    const o = await awaitingOrder(150000);
    await db.query("insert into payments (order_id, provider_ref, amount_kobo, status) values ($1, $2, 150000, 'success')", [o.id, `${o.code}-already`]);
    const r = await route.POST(hook({ event: 'charge.success', data: { reference: `${o.code}-already`, amount: 150000, channel: 'card' } }));
    expect(r.status).toBe(200);
    expect(texts()).toHaveLength(0);
  });

  it('does not page anyone for a forged or unsigned request', async () => {
    const r = await route.POST(hook({ event: 'charge.success', data: { reference: 'BR-1-forged', amount: 1 } }, false));
    expect(r.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it('ignores other Paystack events', async () => {
    await route.POST(hook({ event: 'transfer.success', data: { reference: 'x' } }));
    expect(sent).toHaveLength(0);
  });
});
