import { beforeAll, describe, expect, it } from 'vitest';
import { deflateSync, crc32 } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';

process.env.PGLITE_DIR = 'memory';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-commerce-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
delete process.env.PAYSTACK_SECRET_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.SMS_API_KEY;

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
let core: typeof import('../lib/couponCore');
let coupons: typeof import('../lib/coupons');
let couponAdmin: typeof import('../lib/couponAdmin');
let pricing: typeof import('../lib/pricing');
let pa: typeof import('../lib/productAdmin');
let images: typeof import('../lib/productImages');
let custom: typeof import('../lib/custom');
let privacy: typeof import('../lib/privacy');
let catalog: typeof import('../lib/catalog');

beforeAll(async () => {
  db = await import('../lib/db');
  orders = await import('../lib/orders');
  payments = await import('../lib/payments');
  core = await import('../lib/couponCore');
  coupons = await import('../lib/coupons');
  couponAdmin = await import('../lib/couponAdmin');
  pricing = await import('../lib/pricing');
  pa = await import('../lib/productAdmin');
  images = await import('../lib/productImages');
  custom = await import('../lib/custom');
  privacy = await import('../lib/privacy');
  catalog = await import('../lib/catalog');
  await db.ready();
});

const rule = (o: Partial<import('../lib/couponCore').CouponRule>): import('../lib/couponCore').CouponRule => ({ kind: 'percent', percent_off: 10, amount_off_kobo: null, max_discount_kobo: null, min_subtotal_kobo: 0, ...o });
const base = { subtotalKobo: 1_500_000, designKobo: 500_000, deliveryKobo: 150_000 };

describe('coupon maths', () => {
  it('takes a percentage off the print price only', () => {
    expect(core.discountFor(rule({ percent_off: 10 }), base)).toBe(150_000);
  });
  it('never takes more than the cap or more than the print price', () => {
    expect(core.discountFor(rule({ percent_off: 50, max_discount_kobo: 100_000 }), base)).toBe(100_000);
    expect(core.discountFor(rule({ kind: 'fixed', percent_off: null, amount_off_kobo: 9_000_000 }), base)).toBe(1_500_000);
  });
  it('free delivery takes off the delivery fee and nothing else', () => {
    expect(core.discountFor(rule({ kind: 'free_delivery', percent_off: null }), base)).toBe(150_000);
    expect(core.discountFor(rule({ kind: 'free_delivery', percent_off: null }), { ...base, deliveryKobo: 0 })).toBe(0);
  });
  it('gives nothing below the minimum spend', () => {
    expect(core.discountFor(rule({ min_subtotal_kobo: 2_000_000 }), base)).toBe(0);
  });
  it('reads codes the way people type them on a phone', () => {
    expect(core.normalizeCode('  welcome 10. ')).toBe('WELCOME10');
    expect(core.normalizeCode('-save-')).toBe('SAVE');
    expect(core.normalizeCode(null)).toBe('');
    expect(core.CODE_PATTERN.test('WELCOME10')).toBe(true);
    expect(core.CODE_PATTERN.test('A')).toBe(false);
    expect(core.randomCode()).toMatch(/^BRAND-[A-Z2-9]{5}$/);
  });
  it('describes a coupon in plain words', () => {
    expect(core.couponLabel(rule({ percent_off: 10, max_discount_kobo: 500_000, min_subtotal_kobo: 1_000_000 }))).toBe('10% off (up to ₦5,000), when you spend ₦10,000 or more');
    expect(core.couponLabel(rule({ kind: 'free_delivery', percent_off: null }))).toBe('Free delivery');
  });
});

describe('order totals with a discount', () => {
  const vat = 0.075;
  it('works VAT out of what the customer actually pays', () => {
    const t = pricing.priceOrder({ itemsKobo: [1_500_000], deliveryFeeKobo: 150_000, pickup: false, designFeeKobo: 500_000, discountKobo: 150_000, vatRate: vat, pricesIncludeVat: true });
    expect(t.totalKobo).toBe(2_000_000);
    expect(t.discountKobo).toBe(150_000);
    expect(t.vatKobo).toBe(Math.round((2_000_000 * vat) / (1 + vat)));
  });
  it('adds VAT on top when prices do not include it', () => {
    const t = pricing.priceOrder({ itemsKobo: [1_000_000], deliveryFeeKobo: 0, pickup: true, discountKobo: 100_000, vatRate: vat, pricesIncludeVat: false });
    expect(t.totalKobo).toBe(900_000 + Math.round(900_000 * vat));
  });
  it('can never go below zero', () => {
    const t = pricing.priceOrder({ itemsKobo: [100_000], deliveryFeeKobo: 0, pickup: true, discountKobo: 999_999, vatRate: vat, pricesIncludeVat: true });
    expect(t.totalKobo).toBe(0);
    expect(t.discountKobo).toBe(100_000);
  });
  it('ignores the delivery fee on pickup', () => {
    expect(pricing.priceOrder({ itemsKobo: [100_000], deliveryFeeKobo: 150_000, pickup: true, vatRate: vat, pricesIncludeVat: true }).totalKobo).toBe(100_000);
  });
});

