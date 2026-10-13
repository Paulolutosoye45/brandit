import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

process.env.PGLITE_DIR = 'memory';
let db: typeof import('../lib/db');
let rc: typeof import('../lib/receipts');
beforeAll(async () => { db = await import('../lib/db'); rc = await import('../lib/receipts'); await db.ready(); });
afterEach(() => { delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM; vi.unstubAllGlobals(); });

async function paidOrder(email: string | null) {
  const c = (await db.one<any>("insert into customers (phone, name, email) values ($1,'Ada Obi',$2) returning id", [`+23480${Math.floor(10000000 + Math.random() * 89999999)}`, email]))!;
  const o = (await db.one<any>("insert into orders (code, customer_id, status, total_kobo, public_token, promised_at) values ('BR-7' || floor(random()*9000+1000)::int, $1, 'paid', 1650000, md5(random()::text), now() + interval '1 day') returning id, code", [c.id]))!;
  const prod = (await db.one<any>("select id from products where slug = 'business-cards'"))!;
  await db.query("insert into order_items (order_id, product_id, quantity, line_total_kobo, config) values ($1,$2,100,1500000,'{}')", [o.id, prod.id]);
  return o;
}

describe('email receipts', () => {
  it('does nothing when email is not set up', async () => {
    const o = await paidOrder('a@b.com');
    expect(await rc.sendReceiptEmail(o.id)).toBe('skipped');
  });
  it('sends the customer a receipt with their order and links', async () => {
    process.env.RESEND_API_KEY = 're_x'; process.env.EMAIL_FROM = 'Brandit <hello@brandit.ng>';
    const f = vi.fn(async () => ({ ok: true, text: async () => '' }));
    vi.stubGlobal('fetch', f);
    const o = await paidOrder('ada@example.com');
    expect(await rc.sendReceiptEmail(o.id)).toBe('sent');
    const body = JSON.parse((f.mock.calls[0] as any)[1].body);
    expect(body.to).toEqual(['ada@example.com']);
    expect(body.subject).toBe(`Paid: order ${o.code}`);
    expect(body.text).toContain('100 x Business cards');
    expect(body.text).toContain('₦16,500');
    expect(body.html).toContain('/invoice/');
  });
  it('skips a customer with no email', async () => {
    process.env.RESEND_API_KEY = 're_x'; process.env.EMAIL_FROM = 'x@y.ng';
    vi.stubGlobal('fetch', vi.fn());
    const o = await paidOrder(null);
    expect(await rc.sendReceiptEmail(o.id)).toBe('skipped');
  });
});
