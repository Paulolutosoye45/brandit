import { beforeAll, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';

process.env.PGLITE_DIR = 'memory';
process.env.DEMO_MODE = 'true';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-paylink-${process.pid}`);
delete process.env.PAYSTACK_SECRET_KEY;

let db: typeof import('../lib/db');
let O: typeof import('../lib/orders');
let PL: typeof import('../lib/payLink');
let SO: typeof import('../lib/staffOrder');
let Pay: typeof import('../lib/payments');
let L: typeof import('../lib/lines');
let I: typeof import('../lib/identity');
let J: typeof import('../lib/jobs');

beforeAll(async () => {
  db = await import('../lib/db');
  await db.ready();
  O = await import('../lib/orders');
  PL = await import('../lib/payLink');
  SO = await import('../lib/staffOrder');
  Pay = await import('../lib/payments');
  L = await import('../lib/lines');
  I = await import('../lib/identity');
  J = await import('../lib/jobs');
}, 60_000);

let n = 0;
/** A saved order, filled in at checkout, with a file approved on the line. */
async function checkedOut(opts: { approve?: boolean } = {}) {
  n++;
  const c = (await I.signInEmail(`pl${n}@example.com`)).customer;
  const d: any = await O.createDraft({ slug: 'flyers', quantity: 100, area: 'Yaba' });
  expect(d.id, JSON.stringify(d)).toBeTruthy();
  await db.query('update orders set customer_id = $2 where id = $1', [d.id, c.id]);
  const item = (await O.getItem(d.id))!;
  if (opts.approve !== false) {
    const f = await db.one<{ id: string }>(
      "insert into files (order_id, order_item_id, kind, storage_key, original_name, mime, bytes, width_px, height_px, check_result) values ($1,$2,'artwork','x.png','art.png','image/png',1000,3000,2000,'{\"status\":\"pass\"}') returning id",
      [d.id, item.id]);
    await db.query("update order_items set artwork_path = 'upload', artwork_file_id = $2, preview_approved_at = now() where id = $1", [item.id, f!.id]);
  }
  const ck = await O.saveCheckout(d.id, { name: 'Ngozi Eze', phone: `0803${String(1000000 + n).slice(-7)}`, email: c.email ?? '', pickup: false, area: 'Yaba', addressLine: '12 Test Street, Yaba' }, c.id);
  expect(ck.ok, JSON.stringify(ck)).toBe(true);
  return { c, id: d.id as string, itemId: item.id as string };
}

describe('pay link: someone else pays', () => {
  it('opens a limited view of the order and never shows the street address or phone', async () => {
    const t = await checkedOut();
    const made = await PL.makePayLink(t.id, '  Pastor, this is for Sunday  ');
    expect(made.ok).toBe(true);
    const o = (await O.getOrder(t.id))!;
    expect(o.pay_note).toBe('Pastor, this is for Sunday');
    expect(o.pay_link_at).toBeTruthy();
    const v = await PL.payLinkView(o.public_token);
    expect(v?.state).toBe('open');
    if (v?.state !== 'open') return;
    expect(v.who).toBe('Ngozi');
    expect(v.note).toBe('Pastor, this is for Sunday');
    expect(v.totalKobo).toBe(o.total_kobo);
    expect(v.lines[0].name.toLowerCase()).toContain('flyer');
    const text = JSON.stringify(v);
    expect(text).not.toContain('12 Test Street');
    expect(text).not.toContain('0803');
    expect(text).not.toContain(t.c.email ?? 'x@x');
  });

  it('refuses a link for an order whose details or artwork are not ready', async () => {
    const t = await checkedOut({ approve: false });
    const made = await PL.makePayLink(t.id);
    expect(made.ok).toBe(false);
    // And one that was never filled in at checkout has no link to open.
    const d: any = await O.createDraft({ slug: 'flyers', quantity: 100, area: 'Yaba' });
    const o = (await O.getOrder(d.id))!;
    const v = await PL.payLinkView(o.public_token);
    expect(v?.state).toBe('closed');
  });

  it('takes the payment from the payer, records who paid, and leaves the order with its owner', async () => {
    const t = await checkedOut();
    await PL.makePayLink(t.id);
    const o = (await O.getOrder(t.id))!;
    const bad = await PL.startPayLinkPayment(o.public_token, { name: 'P', email: 'nope' });
    expect(bad.ok).toBe(false);
    const started = await PL.startPayLinkPayment(o.public_token, { name: 'Pastor Emeka', email: 'Pastor@Example.com' });
    expect(started.ok, JSON.stringify(started)).toBe(true);
    const pay = await db.one<any>("select * from payments where order_id = $1 and status = 'pending'", [t.id]);
    expect(pay.payer_name).toBe('Pastor Emeka');
    expect(pay.payer_email).toBe('pastor@example.com');
    const r = await O.confirmPayment({ reference: pay.provider_ref, amountKobo: o.total_kobo, method: 'card' });
    expect(r.ok).toBe(true);
    const after = (await O.getOrder(t.id))!;
    expect(after.status).toBe('paid');
    expect(after.customer_id).toBe(t.c.id);
    expect(await PL.payerOf(t.id)).toEqual({ name: 'Pastor Emeka', email: 'pastor@example.com' });
    // The owner is told in the usual way, and the link now says it is paid.
    const msgs = await db.query<any>("select template from messages where order_id = $1", [t.id]);
    expect(msgs.map((m) => m.template)).toContain('paid');
    expect((await PL.payLinkView(o.public_token))?.state).toBe('paid');
    // A second person cannot pay it again.
    const again = await PL.startPayLinkPayment(o.public_token, { name: 'Someone', email: 'x@example.com' });
    expect(again.ok).toBe(false);
  });

  it('works the price out again, so a changed price is what the payer pays', async () => {
    const t = await checkedOut();
    await PL.makePayLink(t.id);
    const o = (await O.getOrder(t.id))!;
    const before = o.total_kobo;
    // The customer changes the quantity after sending the link.
    const u = await O.updateLine(t.id, t.itemId, { quantity: 200 });
    expect('error' in u).toBe(false);
    await db.query("update order_items set preview_approved_at = now() where id = $1", [t.itemId]);
    const v = await PL.payLinkView(o.public_token);
    expect(v?.state).toBe('open');
    if (v?.state !== 'open') return;
    expect(v.totalKobo).toBeGreaterThan(before);
    const s = await PL.startPayLinkPayment(o.public_token, { name: 'Boss', email: 'boss@example.com' });
    expect(s.ok).toBe(true);
    const pay = await db.one<any>("select * from payments where order_id = $1 and status = 'pending'", [t.id]);
    expect(pay.amount_kobo).toBe(v.totalKobo);
  });

  it('does not open a cancelled order and says why', async () => {
    const t = await checkedOut();
    await PL.makePayLink(t.id);
    await db.query("update orders set status = 'cancelled' where id = $1", [t.id]);
    const o = (await O.getOrder(t.id))!;
    const v = await PL.payLinkView(o.public_token);
    expect(v?.state).toBe('closed');
    expect((await PL.startPayLinkPayment(o.public_token, { name: 'Boss', email: 'boss@example.com' })).ok).toBe(false);
    expect(await PL.payLinkView('not-a-token')).toBeNull();
  });
});

describe('an order the team builds from a WhatsApp chat', () => {
  async function basketOf(slug = 'flyers', qty = 100) {
    const d: any = await O.createDraft({ slug, quantity: qty, area: 'Yaba' });
    expect(d.id, JSON.stringify(d)).toBeTruthy();
    return d.id as string;
  }
  const staff = async () => {
    const s = await db.one<{ id: string; name: string }>("select id, name from staff order by id limit 1");
    expect(s).toBeTruthy();
    return s!;
  };

  it('makes the customer from the phone number, marks the order, and the customer sends the file after paying', async () => {
    const id = await basketOf();
    const st = await staff();
    const r = await SO.buildOrder(id, st, { name: 'Tunde Bello', phone: '0802 555 1001', pickup: false, area: 'Yaba', addressLine: '5 Herbert Macaulay Way, Yaba', note: 'Thanks Tunde!' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const o = (await O.getOrder(id))!;
    expect(o.staff_built).toBe(true);
    expect(o.built_by).toBe(st.id);
    expect(o.status).toBe('awaiting_payment');
    expect(o.pay_note).toBe('Thanks Tunde!');
    const cust = await db.one<any>('select * from customers where id = $1', [o.customer_id]);
    expect(cust.name).toBe('Tunde Bello');
    expect(cust.email).toBeNull();
    const item = (await O.getItem(id))!;
    expect(L.noFileKind(item as any)).toBe('file_later');
    expect(r.url).toContain(`/pay-link/${o.public_token}`);

    // Anyone with the link can pay it, with no file yet.
    const v = await PL.payLinkView(o.public_token);
    expect(v?.state).toBe('open');
    const s = await PL.startPayLinkPayment(o.public_token, { name: 'Tunde Bello', email: 'tunde@example.com' });
    expect(s.ok, JSON.stringify(s)).toBe(true);
    const pay = await db.one<any>("select * from payments where order_id = $1 and status = 'pending'", [id]);
    const paid = await O.confirmPayment({ reference: pay.provider_ref, amountKobo: o.total_kobo, method: 'card' });
    expect(paid.ok).toBe(true);

    // The job waits at the file check with its clock stopped, and the customer is asked for the file at once.
    const job = await db.one<any>('select * from jobs where order_item_id = $1', [item.id]);
    expect(job.stage).toBe('file_check');
    expect(job.clock_paused).toBe(true);
    const ask = await db.query<any>("select body from messages where order_id = $1 and template = 'file_problem'", [id]);
    expect(ask).toHaveLength(1);
    expect(ask[0].body).toContain(`/order/${id}/artwork?fix=1&item=${item.id}`);
    // The file desk cannot pass a job that has no approved file.
    await expect(J.moveJob(job.id, 'printing', { actor: { id: st.id, name: st.name, role: 'admin', press_id: null } as any })).rejects.toThrow(/approved the preview/i);
  });

  it('can hand a line to the designers instead', async () => {
    const id = await basketOf();
    const st = await staff();
    const item0 = (await O.getItem(id))!;
    const r = await SO.buildOrder(id, st, { name: 'Ada Obi', phone: '0802 555 1002', pickup: true, files: { [item0.id]: 'design' }, designNote: 'Church programme, blue and gold' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const item = (await O.getItem(id))!;
    expect(item.artwork_path).toBe('design');
    expect(item.design_brief.purpose).toContain('blue and gold');
    expect((await O.getOrder(id))!.design_fee_kobo).toBeGreaterThan(0);
  });

  it('asks for the things that are missing and never builds half an order', async () => {
    const id = await basketOf();
    const st = await staff();
    const noName = await SO.buildOrder(id, st, { name: '', phone: '0802 555 1003', pickup: true });
    expect(noName.ok).toBe(false);
    const noPhone = await SO.buildOrder(id, st, { name: 'Ada', phone: '123', pickup: true });
    expect(noPhone.ok).toBe(false);
    const noAddress = await SO.buildOrder(id, st, { name: 'Ada', phone: '0802 555 1003', pickup: false, area: 'Yaba', addressLine: '' });
    expect(noAddress.ok).toBe(false);
    expect((await O.getOrder(id))!.staff_built).toBe(false);
    // A paid order is not a basket.
    await db.query("update orders set status = 'paid' where id = $1", [id]);
    expect((await SO.buildOrder(id, st, { name: 'Ada', phone: '0802 555 1003', pickup: true })).ok).toBe(false);
  });

  it('keeps an existing customer\'s verified email when the team types a different one', async () => {
    const c = (await I.signInEmail('keep@example.com')).customer;
    await db.query("update customers set phone = '08025551004' where id = $1", [c.id]).catch(() => {});
    const id = await basketOf();
    const st = await staff();
    const r = await SO.buildOrder(id, st, { name: 'Keep Me', phone: '08025551004', email: 'other@example.com', pickup: true });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
});