describe('option extras', () => {
  const opts = [
    { key: 'finish', label: 'Finish', default: 'matt', choices: [{ value: 'matt', label: 'Matt' }, { value: 'gloss', label: 'Gloss', extra_kobo: 200_000, extra_per: 'order' as const }] },
    { key: 'stand', label: 'Stand', default: 'no', choices: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes', extra_kobo: 2_000, extra_per: 'piece' as const }] },
    { key: 'eyelets', label: 'Eyelets', default: 'no', choices: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes', extra_kobo: 10_000, extra_per: 'sqft' as const }] },
  ];
  it('adds per order, per piece and per square foot', () => {
    expect(pricing.optionSurcharge(opts, { finish: 'gloss', stand: 'yes', eyelets: 'yes' }, { quantity: 50, areaSqft: 12.2 })).toBe(200_000 + 100_000 + 130_000);
  });
  it('adds nothing for a choice without an extra, or one it does not know', () => {
    expect(pricing.optionSurcharge(opts, { finish: 'matt' }, { quantity: 50, areaSqft: null })).toBe(0);
    expect(pricing.optionSurcharge(opts, { finish: 'nope' }, { quantity: 50, areaSqft: null })).toBe(0);
  });
  it('labels the button', () => {
    const f = (k: number) => `₦${k / 100}`;
    expect(pricing.extraLabel({ extra_kobo: 200_000 }, f)).toBe('+₦2000');
    expect(pricing.extraLabel({ extra_kobo: 2_000, extra_per: 'piece' }, f)).toBe('+₦20 each');
    expect(pricing.extraLabel({ extra_kobo: 10_000, extra_per: 'sqft' }, f)).toBe('+₦100 per sq ft');
    expect(pricing.extraLabel({}, f)).toBe('');
  });
});

describe('option editor input', () => {
  const ok = { label: 'Finish', choices: [{ label: 'Matt' }, { label: 'Gloss', extra: '2,000', per: 'piece' }] };
  it('cleans names, makes keys and prices in kobo', () => {
    const [o] = pa.cleanOptions([ok], 'tier');
    expect(o.key).toBe('finish');
    expect(o.choices.map((c) => c.value)).toEqual(['matt', 'gloss']);
    expect(o.choices[1]).toMatchObject({ extra_kobo: 200_000, extra_per: 'piece' });
    expect(o.default).toBe('matt');
  });
  it('keeps the chosen default by position, even when two labels are alike', () => {
    const [o] = pa.cleanOptions([{ label: 'Paper', defaultIndex: 1, choices: [{ label: 'A4' }, { label: 'A4' }, { label: 'A5' }] }], 'tier');
    expect(o.default).toBe(o.choices[1].value);
    expect(new Set(o.choices.map((c) => c.value)).size).toBe(3);
  });
  it('gives colliding option names different keys', () => {
    const out = pa.cleanOptions([ok, { ...ok }], 'tier');
    expect(out[0].key).not.toBe(out[1].key);
  });
  it('refuses a one-choice option, a nameless option and too many options', () => {
    expect(() => pa.cleanOptions([{ label: 'Finish', choices: [{ label: 'Matt' }] }], 'tier')).toThrow(/at least two/);
    expect(() => pa.cleanOptions([{ label: '', choices: [{ label: 'A' }, { label: 'B' }] }], 'tier')).toThrow(/needs a name/);
    expect(() => pa.cleanOptions(Array.from({ length: 5 }, (_, i) => ({ label: `O${i}`, choices: [{ label: 'A' }, { label: 'B' }] })), 'tier')).toThrow(/up to 4/);
    expect(() => pa.cleanOptions('nope', 'tier')).toThrow(pa.ProductError);
  });
  it('allows per-square-foot extras only on area-priced products, and refuses a bad amount', () => {
    const sq = { label: 'Eyelets', choices: [{ label: 'No' }, { label: 'Yes', extra: '100', per: 'sqft' }] };
    expect(() => pa.cleanOptions([sq], 'tier')).toThrow(/square foot/);
    expect(pa.cleanOptions([sq], 'area')[0].choices[1].extra_per).toBe('sqft');
    expect(() => pa.cleanOptions([{ label: 'X', choices: [{ label: 'A' }, { label: 'B', extra: '-5000x' }] }], 'tier')).not.toThrow();
  });
});

describe('product manager', () => {
  let id = '';
  it('creates a hidden product and never reuses a slug', async () => {
    const a = await pa.createProduct({ name: 'Mugs', category: 'Gifts', blurb: 'Printed mugs', mode: 'tier' });
    const b = await pa.createProduct({ name: 'Mugs', category: 'Gifts', blurb: '', mode: 'tier' });
    const c = await pa.createProduct({ name: 'Custom order', category: '', blurb: '', mode: 'tier' });
    expect(a.slug).toBe('mugs');
    expect(b.slug).toBe('mugs-2');
    expect(c.slug).not.toBe('custom-order');
    id = a.id;
    const row = await db.one<any>('select active from products where id = $1', [id]);
    expect(row.active).toBe(false);
    await expect(pa.createProduct({ name: ' ', category: '', blurb: '', mode: 'tier' })).rejects.toThrow(pa.ProductError);
  });
  it('will not go on sale until it has a price, then can', async () => {
    const before = await pa.readiness(id);
    expect(before.ready).toBe(false);
    expect(before.missing.join(' ')).toMatch(/quantity with a price/);
    await expect(pa.setActive(id, true)).rejects.toThrow(/needs/);
    await pa.saveTierPrices(id, [{ quantity: 10, price: '5,000' }, { quantity: 50, price: '20000' }]);
    expect((await pa.readiness(id)).ready).toBe(true);
    await pa.setActive(id, true);
    const cards = await catalog.listCatalog();
    const mug = cards.find((c) => c.product.id === id)!;
    expect(mug).toBeTruthy();
    expect(mug.from).toMatch(/^From ₦5,000 for 10$/);
    expect(mug.cover).toBeNull();
  });
  it('checks prices', async () => {
    await expect(pa.saveTierPrices(id, [{ quantity: 10, price: '0' }])).rejects.toThrow(/more than zero/);
    await expect(pa.saveTierPrices(id, [{ quantity: 10, price: '5' }, { quantity: 10, price: '6' }])).rejects.toThrow(/twice/);
    await expect(pa.saveTierPrices(id, [{ quantity: 99999, price: '5' }])).rejects.toThrow(/between 1 and/);
    expect(await catalog.quantitySteps(id)).toEqual([10, 50]);
  });
  it('saves words and checks the print size', async () => {
    const d = { name: 'Mugs', category: 'Gifts', blurb: 'Printed mugs', description: 'Good mugs.\r\n\r\n\r\n\r\nReally good.', highlights: 'Dishwasher safe\n\n  Holds 330 ml  ', allow_custom: true, check_class: 'print', print_w_in: '8', print_h_in: '3.5' };
    await pa.saveDetails(id, d);
    const row = await db.one<any>('select description, highlights, print_w_in from products where id = $1', [id]);
    expect(row.description).toBe('Good mugs.\n\nReally good.');
    expect(row.highlights).toEqual(['Dishwasher safe', 'Holds 330 ml']);
    await expect(pa.saveDetails(id, { ...d, print_h_in: '' })).rejects.toThrow(/both/);
    await expect(pa.saveDetails(id, { ...d, print_w_in: '-1' })).rejects.toThrow(/inches/);
    await expect(pa.saveDetails(id, { ...d, name: '' })).rejects.toThrow(/needs a name/);
  });
  it('can be quoted and ordered like any other product', async () => {
    const q = await orders.createDraft({ slug: 'mugs', quantity: 50, area: 'Yaba' });
    expect('error' in q).toBe(false);
    const o = (await orders.getOrder((q as any).id))!;
    expect(o.subtotal_kobo).toBe(2_000_000);
  });
  it('cannot be deleted once an order exists, and can be hidden instead', async () => {
    await expect(pa.deleteProduct(id)).rejects.toThrow(/behind it/);
    await pa.setActive(id, false);
    expect((await catalog.listCatalog()).some((c) => c.product.id === id)).toBe(false);
  });
  it('deletes a product nobody bought, with its prices', async () => {
    const x = await pa.createProduct({ name: 'Temporary', category: '', blurb: 'x', mode: 'tier' });
    await pa.saveTierPrices(x.id, [{ quantity: 1, price: '100' }]);
    await pa.deleteProduct(x.id);
    expect(await db.one('select 1 as x from price_rules where product_id = $1', [x.id])).toBeNull();
    expect(await db.one('select 1 as x from products where id = $1', [x.id])).toBeNull();
  });
  it('moves products up and down', async () => {
    const list = async () => (await db.query<any>('select slug from products where not system order by sort, name')).map((r) => r.slug);
    const before = await list();
    await pa.moveProduct((await db.one<any>('select id from products where slug = $1', [before[1]]))!.id, 'up');
    const after = await list();
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
  });
});

describe('product photos', () => {
  it('recognises photos by their first bytes, not their names', () => {
    expect(images.sniff(makePng(300, 300))).toBe('image/png');
    expect(images.sniff(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(30)]))).toBe('image/jpeg');
    expect(images.sniff(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]))).toBe('image/webp');
    expect(images.sniff(Buffer.from('<svg onload="alert(1)"></svg>'))).toBeNull();
    expect(images.sniff(Buffer.from('%PDF-1.7 ......'))).toBeNull();
  });
  it('adds, orders, replaces the cover and removes photos', async () => {
    const p = await db.one<any>('select id from products where slug = $1', ['flyers']);
    const a = await images.addProductImage(p.id, { name: 'a.png', buf: makePng(900, 700) });
    const b = await images.addProductImage(p.id, { name: 'b.png', buf: makePng(800, 800) });
    expect(a.sort).toBe(0);
    expect(b.sort).toBe(1);
    expect((await images.readImage(a.id, 'thumb'))!.mime).toMatch(/^image\//);
    await images.makeCover(b.id);
    expect((await images.listImages(p.id)).map((i) => i.id)).toEqual([b.id, a.id]);
    const card = (await catalog.listCatalog()).find((c) => c.product.id === p.id)!;
    expect(card.cover).toBe(b.id);
    await images.deleteProductImage(b.id);
    expect(await images.readImage(b.id, 'full')).toBeNull();
    expect((await images.listImages(p.id)).map((i) => i.id)).toEqual([a.id]);
    await images.deleteAllImages(p.id);
    expect(await images.listImages(p.id)).toEqual([]);
  });
  it('refuses things that are not photos, tiny photos and too many photos', async () => {
    const p = await db.one<any>('select id from products where slug = $1', ['posters']);
    await expect(images.addProductImage(p.id, { name: 'x.svg', buf: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') })).rejects.toThrow(/not a JPG, PNG or WebP/);
    await expect(images.addProductImage(p.id, { name: 'tiny.png', buf: makePng(50, 50) })).rejects.toThrow(/too small/);
    await expect(images.addProductImage('00000000-0000-0000-0000-000000000000', { name: 'a.png', buf: makePng(400, 400) })).rejects.toThrow(/could not find/);
    for (let i = 0; i < pa.MAX_IMAGES; i++) await images.addProductImage(p.id, { name: `p${i}.png`, buf: makePng(400, 400) });
    await expect(images.addProductImage(p.id, { name: 'one-more.png', buf: makePng(400, 400) })).rejects.toThrow(/up to 8/);
    await images.deleteAllImages(p.id);
  });
});

describe('coupons', () => {
  let cardsId = '';
  const mk = (over: Partial<import('../lib/couponAdmin').NewCoupon> = {}) =>
    couponAdmin.createCoupon({ code: '', description: '', kind: 'percent', percent: '10', amount: '', cap: '', minSpend: '', startsOn: '', endsOn: '', maxRedemptions: '', perCustomer: '', firstOrderOnly: false, productIds: [], ...over }, null);
  const ctx = (over: Partial<import('../lib/coupons').Context> = {}): import('../lib/coupons').Context => ({ subtotalKobo: 1_500_000, designKobo: 0, deliveryKobo: 150_000, productId: cardsId, ...over });
  beforeAll(async () => { cardsId = (await db.one<any>('select id from products where slug = $1', ['business-cards']))!.id; });

  it('creates a code, or makes one up, and refuses duplicates', async () => {
    const a = await mk({ code: ' welcome 10 ' });
    expect(a.code).toBe('WELCOME10');
    const b = await mk({});
    expect(b.code).toMatch(/^BRAND-/);
    await expect(mk({ code: 'welcome10' })).rejects.toThrow(/already exists/);
    await expect(mk({ code: 'x' })).rejects.toThrow(/3 to 24/);
  });
  it('checks what each kind needs', async () => {
    await expect(mk({ code: 'NOPCT', percent: '' })).rejects.toThrow(/percentage/);
    await expect(mk({ code: 'BIGPCT', percent: '150' })).rejects.toThrow(/from 1 to 100/);
    await expect(mk({ code: 'NOAMT', kind: 'fixed', percent: '', amount: '' })).rejects.toThrow(/amount off/);
    await expect(mk({ code: 'BADKIND', kind: 'magic' })).rejects.toThrow(/Choose what/);
    await expect(mk({ code: 'BADDATE', startsOn: '2026-12-31', endsOn: '2026-12-01' })).rejects.toThrow(/after the first day/);
    const fixed = await mk({ code: 'TWOK', kind: 'fixed', percent: '', amount: '2,000' });
    expect(fixed.amount_off_kobo).toBe(200_000);
    expect(fixed.max_per_customer).toBe(1);
  });
  it('accepts a valid code in any case, and says what it is worth', async () => {
    const v = await coupons.validateCoupon('welcome10', ctx());
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.discountKobo).toBe(150_000);
  });
  it('says plainly why a code does not work', async () => {
    const say = async (code: string, over: Partial<import('../lib/coupons').Context> = {}) => { const v = await coupons.validateCoupon(code, ctx(over)); return v.ok ? 'OK' : v.message; };
    expect(await say('NOSUCHCODE')).toMatch(/not valid/);
    await mk({ code: 'FUTURE1', startsOn: '2099-01-01' });
    expect(await say('FUTURE1')).toMatch(/not active yet/);
    await mk({ code: 'PAST1', startsOn: '2020-01-01', endsOn: '2020-02-01' });
    expect(await say('PAST1')).toMatch(/expired/);
    await mk({ code: 'BIGSPEND', minSpend: '50000' });
    expect(await say('BIGSPEND')).toMatch(/at least ₦50,000/);
    const only = await mk({ code: 'FLYERSONLY', productIds: [(await db.one<any>('select id from products where slug = $1', ['flyers']))!.id] });
    expect(only.product_ids.length).toBe(1);
    expect(await say('FLYERSONLY')).toMatch(/does not apply to this product/);
    await mk({ code: 'FREEDEL', kind: 'free_delivery', percent: '' });
    expect(await say('FREEDEL', { deliveryKobo: 0 })).toMatch(/no delivery fee/);
    expect(await say('FREEDEL')).toBe('OK');
    expect(await say('WELCOME10', { custom: true })).toMatch(/custom quotes/);
    const paused = await mk({ code: 'PAUSED1' });
    await couponAdmin.setCouponActive(paused.id, false);
    expect(await say('PAUSED1')).toMatch(/not valid/);
  });
  it('turns the right state on the list', () => {
    const now = new Date('2026-10-12T10:00:00Z');
    const c = { active: true, starts_at: null, ends_at: null, max_redemptions: null };
    expect(couponAdmin.stateOf(c, 0, now)).toBe('active');
    expect(couponAdmin.stateOf({ ...c, active: false }, 0, now)).toBe('paused');
    expect(couponAdmin.stateOf({ ...c, starts_at: '2026-11-01T00:00:00Z' }, 0, now)).toBe('scheduled');
    expect(couponAdmin.stateOf({ ...c, ends_at: '2026-10-01T00:00:00Z' }, 0, now)).toBe('ended');
    expect(couponAdmin.stateOf({ ...c, max_redemptions: 5 }, 5, now)).toBe('used_up');
  });
  it('changes limits but not what the coupon gives, and keeps history when deleting', async () => {
    const c = await mk({ code: 'LIMITME' });
    await couponAdmin.updateCouponLimits(c.id, { description: 'Launch week', endsOn: '2099-01-31', maxRedemptions: '20' });
    const row = await db.one<any>('select * from coupons where id = $1', [c.id]);
    expect(row.description).toBe('Launch week');
    expect(row.max_redemptions).toBe(20);
    expect(row.percent_off).toBe(10);
    await couponAdmin.deleteCoupon(c.id);
    expect(await db.one('select 1 as x from coupons where id = $1', [c.id])).toBeNull();
  });
});

describe('a coupon on a real order', () => {
  const buyer = { name: 'Coupon Buyer', phone: '0803 777 0001', email: 'coupon@example.com' };
  async function draft(opts: { code?: string; design?: boolean } = {}) {
    const d: any = await orders.createDraft({ slug: 'business-cards', quantity: 100, area: 'Yaba' });
    if (opts.design !== false) await orders.setArtworkPath(d.id, 'design', { purpose: 'coupon test' });
    if (opts.code) {
      const o = (await orders.getOrder(d.id))!;
      const item = (await orders.getItem(d.id))!;
      const v = await coupons.validateCoupon(opts.code, { subtotalKobo: item.line_total_kobo, designKobo: o.design_fee_kobo, deliveryKobo: o.delivery_fee_kobo, productId: item.product_id, orderId: d.id, identity: { phone: '+2348037770001', email: buyer.email } });
      expect(v.ok).toBe(true);
      if (v.ok) await db.query('update orders set coupon_id = $2, coupon_code = $3 where id = $1', [d.id, v.coupon.id, v.coupon.code]);
    }
    const c = await orders.saveCheckout(d.id, { ...buyer, pickup: false, area: 'Yaba', addressLine: '12 Test Street, Yaba' });
    expect(c.ok).toBe(true);
    return d.id as string;
  }
  async function pay(id: string) {
    const o = (await orders.getOrder(id))!;
    const p = await payments.initPayment(o, buyer.email);
    const r = await orders.confirmPayment({ reference: p.reference, amountKobo: o.total_kobo, method: 'card' });
    expect(r.ok).toBe(true);
  }

  it('discounts the print price only, and the total follows', async () => {
    const id = await draft({ code: 'WELCOME10' });
    const o = (await orders.getOrder(id))!;
    expect(o.subtotal_kobo).toBe(1_500_000);
    expect(o.discount_kobo).toBe(150_000);
    expect(o.design_fee_kobo).toBeGreaterThan(0);
    expect(o.total_kobo).toBe(o.subtotal_kobo + o.delivery_fee_kobo + o.design_fee_kobo - 150_000);
  });
  it('counts the use only when the order is paid, and then blocks a second use by the same customer', async () => {
    const id = await draft({ code: 'WELCOME10' });
    expect((await db.one<any>('select count(*)::int as n from coupon_redemptions'))!.n).toBe(0);
    await pay(id);
    const red = await db.query<any>('select discount_kobo, phone from coupon_redemptions');
    expect(red).toHaveLength(1);
    expect(red[0].discount_kobo).toBe(150_000);
    const again = await coupons.validateCoupon('WELCOME10', { subtotalKobo: 1_500_000, designKobo: 0, deliveryKobo: 0, productId: (await db.one<any>('select id from products where slug = $1', ['business-cards']))!.id, identity: { phone: '+2348037770001' } });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.message).toMatch(/already used/);
    const stats = (await coupons.couponStats()).get((await db.one<any>('select id from coupons where code = $1', ['WELCOME10']))!.id);
    expect(stats?.redemptions).toBe(1);
    expect(stats?.discountKobo).toBe(150_000);
  });
  it('takes a coupon off, and says why, when it stops being valid before payment', async () => {
    const c = await couponAdmin.createCoupon({ code: 'SHORTLIVED', description: '', kind: 'fixed', percent: '', amount: '1000', cap: '', minSpend: '', startsOn: '', endsOn: '', maxRedemptions: '', perCustomer: '', firstOrderOnly: false, productIds: [] }, null);
    const id = await draft({ code: 'SHORTLIVED' });
    expect((await orders.getOrder(id))!.discount_kobo).toBe(100_000);
    await couponAdmin.setCouponActive(c.id, false);
    const r = await orders.recomputeOrder(id);
    expect(r.ok && r.couponMessage).toMatch(/not valid/);
    const o = (await orders.getOrder(id))!;
    expect(o.discount_kobo).toBe(0);
    expect(o.coupon_code).toBeNull();
  });
  it('lets a paid order keep its discount when the coupon is paused afterwards', async () => {
    const used = await db.one<any>('select o.id, o.total_kobo, o.discount_kobo from orders o join coupon_redemptions r on r.order_id = o.id limit 1');
    await db.query("update coupons set active = false where code = 'WELCOME10'");
    expect((await orders.getOrder(used.id))!.discount_kobo).toBe(used.discount_kobo);
    await expect(couponAdmin.deleteCoupon((await db.one<any>('select id from coupons where code = $1', ['WELCOME10']))!.id)).rejects.toThrow(/has been used/);
  });
});

