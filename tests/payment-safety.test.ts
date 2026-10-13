import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

process.env.PGLITE_DIR = 'memory';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';

let pay: typeof import('../lib/payments');
let db: typeof import('../lib/db');
beforeAll(async () => { pay = await import('../lib/payments'); db = await import('../lib/db'); await db.ready(); });
afterEach(() => { process.env.DEMO_MODE = 'true'; delete process.env.PAYSTACK_SECRET_KEY; vi.unstubAllGlobals(); });

const fakeOrder = async () => {
  const c = await db.one<any>("insert into customers (phone, name) values ($1,'Pay Test') returning id", [`+23480${Math.floor(10000000 + Math.random() * 89999999)}`]);
  const o = await db.one<any>("insert into orders (code, customer_id, status, total_kobo, public_token) values ('BR-9' || floor(random()*9000+1000)::int, $1, 'awaiting_payment', 150000, md5(random()::text)) returning *", [c.id]);
  return o;
};

describe('a live site can never hand out free orders', () => {
  it('has no pretend payment page in live mode, with or without Paystack', () => {
    process.env.DEMO_MODE = 'false';
    expect(pay.demoPayments()).toBe(false);
    process.env.PAYSTACK_SECRET_KEY = 'sk_live_x';
    expect(pay.demoPayments()).toBe(false);
  });
  it('has the pretend page only in demo mode, and only without a Paystack key', () => {
    process.env.DEMO_MODE = 'true';
    expect(pay.demoPayments()).toBe(true);
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
    expect(pay.demoPayments()).toBe(false);
  });
  it('refuses to start a payment in live mode with no Paystack key, and leaves no payment behind', async () => {
    process.env.DEMO_MODE = 'false';
    const o = await fakeOrder();
    await expect(pay.initPayment(o, 'a@b.com')).rejects.toBeInstanceOf(pay.PaymentsNotConfiguredError);
    const n = await db.one<any>('select count(*)::int as n from payments where order_id = $1', [o.id]);
    expect(n.n).toBe(0);
  });
  it('sends a demo customer to the pretend page, and a Paystack customer to Paystack', async () => {
    process.env.DEMO_MODE = 'true';
    const o = await fakeOrder();
    expect((await pay.initPayment(o, 'a@b.com')).url).toMatch(/^\/pay\//);
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: { authorization_url: 'https://checkout.paystack.com/abc' } }) })));
    expect((await pay.initPayment(o, 'a@b.com')).url).toBe('https://checkout.paystack.com/abc');
  });
  it('never records a refund that was not sent', async () => {
    process.env.DEMO_MODE = 'false';
    const o = await fakeOrder();
    await db.query("insert into payments (order_id, provider_ref, amount_kobo, status) values ($1,'ref-ok-1',150000,'success')", [o.id]);
    const r = await pay.refundPayment(o.id, 50000, 'k1');
    expect(r.ok).toBe(false);
    expect((await db.one<any>("select count(*)::int as n from payments where order_id = $1 and status = 'refund'", [o.id])).n).toBe(0);
  });
  it('rejects a webhook with no secret configured, and a wrong signature', () => {
    expect(pay.verifyPaystackSignature('{}', 'abcd', '')).toBe(false);
    expect(pay.verifyPaystackSignature('{}', 'abcd', 'sk')).toBe(false);
    expect(pay.verifyPaystackSignature('{}', null, 'sk')).toBe(false);
  });
});
