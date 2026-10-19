import { beforeAll, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';

process.env.PGLITE_DIR = 'memory';
process.env.DEMO_MODE = 'true';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-sample-${process.pid}`);
delete process.env.PAYSTACK_SECRET_KEY;

let db: typeof import('../lib/db');
let O: typeof import('../lib/orders');
let SP: typeof import('../lib/samplePack');
let Cat: typeof import('../lib/catalog');
let L: typeof import('../lib/lines');
let Pay: typeof import('../lib/payments');
let I: typeof import('../lib/identity');
let J: typeof import('../lib/jobs');
let C: typeof import('../lib/coupons');
let BD: typeof import('../lib/builderData');
let B: typeof import('../lib/basket');

let admin: { id: string; name: string; role: 'admin'; press_id: null };

beforeAll(async () => {
  db = await import('../lib/db');
  await db.ready();
  O = await import('../lib/orders');
  SP = await import('../lib/samplePack');
  Cat = await import('../lib/catalog');
  L = await import('../lib/lines');
  Pay = await import('../lib/payments');
  I = await import('../lib/identity');
  J = await import('../lib/jobs');
  C = await import('../lib/coupons');
  BD = await import('../lib/builderData');
  B = await import('../lib/basket');
  const a = (await db.one<{ id: string }>("select id from staff where role = 'admin' order by id limit 1"))!;
  admin = { id: a.id, name: 'Test admin', role: 'admin', press_id: null };
}, 60_000);

let n = 0;
/** A customer who has bought the sample pack and paid. */
async function paidSample() {
  n++;
  const c = (await I.signInEmail(`sp${n}@example.com`)).customer;
  const d: any = await O.createDraft({ slug: SP.SAMPLE_SLUG, quantity: 1, area: 'Yaba' });
  expect(d.id, JSON.stringify(d)).toBeTruthy();
  await db.query('update orders set customer_id = $2 where id = $1', [d.id, c.id]);
  const ck = await O.saveCheckout(d.id, { name: 'Bisi Ade', phone: `0805${String(2000000 + n).slice(-7)}`, email: c.email ?? '', pickup: false, area: 'Yaba', addressLine: '3 Sample Road, Yaba' }, c.id);
  expect(ck.ok, JSON.stringify(ck)).toBe(true);
  const o = (await O.getOrder(d.id))!;
  const pay = await Pay.initPayment(o, c.email ?? 'a@example.com');
  const r = await O.confirmPayment({ reference: pay.reference, amountKobo: o.total_kobo, method: 'card' });
  expect(r.ok).toBe(true);
  const job = (await db.one<any>('select * from jobs where order_id = $1', [d.id]))!;
  return { c, id: d.id as string, job, order: (await O.getOrder(d.id))! };
}

describe('the sample pack product', () => {
  it('exists, is a sample, and is kept out of the places where products are chosen', async () => {
    const p = await Cat.getProduct(SP.SAMPLE_SLUG);
    expect(p?.sample).toBe(true);
    expect(p?.active).toBe(true); // the demo starts with it on; a live site starts with it off
    expect((await Cat.listProducts()).some((x) => x.slug === SP.SAMPLE_SLUG)).toBe(false);
    expect((await Cat.listCatalog()).some((x) => x.product.slug === SP.SAMPLE_SLUG)).toBe(false);
    expect((await Cat.listCatalog(false, true)).some((x) => x.product.slug === SP.SAMPLE_SLUG)).toBe(true);
    // The order builder has nothing to build for it.
    expect(await BD.builderData(SP.SAMPLE_SLUG)).toBeNull();
  });

  it('is added once, and never changes what the team has already set', async () => {
    const before = await db.one<any>('select * from products where slug = $1', [SP.SAMPLE_SLUG]);
    await db.query("update products set blurb = 'Our own words' where slug = $1", [SP.SAMPLE_SLUG]);
    expect(await SP.ensureSamplePack({ query: db.query as any })).toBe(false);
    const after = await db.one<any>('select * from products where slug = $1', [SP.SAMPLE_SLUG]);
    expect(after.blurb).toBe('Our own words');
    expect(after.id).toBe(before.id);
    expect((await db.query('select 1 from products where slug = $1', [SP.SAMPLE_SLUG])).length).toBe(1);
  });
});

describe('ordering it', () => {
  it('needs no artwork, so the line is ready the moment it is added', async () => {
    const d: any = await O.createDraft({ slug: SP.SAMPLE_SLUG, quantity: 1, area: 'Yaba' });
    const item = (await O.getItem(d.id))!;
    expect(L.noFileKind(item as any)).toBe('sample');
    expect(L.lineReady(item as any)).toBe(true);
    expect(L.artworkOutstanding(item as any)).toBe(false);
    const view = await B.viewOf(d.id);
    expect(view?.lines[0].ready).toBe(true);
    expect(view?.lines[0].proof).toBe('sample');
    // Added to a basket that already holds something else, it is marked the same way.
    const e: any = await O.createDraft({ slug: 'flyers', quantity: 100, area: 'Yaba' });
    const a: any = await O.addLine(e.id, { slug: SP.SAMPLE_SLUG, quantity: 1 });
    expect(a.itemId).toBeTruthy();
    const added = (await O.getItem(e.id, a.itemId))!;
    expect(L.noFileKind(added as any)).toBe('sample');
    // The flyers line still needs its file.
    const items = await O.getItems(e.id);
    expect(items.filter((i) => L.artworkOutstanding(i as any)).length).toBe(1);
  });

  it('is not repeated by "same again"', async () => {
    const t = await paidSample();
    const r = await O.reorder(t.order.public_token, t.c.id);
    expect('error' in r).toBe(true);
  });

  it('passes through the file desk and the press without a file', async () => {
    const t = await paidSample();
    expect(t.job.stage).toBe('file_check');
    await J.moveJob(t.job.id, 'printing', { actor: admin });
    expect((await db.one<any>('select stage from jobs where id = $1', [t.job.id]))!.stage).toBe('printing');
  });
});

describe('the credit that comes back', () => {
  it('is issued when the pack is out for delivery, for exactly what was paid for the pack', async () => {
    const t = await paidSample();
    expect(await SP.issueSampleCredits()).toBe(0); // nothing has left yet
    await db.query("update jobs set stage = 'out_for_delivery' where id = $1", [t.job.id]);
    expect(await SP.issueSampleCredits()).toBe(1);
    const o = (await O.getOrder(t.id))!;
    expect(o.sample_coupon_id).toBeTruthy();
    const coupon = (await db.one<any>('select * from coupons where id = $1', [o.sample_coupon_id]))!;
    const line = (await O.getItem(t.id))!;
    expect(coupon.source).toBe('sample');
    expect(coupon.kind).toBe('fixed');
    expect(coupon.amount_off_kobo).toBe(line.line_total_kobo);
    expect(coupon.max_redemptions).toBe(1);
    expect(coupon.owner_customer_id).toBe(t.c.id);
    const days = (new Date(coupon.ends_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(58);
    expect(days).toBeLessThan(61);
    const msg = await db.one<any>("select * from messages where order_id = $1 and template = 'sample_credit'", [t.id]);
    expect(msg?.body).toContain(coupon.code);
    expect(msg?.vars.days).toBe('60');
  });

  it('is issued once, however often the sweep runs', async () => {
    const t = await paidSample();
    await db.query("update jobs set stage = 'delivered' where id = $1", [t.job.id]);
    expect(await SP.issueSampleCredits()).toBe(1);
    expect(await SP.issueSampleCredits()).toBe(0);
    expect((await db.query("select 1 from coupons where source = 'sample' and owner_customer_id = $1", [t.c.id])).length).toBe(1);
    expect((await db.query("select 1 from messages where order_id = $1 and template = 'sample_credit'", [t.id])).length).toBe(1);
  });

  it('is not issued for an order that was not paid, or was refunded', async () => {
    const t = await paidSample();
    await db.query("update jobs set stage = 'out_for_delivery' where id = $1", [t.job.id]);
    await db.query("update orders set status = 'refunded' where id = $1", [t.id]);
    expect(await SP.issueSampleCredits()).toBe(0);
  });

  it('works only for its owner, once, and takes the amount off a real order', async () => {
    const t = await paidSample();
    await db.query("update jobs set stage = 'out_for_delivery' where id = $1", [t.job.id]);
    await SP.issueSampleCredits();
    const o = (await O.getOrder(t.id))!;
    const coupon = (await db.one<any>('select * from coupons where id = $1', [o.sample_coupon_id]))!;
    const stranger = (await I.signInEmail(`stranger${n}@example.com`)).customer;
    const ctx = { subtotalKobo: 5_000_000, designKobo: 0, deliveryKobo: 0, productId: (await Cat.getProduct('flyers'))!.id };
    const no = await C.validateCoupon(coupon.code, { ...ctx, identity: { customerId: stranger.id } });
    expect(no.ok).toBe(false);
    const yes = await C.validateCoupon(coupon.code, { ...ctx, identity: { customerId: t.c.id } });
    expect(yes.ok).toBe(true);
    if (yes.ok) expect(yes.discountKobo).toBe(coupon.amount_off_kobo);
    // On a real order it comes off the price.
    const d: any = await O.createDraft({ slug: 'flyers', quantity: 100, area: 'Yaba' });
    await db.query('update orders set customer_id = $2, coupon_id = $3, coupon_code = $4 where id = $1', [d.id, t.c.id, coupon.id, coupon.code]);
    await O.recomputeOrder(d.id);
    const priced = (await O.getOrder(d.id))!;
    expect(priced.discount_kobo).toBe(Math.min(coupon.amount_off_kobo, priced.subtotal_kobo + (priced.discount_kobo ?? 0)));
    expect(priced.discount_kobo).toBeGreaterThan(0);
  });
});