describe('custom orders', () => {
  const who = { name: 'Ada Obi', phone: '0805 555 1234', email: 'ada@example.com' };
  const job = { title: 'Wedding backdrop', details: 'A 10 ft by 8 ft printed backdrop for a wedding in Lekki, with our names and the date.', quantityText: '1', sizeText: '10 x 8 ft' };
  let staffId = '';
  beforeAll(async () => { staffId = (await db.one<any>('select id from staff limit 1'))!.id; });

  it('asks for what it needs, in words a person understands', async () => {
    const bad = async (over: any) => { const r = await custom.createCustomRequest({ ...who, ...job, ...over }, []); return r.ok ? 'OK' : r.field ?? r.error; };
    expect(await bad({ name: '' })).toBe('name');
    expect(await bad({ phone: '123' })).toBe('phone');
    expect(await bad({ title: '' })).toBe('title');
    expect(await bad({ details: 'too short' })).toBe('details');
  });

  let created: { id: string; code: string; token: string };
  it('takes a request with reference files and gives back a reference and a private link', async () => {
    const r = await custom.createCustomRequest({ ...who, ...job }, [{ name: 'idea.png', buf: makePng(600, 400) }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    created = r;
    expect(r.code).toMatch(/^CQ-\d+$/);
    expect(r.token.length).toBeGreaterThan(10);
    expect((await custom.requestFiles(r.id)).length).toBe(1);
    expect((await custom.getByToken(r.token))!.status).toBe('new');
  });
  it('does not take a price until a person sets one, and checks the quote', async () => {
    const early = await custom.acceptQuote(created.token);
    expect(early.ok).toBe(false);
    expect((await custom.quoteRequest(created.id, staffId, { price: '', days: '3' })).ok).toBe(false);
    expect((await custom.quoteRequest(created.id, staffId, { price: '85000', days: '0' })).ok).toBe(false);
    expect((await custom.quoteRequest(created.id, staffId, { price: '99999999999', days: '3' })).ok).toBe(false);
    expect((await custom.quoteRequest(created.id, staffId, { price: '85,000', days: '3', note: 'Printed on 440gsm flex, hemmed.' })).ok).toBe(true);
  });
  let orderId = '';
  it('turns an accepted price into one order, even if the button is pressed twice', async () => {
    const a = await custom.acceptQuote(created.token);
    const b = await custom.acceptQuote(created.token);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.orderId).toBe(a.orderId);
    orderId = a.orderId;
    expect((await db.one<any>('select count(*)::int as n from orders where custom_request_id = $1', [created.id]))!.n).toBe(1);
    const o = (await orders.getOrder(orderId))!;
    expect(o.subtotal_kobo).toBe(8_500_000);
    const item = (await orders.getItem(orderId))!;
    expect(item.label).toBe('Custom: Wedding backdrop');
    expect(item.artwork_path).toBe('design');
    expect((await custom.getByToken(created.token))!.status).toBe('accepted');
    expect((await custom.quoteRequest(created.id, staffId, { price: '1', days: '1' })).ok).toBe(false);
    expect((await custom.cancelByCustomer(created.token)).ok).toBe(false);
  });
  it('adds the delivery fee at checkout, rejects coupons, and gets its arrival time at proof approval', async () => {
    const c = await orders.saveCheckout(orderId, { ...who, pickup: false, area: 'Yaba', addressLine: '5 Test Road, Yaba' });
    expect(c.ok).toBe(true);
    const o = (await orders.getOrder(orderId))!;
    expect(o.total_kobo).toBe(8_500_000 + o.delivery_fee_kobo);
    expect(o.discount_kobo).toBe(0);
    expect(o.promised_at).toBeNull();
    const v = await coupons.validateCoupon('FREEDEL', { subtotalKobo: o.subtotal_kobo, designKobo: 0, deliveryKobo: o.delivery_fee_kobo, productId: (await orders.getItem(orderId))!.product_id, custom: true });
    expect(v.ok).toBe(false);
  });
  it('becomes a normal paid job named after the request', async () => {
    const o = (await orders.getOrder(orderId))!;
    const p = await payments.initPayment(o, who.email);
    const r = await orders.confirmPayment({ reference: p.reference, amountKobo: o.total_kobo, method: 'card' });
    expect(r.ok).toBe(true);
    const j = await db.one<any>('select j.id, i.label from jobs j join order_items i on i.order_id = j.order_id where j.order_id = $1', [orderId]);
    expect(j.label).toBe('Custom: Wedding backdrop');
    const mine = await custom.requestsForCustomer((await db.one<any>('select id from customers where phone = $1', ['+2348055551234']))!.id);
    expect(mine.find((x) => x.id === created.id)).toBeUndefined(); // it is an order now, listed with the orders
  });
  it('lets a quote run out and be renewed', async () => {
    const r = await custom.createCustomRequest({ ...who, ...job, title: 'Pull-up stand' }, []);
    if (!r.ok) throw new Error(r.error);
    const past = new Date(Date.now() - 10 * 86_400_000);
    expect((await custom.quoteRequest(r.id, staffId, { price: '40000', days: '2' }, past)).ok).toBe(true);
    const row = (await custom.getByToken(r.token))!;
    expect(custom.effectiveStatus(row)).toBe('expired');
    const late = await custom.acceptQuote(r.token);
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error).toMatch(/expired/);
    expect((await custom.quoteRequest(r.id, staffId, { price: '42000', days: '2' })).ok).toBe(true);
    expect(custom.effectiveStatus((await custom.getByToken(r.token))!)).toBe('quoted');
    expect((await custom.acceptQuote(r.token)).ok).toBe(true);
  });
  it('can be declined with a reason, or cancelled by the customer', async () => {
    const a = await custom.createCustomRequest({ ...who, ...job, title: 'Glass etching' }, []);
    const b = await custom.createCustomRequest({ ...who, ...job, title: 'Changed my mind' }, []);
    if (!a.ok || !b.ok) throw new Error('setup');
    expect((await custom.declineRequest(a.id, 'no')).ok).toBe(false);
    expect((await custom.declineRequest(a.id, 'We do not print on glass.')).ok).toBe(true);
    expect((await custom.getByToken(a.token))!.status).toBe('declined');
    expect((await custom.acceptQuote(a.token)).ok).toBe(false);
    expect((await custom.cancelByCustomer(b.token)).ok).toBe(true);
    expect((await custom.getByToken(b.token))!.status).toBe('cancelled');
  });
  it('counts what is waiting for the team', async () => {
    const before = await custom.requestCounts();
    const r = await custom.createCustomRequest({ ...who, ...job, title: 'Another one' }, []);
    expect(r.ok).toBe(true);
    expect((await custom.requestCounts()).todo).toBe(before.todo + 1);
  });
  it('cleans up requests nobody came back for, and their files, but never an accepted one', async () => {
    const old = await custom.createCustomRequest({ ...who, ...job, title: 'Forgotten request' }, [{ name: 'old.png', buf: makePng(300, 300) }]);
    if (!old.ok) throw new Error('setup');
    const swept = await custom.cleanupStale(new Date(Date.now() + 120 * 86_400_000));
    expect(swept.closed).toBeGreaterThanOrEqual(1);
    expect((await custom.getByToken(old.token))!.status).not.toBe('new');
    expect((await custom.getByToken(created.token))!.status).toBe('accepted');
    expect((await custom.requestFiles(created.id)).length).toBe(1);
  });
});

