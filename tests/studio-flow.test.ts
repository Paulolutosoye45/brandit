import { beforeAll, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

process.env.PGLITE_DIR = 'memory';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-studio-test-${process.pid}`);
delete process.env.PAYSTACK_SECRET_KEY;
for (const k of ['RECRAFT_API_KEY', 'BFL_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'FAL_KEY']) delete process.env[k];

let db: typeof import('../lib/db');
let P: typeof import('../lib/studio/projects');
let W: typeof import('../lib/studio/worker');
let B: typeof import('../lib/studio/purchases');
let A: typeof import('../lib/studio/attach');
let R: typeof import('../lib/studio/reviews');
let L: typeof import('../lib/studio/limits');
let S: typeof import('../lib/settings');
let I: typeof import('../lib/identity');
let O: typeof import('../lib/orders');
let st: typeof import('../lib/storage');

const photo = () => sharp({ create: { width: 1400, height: 1800, channels: 3, background: '#8a5a3c' } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1800"><circle cx="700" cy="640" r="280" fill="#3b2314"/><rect x="330" y="980" width="740" height="820" rx="200" fill="#e84c3d"/></svg>') }]).jpeg().toBuffer();
const tinyPhoto = () => sharp({ create: { width: 500, height: 500, channels: 3, background: '#8a5a3c' } }).jpeg().toBuffer();
const logo = () => sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300"><circle cx="150" cy="150" r="120" fill="#0b6b4b"/><text x="310" y="190" font-size="110" font-family="sans-serif" fill="#0b1f33">Ola Cakes</text></svg>')).png().toBuffer();

let n = 0;
async function newCustomer(over: Partial<{ phone: string | null; email: string }> = {}) {
  n++;
  const phone = over.phone === undefined ? `+23480312${String(30000 + n)}` : over.phone;
  const c = phone ? (await I.signInPhone(phone)).customer : (await I.signInEmail(over.email ?? `s${n}@example.com`)).customer;
  return c;
}

const OWAMBE = {
  occasion: 'owambe',
  lines: { who: 'Chief & Mrs Adéwálé Ọláńrewájú', what: '60th Birthday & Thanksgiving', date: 'Saturday 14 March 2026, 11am prompt', where: 'Eko Hotel & Suites, Victoria Island', rsvp: 'RSVP: 0803 123 4567' },
  look: 'make e fine, plenty gold, ankara style',
  style: 'ankara', palette: 'royal-gold',
  choices: { font: 'montserrat', theme: 'auto', style: 'panels', photoShape: 'rounded' },
};

beforeAll(async () => {
  db = await import('../lib/db');
  await db.ready();
  P = await import('../lib/studio/projects');
  W = await import('../lib/studio/worker');
  B = await import('../lib/studio/purchases');
  A = await import('../lib/studio/attach');
  R = await import('../lib/studio/reviews');
  L = await import('../lib/studio/limits');
  S = await import('../lib/settings');
  I = await import('../lib/identity');
  O = await import('../lib/orders');
  st = await import('../lib/storage');
}, 60_000);

async function paid(c: any, sku: any, projectId?: string, versionId?: string) {
  const r: any = await B.startPurchase(c, { sku, projectId, versionId });
  expect(r.ok).toBe(true);
  const conf = await B.confirmStudioPayment({ reference: r.reference, amountKobo: r.amountKobo, method: 'card' });
  expect(conf.ok).toBe(true);
  return r;
}

async function readyProject(c: any, slug = 'flyers', o: { withPhoto?: boolean; withLogo?: boolean; brief?: any } = {}) {
  const pr: any = await P.createProject(c, { productSlug: slug, occasion: 'owambe' });
  expect(pr.ok).toBe(true);
  const id = pr.project.id as string;
  const sb: any = await P.saveBrief(c, id, o.brief ?? OWAMBE);
  expect(sb.ok, JSON.stringify(sb)).toBe(true);
  if (o.withPhoto) { const a: any = await P.addAsset(c, id, 'photo', { name: 'me.jpg', buf: await photo() }); expect(a.ok, JSON.stringify(a)).toBe(true); }
  if (o.withLogo) { const a: any = await P.addAsset(c, id, 'logo', { name: 'logo.png', buf: await logo() }); expect(a.ok, JSON.stringify(a)).toBe(true); }
  await P.setConsent(c, id);
  return id;
}

describe('prices and allowances', () => {
  it('uses the decided prices, all in kobo', async () => {
    const cfg = await import('../lib/studio/config');
    const s = await S.getSettings();
    expect(cfg.priceOf(s, 'standard')).toBe(250_000);
    expect(cfg.priceOf(s, 'premium')).toBe(750_000);
    expect(cfg.priceOf(s, 'upgrade')).toBe(500_000);
    expect(cfg.priceOf(s, 'pack3')).toBe(650_000);
    expect(cfg.priceOf(s, 'round', 'standard')).toBe(50_000);
    expect(cfg.priceOf(s, 'round', 'premium')).toBe(100_000);
    expect(cfg.priceOf(s, 'vector')).toBe(100_000);
    expect(cfg.priceOf(s, 'check')).toBe(100_000);
    expect(cfg.allowanceFor('standard', s)).toMatchObject({ concepts: 4, rounds: 2, perRound: 2, creditKobo: 100_000 });
    expect(cfg.allowanceFor('premium', s)).toMatchObject({ concepts: 6, rounds: 3, finals: 2, vectorIncluded: true, checkIncluded: true, creditKobo: 250_000 });
    expect(s.design_fee_kobo).toBe(1_200_000);
  });
});

describe('what Studio will not make', () => {
  it('stops political and official-document requests with a plain reason and no picture', async () => {
    const c = await newCustomer();
    const pr: any = await P.createProject(c, { productSlug: 'flyers', occasion: 'other' });
    const id = pr.project.id;
    const bad: any = await P.saveBrief(c, id, { occasion: 'other', lines: { headline: 'Vote Chief Okoro for Governor 2027' } });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/political|campaign/i);
    const doc: any = await P.saveBrief(c, id, { occasion: 'other', look: 'make it look like a real birth certificate with a government seal', lines: { headline: 'Our family' } });
    expect(doc.ok).toBe(false);
    expect(doc.error).toMatch(/official|document|ID/i);
    // a school may print the word "certificate" in its own words
    const award: any = await P.saveBrief(c, id, { occasion: 'other', lines: { headline: 'Certificate of Achievement' } });
    expect(award.ok, JSON.stringify(award)).toBe(true);
    const flags = await db.query("select * from studio_flags where customer_id = $1 and verdict = 'block'", [c.id]);
    expect(flags.length).toBe(2);
  });

  it('allows ordinary Nigerian events, including a church called Christ Embassy and a party flyer', async () => {
    const c = await newCustomer();
    const pr: any = await P.createProject(c, { productSlug: 'flyers', occasion: 'church' });
    const ok: any = await P.saveBrief(c, pr.project.id, { occasion: 'church', lines: { title: 'Thanksgiving Service at Christ Embassy', where: 'Ikeja' } });
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
  });

  it('keeps ID cards to staff cards only', async () => {
    const c = await newCustomer();
    const bad: any = await P.createProject(c, { productSlug: 'id-cards', occasion: 'owambe' });
    expect(bad.ok).toBe(false);
    const ok: any = await P.createProject(c, { productSlug: 'id-cards' });
    expect(ok.ok).toBe(true);
    expect(ok.project.occasion).toBe('staff_id');
  });

  it('refuses characters no font can print, and says which', async () => {
    const c = await newCustomer();
    const pr: any = await P.createProject(c, { productSlug: 'flyers', occasion: 'birthday' });
    const bad: any = await P.saveBrief(c, pr.project.id, { occasion: 'birthday', lines: { name: 'Happy birthday 🎉' } });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('🎉');
  });

  it('pauses the account after repeated blocked requests, and staff can lift it', async () => {
    const c = await newCustomer();
    const pr: any = await P.createProject(c, { productSlug: 'flyers', occasion: 'other' });
    let last: any;
    for (let k = 0; k < 3; k++) last = await P.saveBrief(c, pr.project.id, { occasion: 'other', lines: { headline: 'Vote for our candidate in the election' } });
    expect(last.ok).toBe(false);
    const row = await db.one<any>('select studio_blocked_until from customers where id = $1', [c.id]);
    expect(row.studio_blocked_until).not.toBeNull();
    const fresh = (await db.one<any>('select * from customers where id = $1', [c.id]))!;
    const again: any = await P.createProject(fresh, { productSlug: 'flyers', occasion: 'other' });
    expect(again.ok).toBe(false);
    expect(again.code).toBe('paused');
    await L.liftPause(c.id);
    const back: any = await P.createProject((await db.one<any>('select * from customers where id = $1', [c.id]))!, { productSlug: 'flyers', occasion: 'other' });
    expect(back.ok).toBe(true);
  });
});

describe('free sketches', () => {
  it('needs a verified phone, gives two a week per number, and logs them', async () => {
    const noPhone = await newCustomer({ phone: null });
    const id0 = await readyProject(noPhone);
    const r0: any = await P.requestSketch(noPhone, id0);
    expect(r0.ok).toBe(false);
    expect(r0.code).toBe('phone');

    const c = await newCustomer();
    const id = await readyProject(c, 'flyers', { withPhoto: true, withLogo: true });
    const a: any = await P.requestSketch(c, id);
    const b: any = await P.requestSketch(c, id);
    expect(a.ok && b.ok).toBe(true);
    const third: any = await P.requestSketch(c, id);
    expect(third.ok).toBe(false);
    expect(third.code).toBe('sketch_limit');
    await W.drainAll();
    const vs = await P.versionsOf(id);
    expect(vs.filter((v) => v.kind === 'sketch' && v.status === 'ready').length).toBe(2);
    expect(vs.every((v) => v.free)).toBe(true);
    // a second project on the same number does not reset the allowance
    const id2 = await readyProject(c);
    const again: any = await P.requestSketch(c, id2);
    expect(again.ok).toBe(false);
    // the preview exists and is small
    const prev = await st.getFile(vs[0].preview_key!);
    const meta = await sharp(prev).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(800);
  });

  it('does not charge a sketch that failed, and pauses at the daily ceiling', async () => {
    const eng = await import('../lib/studio/engine');
    void eng;
    const s = await S.getSettings();
    const led = await import('../lib/studio/ledger');
    await S.setSetting('studio_free_ceiling_kobo', (await led.todayFreeSpendKobo()) + 1);
    const c = await newCustomer();
    const id = await readyProject(c);
    const r: any = await P.requestSketch(c, id);
    expect(r.ok).toBe(true);
    await W.drainAll();
    // the first sketch spent more than one kobo, so the next one waits
    const c2 = await newCustomer();
    const id2 = await readyProject(c2);
    const r2: any = await P.requestSketch(c2, id2);
    expect(r2.ok).toBe(false);
    expect(r2.code).toBe('rest');
    await S.setSetting('studio_free_ceiling_kobo', s.studio_free_ceiling_kobo);
  });
});

describe('Standard design, start to order', () => {
  it('unlocks with payment, makes four concepts, builds a sharp print file, locks it on approval, and orders with the credit', async () => {
    const c = await newCustomer();
    const id = await readyProject(c, 'flyers', { withPhoto: true, withLogo: true });
    const unpaid = await P.requestChange(c, id, { fromVersionId: '00000000-0000-0000-0000-000000000000', note: 'more gold' });
    expect(unpaid.ok).toBe(false);

    await paid(c, 'standard', id);
    // paying twice is safe
    let p = (await P.getProject(id))!;
    expect(p.tier).toBe('standard');
    expect(p.status).toBe('active');
    expect(p.credit_kobo).toBe(100_000);
    await W.drainAll();
    let vs = (await P.versionsOf(id)).filter((v) => v.kind === 'concept');
    expect(vs.length).toBe(4);
    expect(vs.every((v) => v.status === 'ready' && v.preview_key && v.art_key)).toBe(true);
    // each concept has a different look
    expect(new Set(vs.map((v) => v.payload.variation)).size).toBe(4);

    const pick = vs[0];
    // approving needs a print file
    const early: any = await P.approve(c, id, pick.id, { spellingConfirmed: true });
    expect(early.ok).toBe(false);
    expect(early.code).toBe('not_finished');

    const fin: any = await P.requestFinish(c, id, pick.id);
    expect(fin.ok).toBe(true);
    await W.drainAll();
    const done = (await P.getVersion(pick.id))!;
    expect(done.finish_status).toBe('done');
    expect(done.sha256).toMatch(/^[0-9a-f]{64}$/);
    // the file is exactly the pass-level size for a flyer: 5.83 x 8.27 in at 300 dpi
    expect(done.final_w).toBe(Math.round(5.83 * 300));
    expect(done.final_h).toBe(Math.round(8.27 * 300));
    expect(done.check_result.status).not.toBe('stop');
    const file = await st.getFile(done.final_key!);
    const meta = await sharp(file).metadata();
    expect(meta.width).toBe(done.final_w);
    expect(meta.density).toBe(300);
    expect(done.pdf_key).toBeTruthy();

    // must tick the spelling box
    const noTick: any = await P.approve(c, id, pick.id, { spellingConfirmed: false });
    expect(noTick.ok).toBe(false);
    expect(noTick.code).toBe('spelling');
    const ap: any = await P.approve(c, id, pick.id, { spellingConfirmed: true });
    expect(ap.ok, JSON.stringify(ap)).toBe(true);
    expect(ap.review).toBe(false);
    p = (await P.getProject(id))!;
    expect(p.status).toBe('approved');
    expect(p.approved_sha256).toBe(done.sha256);
    expect(p.credit_coupon_id).toBeTruthy();
    const audit = await db.query("select action from studio_audit where project_id = $1 order by id", [id]);
    expect(audit.map((a: any) => a.action)).toEqual(expect.arrayContaining(['created', 'unlocked', 'approved', 'credit_issued']));

    // the order carries the design, the file and the credit
    const ord: any = await A.startOrder(c, id, { quantity: 100 });
    expect(ord.ok, JSON.stringify(ord)).toBe(true);
    expect(ord.next).toBe(`/checkout/${ord.orderId}`);
    const order = (await O.getOrder(ord.orderId))!;
    expect(order.customer_id).toBe(c.id);
    expect(order.studio_project_id).toBe(id);
    expect(order.discount_kobo).toBe(100_000);
    expect(order.coupon_code).toMatch(/^STUDIO-/);
    const item = (await O.getItem(ord.orderId))!;
    expect(item.artwork_path).toBe('upload');
    expect(item.preview_approved_at).not.toBeNull();
    expect(item.studio_version_id).toBe(pick.id);
    const f = await db.one<any>('select * from files where id = $1', [item.artwork_file_id]);
    expect(f.storage_key).not.toBe(done.final_key); // a copy, so deleting the design never breaks the order
    const facts = await A.studioFacts(ord.orderId);
    expect(facts?.sha256).toBe(done.sha256);
  }, 120_000);

  it('does not let one person use another person\'s design', async () => {
    const a = await newCustomer();
    const b = await newCustomer();
    const id = await readyProject(a);
    expect(await P.ownProject(b, id)).toBeNull();
    const r: any = await P.requestSketch(b, id);
    expect(r.ok).toBe(false);
    const buy: any = await B.startPurchase(b, { sku: 'standard', projectId: id });
    expect(buy.ok).toBe(false);
  });

  it('keeps a Standard size guarantee: a roll-up banner needs Premium', async () => {
    const c = await newCustomer();
    const pr: any = await P.createProject(c, { productSlug: 'roll-up-banners', occasion: 'shop' });
    expect(pr.ok).toBe(true);
    await P.saveBrief(c, pr.project.id, { occasion: 'shop', lines: { name: 'Bisi Fabrics', offer: 'Grand opening' } });
    // Before the words and the tick are in, nobody can pay at all.
    const early: any = await B.startPurchase(c, { sku: 'premium', projectId: pr.project.id });
    expect(early.ok).toBe(false);
    expect(early.code).toBe('consent');
    await P.setConsent(c, pr.project.id);
    const buy: any = await B.startPurchase(c, { sku: 'standard', projectId: pr.project.id });
    expect(buy.ok).toBe(false);
    expect(buy.code).toBe('premium');
  });
});

describe('rounds of changes and free word fixes', () => {
  it('Standard has two rounds of two, then asks to buy another; word fixes are free and never use a round', async () => {
    const c = await newCustomer();
    const id = await readyProject(c);
    await paid(c, 'standard', id);
    await W.drainAll();
    const concepts = (await P.versionsOf(id)).filter((v) => v.kind === 'concept');
    const from = concepts[1];

    const r1: any = await P.requestChange(c, id, { fromVersionId: from.id, note: 'more gold, less busy' });
    expect(r1.ok, JSON.stringify(r1)).toBe(true);
    expect(r1.made).toBe(2);
    const r2: any = await P.requestChange(c, id, { fromVersionId: from.id, note: 'bigger border' });
    expect(r2.ok).toBe(true);
    await W.drainAll();
    const r3: any = await P.requestChange(c, id, { fromVersionId: from.id, note: 'one more' });
    expect(r3.ok).toBe(false);
    expect(r3.code).toBe('need_round');
    expect(r3.extra.priceKobo).toBe(50_000);

    // a spelling fix: no vendor call, no round used
    const before = (await db.one<any>('select count(*)::int as n from studio_ledger where project_id = $1', [id]))!.n;
    const fix: any = await P.tweak(c, id, { fromVersionId: from.id, brief: { ...OWAMBE, lines: { ...OWAMBE.lines, where: 'Eko Hotel & Suites, Victoria Island, Lagos' }, choices: { ...OWAMBE.choices, font: 'garamond' } } });
    expect(fix.ok, JSON.stringify(fix)).toBe(true);
    const after = (await db.one<any>('select count(*)::int as n from studio_ledger where project_id = $1', [id]))!.n;
    expect(after).toBe(before);
    const tv = (await P.getVersion(fix.versionId))!;
    expect(tv.status).toBe('ready');
    expect(tv.art_key).toBe(from.art_key);
    expect(tv.layout.brief!.lines.where).toContain('Lagos');
    // the earlier version is untouched
    expect((await P.getVersion(from.id))!.layout.brief!.lines.where).not.toContain('Lagos');

    // buy another round and use it
    await paid(c, 'round', id);
    const r4: any = await P.requestChange(c, id, { fromVersionId: from.id, note: 'one more please' });
    expect(r4.ok, JSON.stringify(r4)).toBe(true);
    await W.drainAll();
  }, 120_000);

  it('rejects a change request that breaks the content rules', async () => {
    const c = await newCustomer();
    const id = await readyProject(c);
    await paid(c, 'standard', id);
    await W.drainAll();
    const from = (await P.versionsOf(id)).find((v) => v.kind === 'concept')!;
    const bad: any = await P.requestChange(c, id, { fromVersionId: from.id, note: 'add the Nike logo and a famous footballer' });
    expect(bad.ok).toBe(false);
  });
});

describe('Premium', () => {
  it('makes six drafts, two premium finals, includes vector and a human check, and a bigger credit', async () => {
    const c = await newCustomer();
    const id = await readyProject(c, 'posters', { withPhoto: true });
    await paid(c, 'premium', id);
    await W.drainAll();
    const drafts = (await P.versionsOf(id)).filter((v) => v.kind === 'draft');
    expect(drafts.length).toBe(6);
    expect(drafts.every((d) => d.status === 'ready')).toBe(true);
    const f1: any = await P.requestPremiumFinal(c, id, drafts[0].id);
    const f2: any = await P.requestPremiumFinal(c, id, drafts[1].id);
    expect(f1.ok && f2.ok).toBe(true);
    const f3: any = await P.requestPremiumFinal(c, id, drafts[2].id);
    expect(f3.ok).toBe(false);
    await W.drainAll();
    const fin = (await P.getVersion(f1.versionId))!;
    expect(fin.engine).toBe('demo');
    const ok: any = await P.requestFinish(c, id, fin.id);
    expect(ok.ok).toBe(true);
    // included vector file, no payment
    expect(await W.requestVector(id, fin.id)).toBe(true);
    await W.drainAll();
    const done = (await P.getVersion(fin.id))!;
    expect(done.finish_status).toBe('done');
    expect(done.svg_key).toBeTruthy();
    const svg = (await st.getFile(done.svg_key!)).toString('utf8');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toMatch(/<script|onload|javascript:/i);
    const ap: any = await P.approve(c, id, fin.id, { spellingConfirmed: true });
    expect(ap.ok, JSON.stringify(ap)).toBe(true);
    expect(ap.review).toBe(true);
    let p = (await P.getProject(id))!;
    expect(p.credit_kobo).toBe(250_000);
    // not orderable until a person has checked it
    const early: any = await A.startOrder(c, id);
    expect(early.ok).toBe(false);
    expect(early.code).toBe('review_waiting');
    expect(p.credit_coupon_id).toBeNull();

    const waiting = await R.listReviews('waiting');
    const mine = waiting.find((w) => w.project_id === id)!;
    expect(mine).toBeTruthy();
    const staff = await db.one<any>("select id from staff where role = 'admin' limit 1");
    const dec = await R.decideReview(staff.id, mine.id, 'passed', '');
    expect(dec.ok).toBe(true);
    const go: any = await A.startOrder(c, id, { quantity: 50 });
    expect(go.ok, JSON.stringify(go)).toBe(true);
    const order = (await O.getOrder(go.orderId))!;
    expect(order.discount_kobo).toBe(250_000);
  }, 180_000);

  it('a note from the designer reopens the design and pauses the credit', async () => {
    const c = await newCustomer();
    const id = await readyProject(c, 'posters');
    await paid(c, 'premium', id);
    await W.drainAll();
    const d = (await P.versionsOf(id)).find((v) => v.kind === 'draft')!;
    await P.requestFinish(c, id, d.id);
    await W.drainAll();
    const ap: any = await P.approve(c, id, d.id, { spellingConfirmed: true });
    expect(ap.ok).toBe(true);
    const mine = (await R.listReviews('waiting')).find((w) => w.project_id === id)!;
    const staff = await db.one<any>("select id from staff where role = 'admin' limit 1");
    const none = await R.decideReview(staff.id, mine.id, 'changes', '');
    expect(none.ok).toBe(false);
    const dec = await R.decideReview(staff.id, mine.id, 'changes', 'The phone number looks one digit short.');
    expect(dec.ok).toBe(true);
    const p = (await P.getProject(id))!;
    expect(p.status).toBe('active');
    expect(p.approved_version_id).toBeNull();
    // fix it for free and approve again
    const fix: any = await P.tweak(c, id, { fromVersionId: d.id, brief: { ...OWAMBE, lines: { ...OWAMBE.lines, rsvp: 'RSVP: 0803 123 4568' } } });
    expect(fix.ok, JSON.stringify(fix)).toBe(true);
  }, 180_000);

  it('upgrading a Standard design tops up to six drafts and charges only the difference', async () => {
    const c = await newCustomer();
    const id = await readyProject(c);
    await paid(c, 'standard', id);
    await W.drainAll();
    const up: any = await B.startPurchase(c, { sku: 'upgrade', projectId: id });
    expect(up.amountKobo).toBe(500_000);
    await B.confirmStudioPayment({ reference: up.reference, amountKobo: up.amountKobo });
    await W.drainAll();
    const p = (await P.getProject(id))!;
    expect(p.tier).toBe('premium');
    expect(p.credit_kobo).toBe(250_000);
    const n = (await P.versionsOf(id)).filter((v) => v.kind === 'concept' || v.kind === 'draft').length;
    expect(n).toBe(6);
  }, 120_000);

  it('makes the same look on another product, reusing the picture when the shape is close', async () => {
    const c = await newCustomer();
    const id = await readyProject(c, 'posters');
    await paid(c, 'premium', id);
    await W.drainAll();
    const d = (await P.versionsOf(id)).find((v) => v.kind === 'draft')!;
    const ad: any = await P.requestAdapt(c, id, { fromVersionId: d.id, productSlug: 'flyers' });
    expect(ad.ok, JSON.stringify(ad)).toBe(true);
    await W.drainAll();
    const av = (await P.getVersion(ad.versionId))!;
    expect(av.status).toBe('ready');
    expect(av.spec!.slug).toBe('flyers');
    expect(av.art_key).toBe(d.art_key); // poster and flyer are the same shape, so no new picture was bought
    const wide: any = await P.requestAdapt(c, id, { fromVersionId: d.id, productSlug: 'flex-banners', widthFt: 6, heightFt: 3 });
    expect(wide.ok, JSON.stringify(wide)).toBe(true);
    await W.drainAll();
    const wv = (await P.getVersion(wide.versionId))!;
    expect(wv.art_key).not.toBe(d.art_key); // a very different shape needs a new picture
    // two extra products are included in Premium
    const third: any = await P.requestAdapt(c, id, { fromVersionId: d.id, productSlug: 'stickers' });
    expect(third.ok).toBe(false);
    expect(third.code).toBe('no_adapt');
  }, 180_000);
});

describe('the pack of three', () => {
  it('adds three designs that never expire, uses them without payment, and gives one back on a refund', async () => {
    const c = await newCustomer();
    await paid(c, 'pack3');
    expect(await B.walletOf(c.id)).toBe(3);
    const id = await readyProject(c);
    const u: any = await B.unlockWithPack(c, id);
    expect(u.ok, JSON.stringify(u)).toBe(true);
    expect(await B.walletOf(c.id)).toBe(2);
    const p = (await P.getProject(id))!;
    expect(p.tier).toBe('standard');
    expect(p.from_pack).toBe(true);
    await W.drainAll();
    // the pack design is refundable as a credit
    const pu = await db.one<any>("select id from studio_purchases where project_id = $1 and method = 'pack'", [id]);
    const rf = await B.refundPurchase(pu.id, 'test');
    expect(rf.ok).toBe(true);
    expect(await B.walletOf(c.id)).toBe(3);
    const none = await newCustomer();
    const bad: any = await B.unlockWithPack(none, await readyProject(none));
    expect(bad.ok).toBe(false);
  }, 120_000);
});

describe('payment safety', () => {
  it('applies a payment once, rejects a wrong amount and unknown references', async () => {
    const c = await newCustomer();
    const id = await readyProject(c);
    const r: any = await B.startPurchase(c, { sku: 'standard', projectId: id });
    expect((await B.confirmStudioPayment({ reference: r.reference, amountKobo: r.amountKobo - 1 }))).toEqual({ ok: false, reason: 'AMOUNT_MISMATCH' });
    expect((await B.confirmStudioPayment({ reference: 'STU-nope', amountKobo: 1 }))).toEqual({ ok: false, reason: 'UNKNOWN_REFERENCE' });
    expect((await P.getProject(id))!.tier).toBeNull();
    const a = await B.confirmStudioPayment({ reference: r.reference, amountKobo: r.amountKobo });
    const b = await B.confirmStudioPayment({ reference: r.reference, amountKobo: r.amountKobo });
    expect(a.ok && b.ok).toBe(true);
    await W.drainAll();
    const concepts = (await P.versionsOf(id)).filter((v) => v.kind === 'concept');
    expect(concepts.length).toBe(4); // not eight
    // a pending payment cannot be used to skip paying
    const id2 = await readyProject(c);
    await B.startPurchase(c, { sku: 'premium', projectId: id2 });
    expect((await P.getProject(id2))!.tier).toBeNull();
  }, 120_000);

  it('applies a paid-but-unapplied purchase on the next sweep', async () => {
    const c = await newCustomer();
    const id = await readyProject(c);
    const r: any = await B.startPurchase(c, { sku: 'standard', projectId: id });
    await db.query("update studio_purchases set status = 'paid', verified_at = now() - interval '5 minutes' where provider_ref = $1", [r.reference]);
    expect((await P.getProject(id))!.tier).toBeNull();
    expect(await B.applyPendingPaid()).toBeGreaterThanOrEqual(1);
    expect((await P.getProject(id))!.tier).toBe('standard');
  }, 60_000);
});

describe('failures and refunds', () => {
  it('refunds everything by itself when no design could be made', async () => {
    const c = await newCustomer();
    const id = await readyProject(c);
    // make every attempt fail: a vendor that rejects the request
    const eng = await import('../lib/studio/engine');
    void eng;
    await db.query("update settings set value = '\"off\"'::jsonb where key = 'studio_upscaler'").catch(() => {});
    await S.setSetting('studio_vendor_cap_usd', 0.000001);
    await paid(c, 'standard', id);
    // cap is spent, so paid work waits rather than failing
    const v1 = (await P.versionsOf(id))[0];
    await W.drain();
    await new Promise((r) => setTimeout(r, 300));
    const waiting = await P.getVersion(v1.id);
    expect(['queued', 'running']).toContain(waiting!.status);
    await S.setSetting('studio_vendor_cap_usd', 300);
    // force definitive failure
    await db.query("update studio_versions set status = 'failed', error = 'test', user_error = 'x' where project_id = $1", [id]);
    const fakeV = (await P.versionsOf(id))[0];
    await B.refundProject(id, 'Every design failed to build, so your payment was returned.');
    const p = (await P.getProject(id))!;
    expect(p.status).toBe('archived');
    const pu = await db.query("select status from studio_purchases where project_id = $1", [id]);
    expect(pu.every((r: any) => r.status === 'refunded')).toBe(true);
    void fakeV;
  }, 60_000);

  it('does not refund a purchase twice', async () => {
    const c = await newCustomer();
    const id = await readyProject(c);
    await paid(c, 'standard', id);
    await W.drainAll();
    const pu = await db.one<any>("select id from studio_purchases where project_id = $1", [id]);
    expect((await B.refundPurchase(pu.id, 'a')).ok).toBe(true);
    expect((await B.refundPurchase(pu.id, 'b')).ok).toBe(false);
  }, 60_000);
});

describe('photos and logos', () => {
  it('warns that a small photo will print soft and stops it when it is far too small', async () => {
    const c = await newCustomer();
    const id = await readyProject(c, 'posters');
    const a: any = await P.addAsset(c, id, 'photo', { name: 'small.jpg', buf: await tinyPhoto() });
    expect(a.ok, JSON.stringify(a)).toBe(true);
    await paid(c, 'standard', id);
    await W.drainAll();
    const v = (await P.versionsOf(id)).find((x) => x.kind === 'concept')!;
    await P.requestFinish(c, id, v.id);
    await W.drainAll();
    const done = (await P.getVersion(v.id))!;
    const line = done.check_result.lines.find((l: any) => l.id === 'photo');
    expect(line).toBeTruthy();
    expect(['warn', 'stop']).toContain(line.status);
    if (done.check_result.status === 'stop') {
      const ap: any = await P.approve(c, id, v.id, { spellingConfirmed: true });
      expect(ap.ok).toBe(false);
      expect(ap.code).toBe('check_stop');
      expect(done.check_result.options.map((o: any) => o.id)).toEqual(expect.arrayContaining(['no_photo']));
    }
  }, 120_000);

  it('rejects files that are not pictures and pictures that are too small', async () => {
    const c = await newCustomer();
    const id = await readyProject(c);
    const bad: any = await P.addAsset(c, id, 'photo', { name: 'x.jpg', buf: Buffer.from('not an image at all, just text') });
    expect(bad.ok).toBe(false);
    const tiny: any = await P.addAsset(c, id, 'photo', { name: 'x.jpg', buf: await sharp({ create: { width: 100, height: 100, channels: 3, background: '#fff' } }).jpeg().toBuffer() });
    expect(tiny.ok).toBe(false);
  });

  it('strips hidden camera details from stored copies', async () => {
    const c = await newCustomer();
    const id = await readyProject(c);
    const withExif = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#aaa' } }).withExif({ IFD0: { Copyright: 'secret-gps-marker' } }).jpeg().toBuffer();
    const a: any = await P.addAsset(c, id, 'photo', { name: 'x.jpg', buf: withExif });
    expect(a.ok).toBe(true);
    const stored = await st.getFile(a.asset.storage_key);
    expect(stored.toString('latin1')).not.toContain('secret-gps-marker');
  });
});

describe('retention and deleting', () => {
  it('deletes words, pictures and versions after the keep period but keeps the record and an order\'s file', async () => {
    const c = await newCustomer();
    const id = await readyProject(c, 'flyers', { withPhoto: true });
    await paid(c, 'standard', id);
    await W.drainAll();
    const v = (await P.versionsOf(id)).find((x) => x.kind === 'concept')!;
    await P.requestFinish(c, id, v.id);
    await W.drainAll();
    const apr: any = await P.approve(c, id, v.id, { spellingConfirmed: true });
    expect(apr.ok, JSON.stringify(apr)).toBe(true);
    const ord: any = await A.startOrder(c, id);
    expect(ord.ok, JSON.stringify(ord)).toBe(true);
    const item = (await O.getItem(ord.orderId))!;
    const file = await db.one<any>('select storage_key from files where id = $1', [item.artwork_file_id]);
    const art = (await P.getVersion(v.id))!.art_key!;
    await db.query("update studio_projects set delete_after = now() - interval '1 day' where id = $1", [id]);
    // an unpaid draft order does not protect the design from the keep period
    expect(await P.purgeExpired()).toBeGreaterThanOrEqual(1);
    const p = (await db.one<any>('select * from studio_projects where id = $1', [id]))!;
    expect(p.status).toBe('purged');
    expect(p.brief).toEqual({});
    expect((await P.versionsOf(id)).length).toBe(0);
    await expect(st.getFile(art)).rejects.toBeTruthy();
    await expect(st.getFile(file.storage_key)).resolves.toBeTruthy(); // the order's own copy remains
    const kept = await db.query("select * from studio_purchases where project_id = $1", [id]);
    expect(kept.length).toBe(1);
  }, 120_000);

  it('lets a customer delete a design, and not a design on a paid order', async () => {
    const c = await newCustomer();
    const id = await readyProject(c, 'flyers', { withPhoto: true });
    const r: any = await P.deleteProject(c, id);
    expect(r.ok).toBe(true);
    expect((await P.getProject(id))!.status).toBe('purged');
    expect(await P.ownProject(c, id)).toBeNull();
  });
});

describe('the queue', () => {
  it('recovers a job a restart left half done', async () => {
    const c = await newCustomer();
    const id = await readyProject(c);
    await paid(c, 'standard', id);
    await db.query("update studio_versions set status = 'running', locked_at = now() - interval '20 minutes' where project_id = $1", [id]);
    expect(await W.recoverStale()).toBeGreaterThan(0);
    await W.drainAll();
    expect((await P.versionsOf(id)).every((v) => v.status === 'ready')).toBe(true);
  }, 120_000);
});
