import { beforeAll, describe, expect, it } from 'vitest';
import { deflateSync, crc32 } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';

process.env.PGLITE_DIR = 'memory';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-test-${process.pid}`);
delete process.env.PAYSTACK_SECRET_KEY;

// A real, valid greyscale PNG of any size (all black), built with no image library.
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
let jobs: typeof import('../lib/jobs');
let payments: typeof import('../lib/payments');
let art: typeof import('../lib/artwork');
let claims: typeof import('../lib/claims');
let sweep: typeof import('../lib/sweep');
let settings: typeof import('../lib/settings');
let reports: typeof import('../lib/reports');

const actor = async (email: string) => (await db.one<any>('select id, name, role, press_id from staff where email = $1', [email]))!;

async function prepareOrder(opts: { slug?: string; quantity?: number; area?: string; pickup?: boolean; design?: boolean; widthFt?: number; heightFt?: number } = {}) {
  const d: any = await orders.createDraft({ slug: opts.slug ?? 'business-cards', quantity: opts.quantity ?? 100, area: opts.area ?? 'Yaba', pickup: opts.pickup, widthFt: opts.widthFt, heightFt: opts.heightFt });
  expect(d.error).toBeUndefined();
  if (opts.design) await orders.setArtworkPath(d.id, 'design', { purpose: 'test' });
  else {
    const up = await art.saveArtwork(d.id, { name: 'card.png', type: 'image/png', buf: makePng(1050, 600) });
    expect(up.ok && up.attached).toBe(true);
  }
  const c = await orders.saveCheckout(d.id, { name: 'Test Buyer', phone: '0803 123 4567', email: 'buyer@example.com', pickup: !!opts.pickup, area: opts.area ?? 'Yaba', addressLine: '12 Test Street, Yaba' });
  expect(c).toEqual({ ok: true });
  return d.id as string;
}

async function payFor(id: string) {
  const o = (await orders.getOrder(id))!;
  const p = await payments.initPayment(o, 'buyer@example.com');
  const r = await orders.confirmPayment({ reference: p.reference, amountKobo: o.total_kobo, method: 'card' });
  expect(r.ok).toBe(true);
  const job = (await db.one<any>('select * from jobs where order_id = $1', [id]))!;
  return { id, jobId: job.id as string, order: (await orders.getOrder(id))! };
}

async function paidOrder(opts: Parameters<typeof prepareOrder>[0] = {}) {
  return payFor(await prepareOrder(opts));
}

beforeAll(async () => {
  db = await import('../lib/db');
  orders = await import('../lib/orders');
  jobs = await import('../lib/jobs');
  payments = await import('../lib/payments');
  art = await import('../lib/artwork');
  claims = await import('../lib/claims');
  sweep = await import('../lib/sweep');
  settings = await import('../lib/settings');
  reports = await import('../lib/reports');
  await db.ready();
});

describe('draft, upload and checkout', () => {
  it('prices on the server and holds a promise', async () => {
    const d: any = await orders.createDraft({ slug: 'business-cards', quantity: 100, area: 'Yaba' });
    const o = (await orders.getOrder(d.id))!;
    expect(o.subtotal_kobo).toBe(1_500_000);
    expect(o.delivery_fee_kobo).toBe(150_000);
    expect(o.total_kobo).toBe(1_650_000);
    expect(o.code).toMatch(/^BR-\d+$/);
    expect(o.speed).toBe('24h');
  });
  it('a 5 x 3 ft flex banner is ₦10,500 and the outer zone is standard delivery', async () => {
    const d: any = await orders.createDraft({ slug: 'flex-banners', quantity: 1, widthFt: 5, heightFt: 3, area: 'Ikorodu' });
    const o = (await orders.getOrder(d.id))!;
    expect(o.subtotal_kobo).toBe(1_050_000);
    expect(o.speed).toBe('standard');
    expect(o.promise_reasons).toContain('ZONE');
  });
  it('rejects a quantity with no price instead of guessing', async () => {
    // Below the smallest order, and above the largest one taken online: no price, so no order.
    expect((await orders.createDraft({ slug: 'business-cards', quantity: 20 }) as any).error).toBeTruthy();
    expect((await orders.createDraft({ slug: 'business-cards', quantity: 9000 }) as any).error).toBeTruthy();
  });
  it('prices a quantity between two steps at the per-piece price of the step below', async () => {
    const d: any = await orders.createDraft({ slug: 'business-cards', quantity: 150 });
    expect(d.error).toBeFalsy();
    const o = (await orders.getOrder(d.id))!;
    // 100 cards are ₦15,000, so ₦150 a card; 150 cards are ₦22,500, which is below the next step.
    expect(o.subtotal_kobo).toBe(2_250_000);
  });
  it('stops a blurry logo, keeps it off the order, and says why in plain words', async () => {
    const d: any = await orders.createDraft({ slug: 'business-cards', quantity: 100 });
    const up = await art.saveArtwork(d.id, { name: 'logo.png', type: 'image/png', buf: makePng(200, 114) });
    expect(up.ok).toBe(true);
    if (up.ok) {
      expect(up.check.status).toBe('stop');
      expect(up.attached).toBe(false);
      expect(up.check.headline.toLowerCase()).toContain('blurry');
    }
    expect((await orders.getItem(d.id))!.artwork_file_id).toBeNull();
  });
  it('rejects a file that only claims to be an image', async () => {
    const d: any = await orders.createDraft({ slug: 'business-cards', quantity: 100 });
    const up = await art.saveArtwork(d.id, { name: 'virus.png', type: 'image/png', buf: Buffer.from('MZ not an image at all') });
    expect(up.ok && up.attached).toBe(false);
  });
  it('recommends the largest frame a photo prints sharp at', async () => {
    const d: any = await orders.createDraft({ slug: 'picture-frames', quantity: 1, sizeKey: '24x36', area: 'Yaba' });
    const up = await art.saveArtwork(d.id, { name: 'photo.png', type: 'image/png', buf: makePng(3000, 4000) });
    expect(up.ok && up.suggestion?.key).toBe('12x16');
  });
  it('validates the phone number and the delivery area', async () => {
    const d: any = await orders.createDraft({ slug: 'business-cards', quantity: 100 });
    const bad = await orders.saveCheckout(d.id, { name: 'A B', phone: '12345', email: 'a@b.co', pickup: true });
    expect(bad.ok).toBe(false);
    const noArea = await orders.saveCheckout(d.id, { name: 'A B', phone: '08031234567', email: 'a@b.co', pickup: false, addressLine: 'some street here' });
    expect(noArea.ok).toBe(false);
    const pick = await orders.saveCheckout(d.id, { name: 'A B', phone: '08031234567', email: 'a@b.co', pickup: true });
    expect(pick.ok).toBe(true);
    expect((await orders.getOrder(d.id))!.delivery_fee_kobo).toBe(0);
  });
});

describe('payment', () => {
  it('only the exact amount makes an order paid, and a repeat creates no second job', async () => {
    const d: any = await orders.createDraft({ slug: 'business-cards', quantity: 100, area: 'Yaba' });
    await art.saveArtwork(d.id, { name: 'c.png', type: 'image/png', buf: makePng(1050, 600) });
    await orders.saveCheckout(d.id, { name: 'Pay Test', phone: '08031230000', email: 'p@t.co', pickup: false, area: 'Yaba', addressLine: '1 Pay Street' });
    const o = (await orders.getOrder(d.id))!;
    const p = await payments.initPayment(o, 'p@t.co');

    expect((await orders.confirmPayment({ reference: 'nope', amountKobo: o.total_kobo })).ok).toBe(false);
    const wrong = await orders.confirmPayment({ reference: p.reference, amountKobo: o.total_kobo - 100 });
    expect(wrong).toEqual({ ok: false, reason: 'AMOUNT_MISMATCH' });
    expect((await orders.getOrder(d.id))!.status).toBe('awaiting_payment');

    const p2 = await payments.initPayment(o, 'p@t.co');
    expect((await orders.confirmPayment({ reference: p2.reference, amountKobo: o.total_kobo })).ok).toBe(true);
    const again: any = await orders.confirmPayment({ reference: p2.reference, amountKobo: o.total_kobo });
    expect(again.ok && again.duplicate).toBe(true);
    const jobs = await db.query('select * from jobs where order_id = $1', [d.id]);
    expect(jobs.length).toBe(1);
    expect(jobs[0].stage).toBe('file_check');
    const msgs = await db.query("select * from messages where order_id = $1 and template = 'paid'", [d.id]);
    expect(msgs.length).toBe(1);
    expect(msgs[0].status).toBe('logged');
  });
  it('verifies Paystack webhook signatures', () => {
    const body = JSON.stringify({ event: 'charge.success' });
    const sig = createHmac('sha512', 'sk_test_x').update(body).digest('hex');
    expect(payments.verifyPaystackSignature(body, sig, 'sk_test_x')).toBe(true);
    expect(payments.verifyPaystackSignature(body + ' ', sig, 'sk_test_x')).toBe(false);
    expect(payments.verifyPaystackSignature(body, 'abc', 'sk_test_x')).toBe(false);
    expect(payments.verifyPaystackSignature(body, null, 'sk_test_x')).toBe(false);
  });
  it('when the 24-hour slots fill up, the next payer is moved to standard and told', async () => {
    const q: any = await (await import('../lib/quote')).makeQuote({ slug: 'business-cards', quantity: 100, area: 'Yaba' });
    const used = await (await import('../lib/quote')).slotsUsedOn(q.productionDay);
    await settings.setSetting('daily_24h_slots', used + 1); // exactly one slot left today
    try {
      // Two customers are at checkout at the same time, both shown a 24-hour promise. One slot is left.
      const idA = await prepareOrder();
      const idB = await prepareOrder();
      expect((await orders.getOrder(idA))!.speed).toBe('24h');
      expect((await orders.getOrder(idB))!.speed).toBe('24h');
      const a = await payFor(idA);
      const b = await payFor(idB);
      expect(a.order.speed).toBe('24h');
      expect(b.order.speed).toBe('standard'); // never oversold
      const told = await db.query("select * from messages where order_id = $1 and template = 'new_time'", [b.id]);
      expect(told.length).toBe(1);
      expect(told[0].body).toContain('Your arrival time has changed');
    } finally {
      await settings.setSetting('daily_24h_slots', 15);
    }
  });
});

describe('the job pipeline', () => {
  it('walks a job from payment to delivery with every rule enforced', async () => {
    const { id, jobId } = await paidOrder();
    const desk = await actor('files@brandit.test');
    const lead = await actor('lead@brandit.test');
    const dispatcher = await actor('dispatch@brandit.test');
    const press = await actor('press@brandit.test');
    const support = await actor('support@brandit.test');

    // The file desk cannot pass a file the customer has not approved a preview for.
    await expect(jobs.moveJob(jobId, 'printing', { actor: desk })).rejects.toThrow(/approved the preview/);
    await db.query('update order_items set preview_approved_at = now() where order_id = $1', [id]);
    // Support cannot pass files; a skipped stage is refused.
    await expect(jobs.moveJob(jobId, 'printing', { actor: support })).rejects.toThrow(/file desk/);
    await expect(jobs.moveJob(jobId, 'quality_check', { actor: lead })).rejects.toThrow(/cannot go from/);
    await jobs.moveJob(jobId, 'printing', { actor: desk });

    // A partner press cannot touch a job at the hub.
    await expect(jobs.moveJob(jobId, 'quality_check', { actor: press })).rejects.toThrow(/another press/);
    await jobs.moveJob(jobId, 'quality_check', { actor: lead });

    // No finished-job photo, no dispatch.
    await expect(jobs.moveJob(jobId, 'out_for_delivery', { actor: lead })).rejects.toThrow(/photo/);
    const item = (await orders.getItem(id))!;
    await art.saveSimpleFile(id, item.id, 'qc_photo', { name: 'done.png', type: 'image/png', buf: makePng(40, 40) });
    await expect(jobs.moveJob(jobId, 'out_for_delivery', { actor: lead })).rejects.toThrow(/rider/);
    await jobs.saveDelivery(id, dispatcher, { rider_name: 'Musa', rider_phone: '08030000000' });
    await jobs.moveJob(jobId, 'out_for_delivery', { actor: lead });

    // The delivery code ends the job. A wrong code does not.
    await expect(jobs.completeWithCode(jobId, '0000x')).rejects.toThrow(/does not match/);
    const code = (await orders.getOrder(id))!.delivery_code;
    await jobs.completeWithCode(jobId, code);

    const o = (await orders.getOrder(id))!;
    expect(o.status).toBe('delivered');
    expect(o.delivered_at).toBeTruthy();
    const trail = await db.query('select to_stage from job_events where job_id = $1 order by id', [jobId]);
    expect(trail.map((e: any) => e.to_stage)).toEqual(['paid', 'file_check', 'printing', 'quality_check', 'out_for_delivery', 'delivered']);
    const msgs = (await db.query('select template from messages where order_id = $1', [id])).map((m: any) => m.template);
    for (const t of ['paid', 'file_checked', 'out_for_delivery', 'delivered']) expect(msgs).toContain(t);
  });

  it('flagging a file pauses the clock; a new file and approval resume it', async () => {
    const { id, jobId } = await paidOrder();
    const desk = await actor('files@brandit.test');
    await expect(jobs.flagFile(jobId, desk, '  ')).rejects.toThrow();
    await jobs.flagFile(jobId, desk, 'The logo is cut off on the right edge.');
    let job = (await db.one<any>('select * from jobs where id = $1', [jobId]))!;
    expect(job.clock_paused).toBe(true);
    const msg = (await db.one<any>("select body from messages where order_id = $1 and template = 'file_problem'", [id]))!;
    expect(msg.body).toContain('logo is cut off');
    expect(msg.body).toContain(`/order/${id}/artwork`);

    await art.saveArtwork(id, { name: 'fixed.png', type: 'image/png', buf: makePng(1050, 600) });
    await db.query('update order_items set preview_approved_at = now() where order_id = $1', [id]);
    await jobs.moveJob(jobId, 'printing', { actor: desk });
    job = (await db.one<any>('select * from jobs where id = $1', [jobId]))!;
    expect(job.clock_paused).toBe(false);
    expect(job.stage).toBe('printing');
  });

  it('a design job gets its arrival time when the customer approves the proof', async () => {
    const { id, jobId, order } = await paidOrder({ design: true });
    expect(order.promised_at).toBeNull();
    expect(order.design_fee_kobo).toBe(1_200_000);
    const desk = await actor('files@brandit.test');
    const item = (await orders.getItem(id))!;
    const proofFile = await art.saveSimpleFile(id, item.id, 'proof', { name: 'proof.png', type: 'image/png', buf: makePng(60, 40) });
    if (!proofFile.ok) throw new Error('proof upload failed');
    const { token } = await jobs.sendProof(jobId, desk, proofFile.fileId);
    expect((await db.one<any>('select stage, clock_paused from jobs where id = $1', [jobId]))).toMatchObject({ stage: 'proof', clock_paused: true });

    const changes = await jobs.decideProof(token, 'changes_requested', 'Make the logo bigger');
    expect(changes.ok).toBe(true);
    expect((await jobs.decideProof(token, 'approved')).ok).toBe(false); // already answered
    const second = await jobs.sendProof(jobId, desk, proofFile.fileId);
    expect((await jobs.decideProof(token, 'approved')).ok).toBe(false); // the old link no longer works
    expect((await jobs.decideProof(second.token, 'approved')).ok).toBe(true);

    const o = (await orders.getOrder(id))!;
    expect(o.promised_at).toBeTruthy();
    expect(o.status).toBe('in_production');
    expect((await db.one<any>('select stage from jobs where id = $1', [jobId]))!.stage).toBe('printing');
  });
});

describe('the Promise, automated', () => {
  it('a late 24-hour order refunds its delivery fee by itself, once', async () => {
    const { id, order } = await paidOrder();
    expect(order.speed).toBe('24h');
    await db.query("update orders set promised_at = now() - interval '1 hour' where id = $1", [id]);
    const first = await sweep.runSweep();
    expect(first.late).toBeGreaterThanOrEqual(1);
    const claim = (await db.one<any>("select * from claims where order_id = $1 and kind = 'late'", [id]))!;
    expect(claim.source).toBe('system');
    expect(claim.resolution).toBe('delivery_refund');
    expect(claim.cost_kobo).toBe(150_000);
    const refund = (await db.one<any>("select * from payments where order_id = $1 and status = 'refund'", [id]))!;
    expect(refund.amount_kobo).toBe(-150_000);
    expect((await db.one<any>("select template from messages where order_id = $1 and template = 'late_refund'", [id]))).toBeTruthy();
    await sweep.runSweep();
    expect((await db.query("select * from claims where order_id = $1 and kind = 'late'", [id])).length).toBe(1);
    expect((await db.query("select * from payments where order_id = $1 and status = 'refund'", [id])).length).toBe(1);
  });

  it('marks jobs at risk before they are late, but not paused ones', async () => {
    const { id, jobId } = await paidOrder();
    await db.query("update orders set promised_at = now() + interval '2 hours' where id = $1", [id]);
    await sweep.runSweep();
    expect((await db.one<any>('select at_risk from jobs where id = $1', [jobId]))!.at_risk).toBe(true);
    const lead = await actor('lead@brandit.test');
    void lead;
  });

  it('a problem report reaches the Promise desk; a reprint sends the job back to the press', async () => {
    const { id, jobId, order } = await paidOrder();
    const desk = await actor('files@brandit.test');
    const lead = await actor('lead@brandit.test');
    const dispatcher = await actor('dispatch@brandit.test');
    await db.query('update order_items set preview_approved_at = now() where order_id = $1', [id]);
    await jobs.moveJob(jobId, 'printing', { actor: desk });
    await jobs.moveJob(jobId, 'quality_check', { actor: lead });
    const item = (await orders.getItem(id))!;
    await art.saveSimpleFile(id, item.id, 'qc_photo', { name: 'q.png', type: 'image/png', buf: makePng(40, 40) });
    await jobs.saveDelivery(id, dispatcher, { rider_name: 'Musa' });
    await jobs.moveJob(jobId, 'out_for_delivery', { actor: lead });
    await jobs.completeWithCode(jobId, order.delivery_code);

    const early = await claims.createClaim(order.public_token, { kind: 'wrong_print', description: '' });
    expect(early.ok).toBe(false);
    const c = await claims.createClaim(order.public_token, { kind: 'wrong_print', description: 'The colours are much darker than my file.' });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const support = await actor('support@brandit.test');
    await expect(claims.resolveClaim(c.id, support, { resolution: 'reprint' })).rejects.toThrow();
    await expect(claims.resolveClaim(c.id, lead, { resolution: 'rejected' })).rejects.toThrow(/reason/);
    await claims.resolveClaim(c.id, lead, { resolution: 'reprint', note: 'Colour profile problem on our side' });
    const j = (await db.one<any>('select stage, reprint_count from jobs where id = $1', [jobId]))!;
    expect(j.stage).toBe('printing');
    expect(j.reprint_count).toBe(1);
    const cl = (await db.one<any>('select * from claims where id = $1', [c.id]))!;
    expect(cl.status).toBe('resolved');
    expect(cl.cost_kobo).toBeGreaterThan(0);
  });

  it('same again: copies the order and its approved file at today\'s price', async () => {
    const { id, order } = await paidOrder();
    await db.query('update order_items set preview_approved_at = now() where order_id = $1', [id]);
    const cust = (await db.one<any>('select id from customers where id = $1', [order.customer_id]))!;
    const again: any = await orders.reorder(order.public_token, cust.id);
    expect(again.id).toBeTruthy();
    const item = (await orders.getItem(again.id))!;
    expect(item.artwork_file_id).toBeTruthy();
    expect(item.preview_approved_at).toBeTruthy();
    expect((await orders.reorder(order.public_token, '00000000-0000-0000-0000-000000000000') as any).error).toBeTruthy();
  });

  it('public scores stay hidden until there are enough deliveries', async () => {
    const s = await reports.scores();
    expect(s.onTime).toBeNull();
    expect(s.needed).toBe(30);
  });
});