describe('privacy covers the new data', () => {
  it('exports custom requests and coupon use, and erases them on request', async () => {
    const cust = (await db.one<any>('select id from customers where phone = $1', ['+2348037770001']))!;
    const data: any = await privacy.exportData(cust.id);
    expect(data.coupons_used.map((c: any) => c.code)).toContain('WELCOME10');
    const adaId = (await db.one<any>('select id from customers where phone = $1', ['+2348055551234']))!.id;
    const ada: any = await privacy.exportData(adaId);
    expect(ada.custom_requests.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(ada)).toContain('Wedding backdrop');
    // The wedding backdrop is paid and in production, so deletion is held back until it is done.
    const held = await privacy.deleteAccount(adaId);
    expect(held.ok).toBe(false);
    await db.query("update orders set status = 'delivered', delivered_at = now() where customer_id = $1", [adaId]);
    const done = await privacy.deleteAccount(adaId);
    expect(done.ok).toBe(true);
    const left = await db.query<any>("select details, phone, email, name from custom_requests where phone = $1 or lower(email) = 'ada@example.com'", ['+2348055551234']);
    expect(JSON.stringify(left)).not.toContain('wedding in Lekki');
  });
});

describe('reviews on the home page', () => {
  it('shows only reviews the customer agreed to and a person picked, with a first name and nothing more', async () => {
    const { featuredReviews } = await import('../lib/publicReviews');
    const o = (await db.one<any>("select o.id from orders o where o.status = 'paid' or o.status = 'in_production' limit 1"))!;
    await db.query("insert into reviews (order_id, rating, body, public_ok, featured) values ($1, 5, 'Neat work and it came on time, thank you', false, true)", [o.id]);
    expect(await featuredReviews()).toEqual([]); // featured, but the customer never agreed
    await db.query('update reviews set public_ok = true where order_id = $1', [o.id]);
    const shown = await featuredReviews();
    expect(shown).toHaveLength(1);
    expect(Object.keys(shown[0]).sort()).toEqual(['body', 'first_name', 'has_photo', 'id', 'product', 'rating']);
    await db.query("update reviews set rating = 2 where order_id = $1", [o.id]);
    expect(await featuredReviews()).toEqual([]); // low ratings are for us to answer, not to advertise
    await db.query("update reviews set rating = 5, body = 'ok' where order_id = $1", [o.id]);
    expect(await featuredReviews()).toEqual([]); // too little to be worth showing
  });
});

