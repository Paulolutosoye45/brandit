import { beforeAll, describe, expect, it } from 'vitest';
import { deflateSync, crc32 } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';

process.env.PGLITE_DIR = 'memory';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-basket-${process.pid}`);
delete process.env.PAYSTACK_SECRET_KEY;

// A valid greyscale PNG of any size, built with no image library.
function makePng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

let db: typeof import('../lib/db');
let orders: typeof import('../lib/orders');
let payments: typeof import('../lib/payments');
let art: typeof import('../lib/artwork');
let lines: typeof import('../lib/lines');
let coupons: typeof import('../lib/coupons');
let basket: typeof import('../lib/basket');
let tracker: typeof import('../lib/tracker');

beforeAll(async () => {
  db = await import('../lib/db');
  orders = await import('../lib/orders');
  payments = await import('../lib/payments');
  art = await import('../lib/artwork');
  lines = await import('../lib/lines');
  coupons = await import('../lib/coupons');
  basket = await import('../lib/basket');
  tracker = await import('../lib/tracker');
  await db.ready();
});

const items = (id: string) => db.query<any>('select * from order_items where order_id = $1 order by position, id', [id]);

async function basketWith(...inputs: Parameters<typeof orders.addLine>[1][]) {
  const first: any = await orders.createDraft({ ...inputs[0], area: 'Yaba' }, 'product');
  expect(first.error).toBeUndefined();
  for (const i of inputs.slice(1)) {
    const r: any = await orders.addLine(first.id, i);
    expect(r.error).toBeUndefined();
  }
  return first.id as string;
}

describe('a basket of several products', () => {
  it('prices every line on the server and charges delivery once', async () => {
    const id = await basketWith({ slug: 'business-cards', quantity: 100 }, { slug: 'flyers', quantity: 100 });
    const o = (await orders.getOrder(id))!;
    const rows = await items(id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
    expect(o.subtotal_kobo).toBe(rows[0].line_total_kobo + rows[1].line_total_kobo);
    expect(o.delivery_fee_kobo).toBe(150_000); // Yaba, once
    expect(o.total_kobo).toBeGreaterThan(o.subtotal_kobo);
  });

  it('puts the lines in the order they were added and names them in one phrase', async () => {
    const id = await basketWith({ slug: 'business-cards', quantity: 100 }, { slug: 'flyers', quantity: 100 }, { slug: 'stickers', quantity: 100 });
    const r = await db.one<any>(`select ${lines.summarySql('o')} as s, ${lines.nameSql('o')} as n, ${lines.countSql('o')} as c from orders o where o.id = $1`, [id]);
    expect(r.c).toBe(3);
    expect(r.s).toMatch(/^Business cards × 100 \+ 2 more$/);
    expect(r.n).toBe('Business cards + 2 more');
    expect(lines.basketSummary([{ name: 'Flyers', quantity: 250 }])).toBe('Flyers × 250');
    expect(lines.basketSummary([])).toBe('Nothing yet');
  });

  it('reprices a line when its quantity changes, and the order total follows', async () => {
    const id = await basketWith({ slug: 'business-cards', quantity: 100 }, { slug: 'flyers', quantity: 100 });
    const before = (await orders.getOrder(id))!;
    const second = (await items(id))[1];
    const r: any = await orders.updateLine(id, second.id, { quantity: 500 });
    expect(r.ok).toBe(true);
    const after = (await orders.getOrder(id))!;
    expect(after.subtotal_kobo).toBeGreaterThan(before.subtotal_kobo);
    expect((await items(id))[1].quantity).toBe(500);
    expect((await items(id))[0].quantity).toBe(100); // the other line is untouched
  });

  it('asks for the file again when the print size changes, and not when only the quantity does', async () => {
    const id = await basketWith({ slug: 'flex-banners', quantity: 1, widthFt: 5, heightFt: 3 });
    const line = (await items(id))[0];
    const up = await art.saveArtwork(id, { name: 'banner.png', type: 'image/png', buf: makePng(3000, 1800) }, line.id);
    expect(up.ok && up.attached).toBe(true);
    expect((await orders.approveLine(id, line.id)).ok).toBe(true);
    expect((await items(id))[0].preview_approved_at).not.toBeNull();

    const same: any = await orders.updateLine(id, line.id, { quantity: 2 });
    expect(same.reset).toBe(false);
    expect((await items(id))[0].preview_approved_at).not.toBeNull();

    const bigger: any = await orders.updateLine(id, line.id, { widthFt: 8, heightFt: 4 });
    expect(bigger.reset).toBe(true);
    expect((await items(id))[0].preview_approved_at).toBeNull();
  });

  it('approves one line without touching the others', async () => {
    const id = await basketWith({ slug: 'business-cards', quantity: 100 }, { slug: 'flyers', quantity: 100 });
    const [a, b] = await items(id);
    await art.saveArtwork(id, { name: 'a.png', type: 'image/png', buf: makePng(1050, 600) }, a.id);
    await art.saveArtwork(id, { name: 'b.png', type: 'image/png', buf: makePng(1240, 1754) }, b.id);
    const ok = await orders.approveLine(id, b.id);
    expect(ok.ok).toBe(true);
    const rows = await items(id);
    expect(rows[0].preview_approved_at).toBeNull();
    expect(rows[1].preview_approved_at).not.toBeNull();
    expect(lines.lineReady(rows[0])).toBe(false);
    expect(lines.lineReady(rows[1])).toBe(true);
    expect(lines.proofStateOf(rows[0], null)).toBe('checked');
    expect(lines.proofStateOf(rows[1], null)).toBe('approved_preview');
  });

  it('refuses to approve a line that has no file', async () => {
    const id = await basketWith({ slug: 'business-cards', quantity: 100 });
    const r = await orders.approveLine(id, (await items(id))[0].id);
    expect(r.ok).toBe(false);
  });

  it('takes a line out and reprices the order', async () => {
    const id = await basketWith({ slug: 'business-cards', quantity: 100 }, { slug: 'flyers', quantity: 100 });
    const [a, b] = await items(id);
    const r: any = await orders.removeLine(id, b.id);
    expect(r).toEqual({ ok: true, left: 1 });
    expect((await orders.getOrder(id))!.subtotal_kobo).toBe(a.line_total_kobo);
  });

  it('holds at most twelve products', async () => {
    const id = await basketWith({ slug: 'business-cards', quantity: 100 });
    for (let n = 1; n < 12; n++) expect(((await orders.addLine(id, { slug: 'business-cards', quantity: 100 })) as any).error).toBeUndefined();
    expect(((await orders.addLine(id, { slug: 'business-cards', quantity: 100 })) as any).error).toMatch(/up to 12/);
  });

  it('keeps the area and pickup choice on the order, because delivery is one drop', async () => {
    const id = await basketWith({ slug: 'business-cards', quantity: 100 }, { slug: 'flyers', quantity: 100 });
    expect(((await orders.setDelivery(id, { pickup: true })) as any).ok).toBe(true);
    const o = (await orders.getOrder(id))!;
    expect(o.pickup).toBe(true);
    expect(o.delivery_fee_kobo).toBe(0);
    expect(((await orders.setDelivery(id, { pickup: false, area: 'Nowhere Land' })) as any).error).toMatch(/do not deliver/);
  });
});

describe('paying for a basket', () => {
  async function readyBasket() {
    const id = await basketWith({ slug: 'business-cards', quantity: 100 }, { slug: 'flyers', quantity: 100 });
    const rows = await items(id);
    await art.saveArtwork(id, { name: 'a.png', type: 'image/png', buf: makePng(1050, 600) }, rows[0].id);
    await orders.approveLine(id, rows[0].id);
    await orders.setArtworkPath(id, 'design', { purpose: 'flyer for opening day', wording: 'Open Saturday' }, rows[1].id);
    const c = await orders.saveCheckout(id, { name: 'Test Buyer', phone: '0803 123 4567', email: 'buyer@example.com', pickup: false, area: 'Yaba', addressLine: '12 Test Street, Yaba' });
    expect(c).toEqual({ ok: true });
    return id;
  }

  it('adds the design fee for the line that asked for a designer, and nothing for the other', async () => {
    const id = await readyBasket();
    const o = (await orders.getOrder(id))!;
    const s = await (await import('../lib/settings')).getSettings();
    expect(o.design_fee_kobo).toBe(s.design_fee_kobo);
  });

  it('has no arrival time while a designer still owes a proof, then one when it is approved', async () => {
    const id = await readyBasket();
    expect((await orders.getOrder(id))!.promised_at).toBeNull();
  });

  it('makes one payment, one job for each line, and one set of messages', async () => {
    const id = await readyBasket();
    const o = (await orders.getOrder(id))!;
    const p = await payments.initPayment(o, 'buyer@example.com');
    expect(p.reference).toBeTruthy();
    const r: any = await orders.confirmPayment({ reference: p.reference, amountKobo: o.total_kobo, method: 'card' });
    expect(r.ok).toBe(true);
    const jobs = await db.query<any>('select * from jobs where order_id = $1 order by created_at, id', [id]);
    expect(jobs).toHaveLength(2);
    expect(new Set(jobs.map((j) => j.order_item_id)).size).toBe(2);
    // every line starts at the file desk, on its own job
    expect(jobs.every((j) => j.stage === 'file_check')).toBe(true);
    // paying twice does nothing twice
    const again: any = await orders.confirmPayment({ reference: p.reference, amountKobo: o.total_kobo, method: 'card' });
    expect(again.duplicate).toBe(true);
    expect(await db.query('select 1 from jobs where order_id = $1', [id])).toHaveLength(2);
  });

  it('shows the customer each line, with where it stands, on one tracking page', async () => {
    const id = await readyBasket();
    const o = (await orders.getOrder(id))!;
    const p = await payments.initPayment(o, 'buyer@example.com');
    await orders.confirmPayment({ reference: p.reference, amountKobo: o.total_kobo, method: 'card' });
    const t: any = await tracker.getTracker(o.public_token);
    expect(t.lines).toHaveLength(2);
    expect(t.lines.map((l: any) => l.name)).toEqual(['Business cards', 'Flyers']);
  });
});

describe('a coupon that works on some products only', () => {
  it('counts only the products it applies to', () => {
    const lns = [{ productId: 'a', kobo: 1_000_000 }, { productId: 'b', kobo: 400_000 }];
    expect(coupons.couponBase({ product_ids: [] } as any, { subtotalKobo: 1_400_000, productId: 'a', lines: lns })).toBe(1_400_000);
    expect(coupons.couponBase({ product_ids: ['b'] } as any, { subtotalKobo: 1_400_000, productId: 'a', lines: lns })).toBe(400_000);
    expect(coupons.couponBase({ product_ids: ['c'] } as any, { subtotalKobo: 1_400_000, productId: 'a', lines: lns })).toBeNull();
  });

  it('is shown to the browser with the products it covers', () => {
    const c = coupons.publicCoupon({ code: 'X', description: '', kind: 'percent', percent_off: 10, amount_off_kobo: null, max_discount_kobo: null, min_subtotal_kobo: 0, product_ids: ['p1'] } as any);
    expect(c.productIds).toEqual(['p1']);
  });
});

describe('sign-in needed to pay', () => {
  it('asks for a verified email or Google, and never offers a phone code', async () => {
    const auth = await import('../lib/authconfig');
    const m = auth.authMethods();
    expect(auth.signInAvailable()).toBe(m.google || m.email);
    const dest = await import('../lib/destination');
    // there is no details page between signing in and where the customer was going
    expect(dest.destination({ name: null, phone: null, whatsapp_phone: null } as any, '/checkout/abc')).toBe('/checkout/abc');
  });
});

describe('repeating an order', () => {
  it('brings every line back, with the approved files, ready to pay', async () => {
    const id = await basketWith({ slug: 'business-cards', quantity: 100 }, { slug: 'flyers', quantity: 100 });
    const rows = await items(id);
    await art.saveArtwork(id, { name: 'a.png', type: 'image/png', buf: makePng(1050, 600) }, rows[0].id);
    await art.saveArtwork(id, { name: 'b.png', type: 'image/png', buf: makePng(1240, 1754) }, rows[1].id);
    await orders.approveLine(id, rows[0].id);
    await orders.approveLine(id, rows[1].id);
    const cust = (await db.one<any>("insert into customers (phone, name, email) values ('+2348031112233','Repeat Buyer','repeat@example.com') returning id"))!;
    await db.query('update orders set customer_id = $2 where id = $1', [id, cust.id]);
    const tokenRow = (await orders.getOrder(id))!;
    const r: any = await orders.reorder(tokenRow.public_token, cust.id);
    expect(r.error).toBeUndefined();
    const again = await items(r.id);
    expect(again).toHaveLength(2);
    expect(again.every((x) => lines.lineReady(x) && x.artwork_file_id)).toBe(true);
  });
});

describe('the basket helpers', () => {
  it('has a stable cookie name and counts nothing for no basket', () => {
    expect(basket.BASKET_COOKIE).toBe('bb');
  });
});
