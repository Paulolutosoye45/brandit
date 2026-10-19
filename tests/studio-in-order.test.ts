import { beforeAll, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';

process.env.PGLITE_DIR = 'memory';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-studio-inorder-${process.pid}`);
delete process.env.PAYSTACK_SECRET_KEY;
for (const k of ['RECRAFT_API_KEY', 'BFL_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'FAL_KEY']) delete process.env[k];

let db: typeof import('../lib/db');
let P: typeof import('../lib/studio/projects');
let W: typeof import('../lib/studio/worker');
let B: typeof import('../lib/studio/purchases');
let IO: typeof import('../lib/studio/inOrder');
let R: typeof import('../lib/studio/reviews');
let A: typeof import('../lib/studio/attach');
let O: typeof import('../lib/orders');
let J: typeof import('../lib/jobs');
let Pay: typeof import('../lib/payments');
let I: typeof import('../lib/identity');
let L: typeof import('../lib/lines');
let F: typeof import('../lib/studio/fees');

let n = 0;
async function newCustomer() {
  n++;
  return (await I.signInEmail(`inorder${n}@example.com`)).customer;
}

const BRIEF = {
  occasion: 'owambe',
  lines: { who: 'Chief & Mrs Adéwálé Ọláńrewájú', what: '60th Birthday & Thanksgiving', date: 'Saturday 14 March 2026, 11am prompt', where: 'Eko Hotel & Suites, Victoria Island', rsvp: 'RSVP: 0803 123 4567' },
  look: 'plenty gold, ankara style', style: 'ankara', palette: 'royal-gold',
  choices: { font: 'montserrat', theme: 'auto', style: 'panels', photoShape: 'rounded' },
};

/** A signed-in customer with a basket line and a Studio design started from that line, words in and box ticked. */
async function started(slug = 'flyers', o: { words?: boolean } = {}) {
  const c = await newCustomer();
  const d: any = await O.createDraft({ slug, quantity: slug === 'flyers' ? 100 : 1, area: 'Yaba' });
  expect(d.id, JSON.stringify(d)).toBeTruthy();
  await db.query('update orders set customer_id = $2 where id = $1', [d.id, c.id]);
  const item = (await O.getItem(d.id))!;
  const line = await IO.lineForStudio(c.id, d.id, item.id);
  expect(line).toBeTruthy();
  const pr: any = await P.createProject(c, { productSlug: line!.slug, sizeKey: line!.sizeKey, widthFt: line!.widthFt, heightFt: line!.heightFt, quantity: line!.quantity, config: line!.config, occasion: 'owambe', orderId: d.id });
  expect(pr.ok, JSON.stringify(pr)).toBe(true);
  await IO.linkStarted(pr.project.id, item.id);
  if (o.words !== false) {
    const sb: any = await P.saveBrief(c, pr.project.id, BRIEF);
    expect(sb.ok, JSON.stringify(sb)).toBe(true);
    await P.setConsent(c, pr.project.id);
  }
  return { c, orderId: d.id as string, itemId: item.id as string, projectId: pr.project.id as string };
}

async function payOrder(c: any, orderId: string) {
  const ck = await O.saveCheckout(orderId, { name: 'Ada Obi', phone: '08031234567', email: c.email, pickup: false, area: 'Yaba', addressLine: '12 Test Street, Yaba' }, c.id);
  expect(ck.ok, JSON.stringify(ck)).toBe(true);
  const o = (await O.getOrder(orderId))!;
  const p = await Pay.initPayment(o, c.email);
  const r = await O.confirmPayment({ reference: p.reference, amountKobo: o.total_kobo, method: 'card' });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return { o, p, r };
}

beforeAll(async () => {
  db = await import('../lib/db');
  await db.ready();
  P = await import('../lib/studio/projects');
  W = await import('../lib/studio/worker');
  B = await import('../lib/studio/purchases');
  IO = await import('../lib/studio/inOrder');
  R = await import('../lib/studio/reviews');
  A = await import('../lib/studio/attach');
  O = await import('../lib/orders');
  J = await import('../lib/jobs');
  Pay = await import('../lib/payments');
  I = await import('../lib/identity');
  L = await import('../lib/lines');
  F = await import('../lib/studio/fees');
}, 60_000);

describe('the design is a line in the order', () => {
  it('prices the design as Studio\'s price less the print credit, inside the same order', async () => {
    const s = await (await import('../lib/settings')).getSettings();
    expect(F.studioFeeKobo(s, 'standard')).toBe(250_000 - 100_000);
    expect(F.studioFeeKobo(s, 'premium')).toBe(750_000 - 250_000);

    const t = await started();
    const before = (await O.getOrder(t.orderId))!;
    const add = await IO.addToOrder(t.c, t.projectId, 'standard');
    expect(add.ok, JSON.stringify(add)).toBe(true);
    const item = (await O.getItem(t.orderId))!;
    expect(item.artwork_path).toBe('studio');
    expect(item.studio_tier).toBe('standard');
    expect(item.studio_fee_kobo).toBe(150_000);
    const after = (await O.getOrder(t.orderId))!;
    expect(after.design_fee_kobo).toBe(150_000);
    expect(after.total_kobo).toBeGreaterThan(before.total_kobo);
    // An order with a Studio line has no arrival time until printing can start.
    expect(after.promised_at).toBeNull();
    expect(L.lineReady(item as any)).toBe(true);
    expect(await IO.studioProblem(t.orderId, t.c)).toBeNull();
  });

  it('will not add a design before the words are in and the box is ticked', async () => {
    const t = await started('flyers', { words: false });
    const r: any = await IO.addToOrder(t.c, t.projectId, 'standard');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Fill in|tick/i);
    expect((await O.getItem(t.orderId))!.studio_tier).toBeNull();
  });

  it('keeps checkout closed until a design is chosen, and asks for sign-in', async () => {
    const t = await started();
    expect(L.lineReady((await O.getItem(t.orderId))! as any)).toBe(false);
    expect(await IO.studioProblem(t.orderId, t.c)).toMatch(/Choose Standard or Premium/);
    await IO.addToOrder(t.c, t.projectId, 'standard');
    expect(await IO.studioProblem(t.orderId, null)).toMatch(/Sign in/);
  });

  it('takes a design out again and the price goes back', async () => {
    const t = await started();
    const base = (await O.getOrder(t.orderId))!.total_kobo;
    await IO.addToOrder(t.c, t.projectId, 'premium');
    expect((await O.getOrder(t.orderId))!.design_fee_kobo).toBe(500_000);
    const out = await IO.removeFromOrder(t.c, t.projectId);
    expect(out.ok).toBe(true);
    const item = (await O.getItem(t.orderId))!;
    expect(item.artwork_path).toBeNull();
    expect(item.studio_project_id).toBeNull();
    expect((await O.getOrder(t.orderId))!.total_kobo).toBe(base);
  });

  it('lets go of the design when the customer chooses another way to give the artwork', async () => {
    const t = await started();
    await IO.addToOrder(t.c, t.projectId, 'standard');
    await O.setArtworkPath(t.orderId, 'design', { purpose: 'Opening day', wording: 'Bisi Fabrics, 0803 000 0000' }, t.itemId);
    const item = (await O.getItem(t.orderId))!;
    expect(item.artwork_path).toBe('design');
    expect(item.studio_tier).toBeNull();
    expect(item.studio_fee_kobo).toBe(0);
    expect((await O.getOrder(t.orderId))!.design_fee_kobo).toBe((await (await import('../lib/settings')).getSettings()).design_fee_kobo);
  });

  it('does not let someone else add or remove a design', async () => {
    const t = await started();
    const other = await newCustomer();
    expect((await IO.addToOrder(other, t.projectId, 'standard')).ok).toBe(false);
    await IO.addToOrder(t.c, t.projectId, 'standard');
    expect((await IO.removeFromOrder(other, t.projectId)).ok).toBe(false);
    expect((await O.getItem(t.orderId))!.studio_tier).toBe('standard');
  });
});

describe('one payment, then Studio, then print', () => {
  it('pays once, starts the design, holds the print, and releases it when the design is approved', async () => {
    const t = await started();
    await IO.addToOrder(t.c, t.projectId, 'standard');
    const { o } = await payOrder(t.c, t.orderId);

    // The payment is the order's own. Studio has a receipt for the design part and has started.
    const pu = await db.query<any>('select * from studio_purchases where project_id = $1', [t.projectId]);
    expect(pu).toHaveLength(1);
    expect(pu[0]).toMatchObject({ sku: 'standard', amount_kobo: 150_000, method: 'order', status: 'paid', order_id: t.orderId });
    const proj = (await P.getProject(t.projectId))!;
    expect(proj.tier).toBe('standard');
    expect(proj.credit_kobo).toBe(0); // the credit was taken off up front
    expect((await db.one<any>('select studio_project_id from orders where id = $1', [t.orderId]))!.studio_project_id).toBe(t.projectId);

    // The print line waits and its clock is stopped.
    const job = (await db.one<any>('select * from jobs where order_item_id = $1', [t.itemId]))!;
    expect(job.stage).toBe('file_check');
    expect(job.clock_paused).toBe(true);
    expect(job.paused_reason).toBe(F.STUDIO_WAIT);
    expect((await O.getOrder(t.orderId))!.promised_at).toBeNull();
    await expect(J.moveJob(job.id, 'printing', { actor: { id: 'x', name: 'Desk', role: 'admin', press_id: null } as any })).rejects.toThrow(/preview/i);

    // Studio makes the designs.
    await W.drainAll();
    const concepts = (await P.versionsOf(t.projectId)).filter((v) => v.kind === 'concept');
    expect(concepts).toHaveLength(4);

    // Paying again, or the sweep running, changes nothing.
    const again = await O.confirmPayment({ reference: (await db.one<any>("select provider_ref from payments where order_id = $1 and status = 'success'", [t.orderId]))!.provider_ref, amountKobo: o.total_kobo });
    expect(again.ok && again.duplicate).toBe(true);
    await IO.sweepStudioLines();
    expect(await db.query('select 1 from studio_purchases where project_id = $1', [t.projectId])).toHaveLength(1);
    expect(await IO.attachApproved(t.projectId)).toBe('not_ready');

    // The customer picks and approves one. The print file goes onto the line by itself.
    const pick = concepts[0];
    expect(((await P.requestFinish(t.c, t.projectId, pick.id)) as any).ok).toBe(true);
    await W.drainAll();
    const ap: any = await P.approve(t.c, t.projectId, pick.id, { spellingConfirmed: true });
    expect(ap.ok, JSON.stringify(ap)).toBe(true);
    expect(ap.review).toBe(false);

    const item = (await O.getItem(t.orderId))!;
    expect(item.artwork_path).toBe('upload');
    expect(item.artwork_file_id).toBeTruthy();
    expect(item.preview_approved_at).not.toBeNull();
    expect(item.studio_version_id).toBe(pick.id);
    const j2 = (await db.one<any>('select * from jobs where order_item_id = $1', [t.itemId]))!;
    expect(j2.clock_paused).toBe(false);
    expect(j2.stage).toBe('file_check');
    // No credit code is made: the credit is already in the price.
    expect((await P.getProject(t.projectId))!.credit_coupon_id).toBeNull();
    // Attaching twice is harmless.
    expect(await IO.attachApproved(t.projectId)).toBe('no_line');

    // The file desk can now pass it to print, like any file.
    await J.moveJob(j2.id, 'printing', { actor: { id: (await db.one<any>("select id from staff where role = 'admin' limit 1"))!.id, name: 'Desk', role: 'admin', press_id: null } as any });
    expect((await db.one<any>('select stage from jobs where id = $1', [j2.id]))!.stage).toBe('printing');
    // The design cannot be ordered a second time from Studio.
    const dup: any = await A.startOrder(t.c, t.projectId);
    expect(dup.ok).toBe(false);
    expect(dup.code).toBe('on_order');
  }, 180_000);

  it('a paid Studio line refuses an uploaded file, and the customer is told why', async () => {
    const t = await started();
    await IO.addToOrder(t.c, t.projectId, 'standard');
    await payOrder(t.c, t.orderId);
    const { saveArtwork } = await import('../lib/artwork');
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 1800, height: 2500, channels: 3, background: '#223' } }).png().toBuffer();
    const r: any = await saveArtwork(t.orderId, { name: 'mine.png', type: 'image/png', buf: png }, t.itemId);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Studio/);
  });

  it('Premium waits for the Brandit designer before the print file is released', async () => {
    const t = await started('posters');
    const add: any = await IO.addToOrder(t.c, t.projectId, 'premium');
    expect(add.ok, JSON.stringify(add)).toBe(true);
    await payOrder(t.c, t.orderId);
    await W.drainAll();
    const drafts = (await P.versionsOf(t.projectId)).filter((v) => v.kind === 'draft');
    expect(drafts).toHaveLength(6);
    const f1: any = await P.requestPremiumFinal(t.c, t.projectId, drafts[0].id);
    expect(f1.ok).toBe(true);
    await W.drainAll();
    expect(((await P.requestFinish(t.c, t.projectId, f1.versionId)) as any).ok).toBe(true);
    await W.drainAll();
    const ap: any = await P.approve(t.c, t.projectId, f1.versionId, { spellingConfirmed: true });
    expect(ap.ok, JSON.stringify(ap)).toBe(true);
    expect(ap.review).toBe(true);
    // Approved, but not released: a person has to check it first.
    expect((await O.getItem(t.orderId))!.artwork_path).toBe('studio');
    expect((await db.one<any>('select clock_paused from jobs where order_item_id = $1', [t.itemId]))!.clock_paused).toBe(true);
    const mine = (await R.listReviews('waiting')).find((w) => w.project_id === t.projectId)!;
    const staff = await db.one<any>("select id from staff where role = 'admin' limit 1");
    expect((await R.decideReview(staff.id, mine.id, 'passed', '')).ok).toBe(true);
    const item = (await O.getItem(t.orderId))!;
    expect(item.artwork_path).toBe('upload');
    expect((await db.one<any>('select clock_paused from jobs where order_item_id = $1', [t.itemId]))!.clock_paused).toBe(false);
  }, 240_000);

  it('gives the design fee back through the order\'s payment when Studio cannot make it', async () => {
    const t = await started();
    await IO.addToOrder(t.c, t.projectId, 'standard');
    await payOrder(t.c, t.orderId);
    await B.refundProject(t.projectId, 'Studio could not make this design');
    const refunds = await db.query<any>("select amount_kobo from payments where order_id = $1 and status = 'refund'", [t.orderId]);
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount_kobo).toBe(-150_000);
    expect((await db.one<any>('select status from studio_purchases where project_id = $1', [t.projectId]))!.status).toBe('refunded');
    // The print line is not stuck: it needs the customer's own file now, and says so.
    const item = (await O.getItem(t.orderId))!;
    expect(item.artwork_path).toBeNull();
    const job = (await db.one<any>('select clock_paused, paused_reason from jobs where order_item_id = $1', [t.itemId]))!;
    expect(job.clock_paused).toBe(true);
    expect(job.paused_reason).toMatch(/upload your own file/i);
  }, 120_000);
});

describe('the sweep finishes what a crash left behind', () => {
  it('unlocks a paid Studio line that was never started', async () => {
    const t = await started();
    await IO.addToOrder(t.c, t.projectId, 'standard');
    // Pay, then pretend the unlock never ran.
    await payOrder(t.c, t.orderId);
    await db.query('delete from studio_purchases where project_id = $1', [t.projectId]);
    await db.query("update studio_projects set tier = null, status = 'draft', paid_kobo = 0 where id = $1", [t.projectId]);
    const r = await IO.sweepStudioLines();
    expect(r.unlocked).toBeGreaterThanOrEqual(1);
    expect((await P.getProject(t.projectId))!.tier).toBe('standard');
    expect(await db.query('select 1 from studio_purchases where project_id = $1', [t.projectId])).toHaveLength(1);
  }, 120_000);
});