describe('migrations 004 and 005 on a database that already has data', () => {
  it('keep existing products, orders and reviews, and add the new columns with safe defaults', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { MIGRATIONS } = await import('../lib/schema');
    const pg = new PGlite();
    const q = { query: async (sql: string, params?: unknown[]) => (await pg.query(sql, params as any[])).rows as any[] };
    const upTo = (id: string) => MIGRATIONS.findIndex((m) => m.id === id);
    for (const m of MIGRATIONS.slice(0, upTo('004_catalog_coupons_custom'))) await pg.exec(m.sql);
    await pg.exec("insert into products (slug, name, pricing_mode) values ('business-cards', 'Business cards', 'tier'), ('mystery', 'Mystery item', 'tier')");
    await pg.exec("insert into customers (phone, name) values ('+2348030000000', 'Old Customer')");
    await pg.exec("insert into orders (code, public_token, status, customer_id, total_kobo, paid_at) select 'BR-OLD', 'oldtoken', 'delivered', id, 100000, now() from customers limit 1");
    await pg.exec("insert into order_items (order_id, product_id, quantity, line_total_kobo) select o.id, p.id, 100, 100000 from orders o, products p where p.slug = 'business-cards'");
    await pg.exec("insert into reviews (order_id, rating, body) select id, 5, 'Fast and neat work, thank you' from orders limit 1");
    for (const m of MIGRATIONS.slice(upTo('004_catalog_coupons_custom'))) { await pg.exec(m.sql); if (m.after) await m.after(q as any); }

    const bc = (await q.query("select description, category, highlights, allow_custom from products where slug = 'business-cards'"))[0];
    expect(bc.description.length).toBeGreaterThan(20);
    expect(bc.category).not.toBe('');
    expect(bc.allow_custom).toBe(true);
    const mystery = (await q.query("select description, category from products where slug = 'mystery'"))[0];
    expect(mystery).toEqual({ description: '', category: '' });
    const review = (await q.query('select public_ok, featured from reviews'))[0];
    expect(review).toEqual({ public_ok: false, featured: false }); // nobody agreed to be shown yet, so nobody is
    const order = (await q.query("select discount_kobo, coupon_id, custom_request_id from orders where code = 'BR-OLD'"))[0];
    expect(order).toEqual({ discount_kobo: 0, coupon_id: null, custom_request_id: null });
    // The new tables work, and running the whole list again changes nothing.
    await pg.exec("insert into coupons (code, kind, percent_off) values ('HELLO', 'percent', 5)");
    expect((await q.query('select count(*)::int as n from coupons'))[0].n).toBe(1);
    await pg.close();
  });
});
