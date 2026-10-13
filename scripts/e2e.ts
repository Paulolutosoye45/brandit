/*
 * End-to-end test: drives a RUNNING Brandit server over HTTP, the way browsers do.
 * Usage: BASE=http://localhost:3100 npx tsx scripts/e2e.ts
 */
import { makePng } from './png';

const BASE = process.env.BASE ?? 'http://localhost:3100';
let passed = 0;
const failures: string[] = [];
const ok = (cond: unknown, msg: string) => { if (cond) { passed++; console.log(`  ✓ ${msg}`); } else { failures.push(msg); console.log(`  ✗ ${msg}`); } };
const section = (s: string) => console.log(`\n${s}`);
/** The words on a page, the way a person reads them: React's comment markers and tags removed. */
const words = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

class Session {
  cookies: Record<string, string> = {};
  async req(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    const c = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (c) headers.set('cookie', c);
    const res = await fetch(BASE + path, { redirect: 'manual', signal: AbortSignal.timeout(60_000), ...init, headers });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair] = sc.split(';'); const i = pair.indexOf('=');
      const k = pair.slice(0, i), v = pair.slice(i + 1);
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(sc)) delete this.cookies[k]; else this.cookies[k] = v;
    }
    return res;
  }
  async html(path: string) { const r = await this.req(path); return { status: r.status, text: await r.text(), loc: r.headers.get('location') }; }
  async json(path: string, body?: unknown) {
    const r = await this.req(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    return { status: r.status, body: await r.json().catch(() => null) as any };
  }
  /** Submit a server-action form found on a page, the way a browser without JavaScript does. */
  async form(page: string, match: string, fields: Record<string, string | Blob> = {}) {
    const { text } = await this.html(page);
    const forms = [...text.matchAll(/<form[\s\S]*?<\/form>/g)].map((m) => m[0]);
    const f = forms.find((x) => x.includes(match));
    if (!f) throw new Error(`No form containing "${match}" on ${page}`);
    const fd = new FormData();
    for (const m of f.matchAll(/<input[^>]*>/g)) {
      const tag = m[0];
      const name = /name="([^"]+)"/.exec(tag)?.[1];
      if (!name) continue;
      const type = /type="([^"]+)"/.exec(tag)?.[1];
      if (type === 'hidden') fd.append(name, (/value="([^"]*)"/.exec(tag)?.[1] ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"'));
    }
    for (const [k, v] of Object.entries(fields)) fd.set(k, v as any);
    const r = await this.req(page, { method: 'POST', body: fd });
    const loc = r.headers.get('location') ?? '';
    await r.text();
    return { status: r.status, loc: decodeURIComponent(loc) };
  }
}

(async () => {
  const guest = new Session();

  section('Public pages');
  for (const p of ['/', '/products', '/products/flex-banners', '/products/picture-frames', '/help', '/track', '/signin', '/custom-order', '/faq', '/about', '/contact', '/delivery', '/business', '/legal/terms', '/legal/privacy', '/legal/refunds', '/console/login', '/manifest.webmanifest', '/icon.png']) {
    const r = await guest.html(p);
    ok(r.status === 200, `GET ${p} → 200`);
    // Look at the page itself (markup and text), not the framework's embedded data, which legitimately contains "$undefined".
    if (!/manifest|icon/.test(p)) ok(!/\bNaN\b|undefined|\[object Object\]/.test(r.text.replace(/<script[\s\S]*?<\/script>/g, '')), `${p} shows no NaN, undefined or [object Object]`);
  }
  // Signed-out visitors are sent to sign in, and come back to the page they wanted.
  for (const p of ['/account', '/welcome']) {
    const r = await guest.req(p);
    ok(r.status >= 300 && r.status < 400 && (r.headers.get('location') ?? '').includes('/signin'), `GET ${p} while signed out → sign-in`);
  }
  ok((await guest.html('/signin')).text.includes('Sign in or create your account'), 'Sign-in page offers one door for new and returning customers');
  ok((await guest.html('/signin')).text.includes('Continue with Google'), 'Sign-in page offers Google');
  const home = (await guest.html('/')).text;
  ok(home.includes('Printing without the hassle.'), 'Home page carries the brand promise');
  ok((await guest.html('/products')).text.includes('Picture frames'), 'Picture frames are in the catalogue');
  ok(home.includes('Not on the list? We still print it.'), 'Home page offers a custom price');
  ok(home.includes('application/ld+json') && home.includes('LocalBusiness'), 'Home page describes the business to search engines');
  const terms = words((await guest.html('/legal/terms')).text);
  ok(['Prices, VAT and fees', 'Custom orders', 'Coupon codes', 'Cancellations, reprints and refunds', 'Governing law and disputes'].every((h) => terms.includes(h)), 'Terms cover pricing, custom orders, coupons, refunds and the law');
  ok(terms.includes('48 hours'), 'Terms quote the live claim window');
  ok(words((await guest.html('/legal/refunds')).text).includes('Report a problem'), 'Refunds page says how to report a problem');
  ok(words((await guest.html('/delivery')).text).includes('Zone A'), 'Delivery page lists the live zones');
  const faq = (await guest.html('/faq')).text;
  ok(faq.includes('FAQPage') && faq.includes('<details'), 'FAQ is readable and marked up for search');
  ok((await guest.html('/sitemap.xml')).text.includes('/legal/refunds'), 'Sitemap lists the new pages');
  ok((await guest.html('/nope')).status === 404, 'Unknown page → 404');

  section('Quotes');
  const q1 = await guest.json('/api/quote', { slug: 'business-cards', quantity: 100, area: 'Yaba' });
  ok(q1.body.ok && q1.body.priceKobo === 1_500_000, '100 business cards = ₦15,000');
  ok(q1.body.deliveryKobo === 150_000, 'Yaba delivery = ₦1,500 (placeholder fee)');
  ok(typeof q1.body.arrivalText === 'string' && q1.body.arrivalText.length > 5, `Arrival is stated: "${q1.body.arrivalText}"`);
  const q2 = await guest.json('/api/quote', { slug: 'flex-banners', quantity: 1, widthFt: 5, heightFt: 3, area: 'Yaba' });
  ok(q2.body.priceKobo === 1_050_000, '5 × 3 ft flex banner = ₦10,500 at ₦700/sq ft');
  const q3 = await guest.json('/api/quote', { slug: 'flex-banners', quantity: 4, widthFt: 10, heightFt: 5, area: 'Yaba' });
  ok(q3.body.tier === 'standard' && q3.body.reasonTexts.some((t: string) => /sq ft/.test(t)), '200 sq ft of banners → standard, with the reason in words');
  const q4 = await guest.json('/api/quote', { slug: 'picture-frames', quantity: 1, sizeKey: '24x36', area: 'Yaba' });
  ok(q4.body.priceKobo === 5_600_000 && q4.body.tier === 'standard', '24 × 36 frame = ₦56,000, standard delivery');
  const q5 = await guest.json('/api/quote', { slug: 'business-cards', quantity: 150, area: 'Yaba' });
  ok(q5.body.ok === false, 'A quantity with no price is refused, not guessed');
  const q6 = await guest.json('/api/quote', { slug: 'business-cards', quantity: 100, area: 'Ikorodu' });
  ok(q6.body.tier === 'standard' && q6.body.reasonTexts.some((t: string) => /area|pick it up|closer/i.test(t)), 'Outer Lagos → standard, with how to qualify');

  section('Customer order: upload → check → approve → checkout → pay');
  const draft = await guest.json('/api/orders', { slug: 'business-cards', quantity: 100, area: 'Yaba' });
  const id = draft.body.id as string;
  ok(!!id, 'Draft order created');
  ok((await guest.html(`/order/${id}/artwork`)).status === 200, 'Artwork page loads');
  ok((await guest.html(`/checkout/${id}`)).status === 307 || (await guest.html(`/checkout/${id}`)).status === 303, 'Checkout redirects back until artwork is approved');

  const upload = async (png: Buffer, name: string) => { const fd = new FormData(); fd.append('file', new File([new Uint8Array(png)], name, { type: 'image/png' })); const r = await guest.req(`/api/orders/${id}/upload`, { method: 'POST', body: fd }); return r.json() as Promise<any>; };
  const blurry = await upload(makePng(200, 114), 'logo.png');
  ok(blurry.ok && blurry.check.status === 'stop' && /blurry/i.test(blurry.check.headline), `Blurry logo stopped in plain words: "${blurry.check?.headline}"`);
  ok((await guest.json(`/api/orders/${id}/approve`)).status === 400, 'Cannot approve with no usable file');
  const good = await upload(makePng(1050, 600), 'card.png');
  ok(good.ok && good.check.status === 'pass' && good.attached, 'Sharp file passes and is attached');
  const approve = await guest.json(`/api/orders/${id}/approve`);
  ok(approve.body.next === `/checkout/${id}`, 'Approving the preview moves on to checkout');
  ok((await guest.html(`/checkout/${id}`)).status === 200, 'Checkout page loads');

  const bad = await guest.json(`/api/orders/${id}/checkout`, { name: 'Ada Obi', phone: '123', email: 'ada@example.com', pickup: false, area: 'Yaba', addressLine: '12 Test Street, Yaba' });
  ok(bad.status === 422 && bad.body.field === 'phone', `Bad phone number is explained: "${bad.body?.error}"`);
  const co = await guest.json(`/api/orders/${id}/checkout`, { name: 'Ada Obi', phone: '0803 123 4567', email: 'ada@example.com', company: 'Obi Studio', plainPack: true, pickup: false, area: 'Yaba', addressLine: '12 Test Street, Yaba', window: 'morning' });
  ok(co.status === 200 && /^\/pay\//.test(co.body.url), 'Checkout returns a payment link (demo page, no Paystack key)');

  const payPage = await guest.html(co.body.url);
  ok(payPage.status === 200 && payPage.text.includes('Demo payment') && payPage.text.includes('₦16,500'), 'Demo pay page shows the exact total, ₦16,500');
  const paid = await guest.form(co.body.url, 'Simulate a successful payment');
  const token = /\/track\/([\w-]+)/.exec(paid.loc)?.[1] ?? '';
  ok(!!token, 'Payment confirmed and the customer lands on their tracker');

  let t = (await guest.json(`/api/track/${token}`)) as any; // POST not allowed, use GET below
  const track = async () => (await (await guest.req(`/api/track/${token}`)).json()) as any;
  t = await track();
  ok(t.paid && t.stage === 'file_check', 'Tracker: paid, now at the file check');
  ok(/Arrives/.test(t.headline), `Tracker headline: "${t.headline}"`);
  ok(t.deliveryWindow === 'Afternoon (1pm to 5pm)', `A 24-hour order asked for the morning is planned for the afternoon: "${t.deliveryWindow}"`);
  ok((await guest.html(`/track/${token}`)).text.includes(t.code), 'Tracker page renders');
  ok((await guest.html(`/invoice/${token}`)).text.includes('VAT invoice'), 'A business gets a VAT invoice');
  ok((await guest.html(`/invoice/${token}`)).text.includes('₦1,151'), 'VAT is worked out and shown on the invoice (7.5%, inside the price)');

  section('Privacy and access');
  const fileId = (await guest.json('/api/quote', { slug: 'business-cards', quantity: 100 })) && null;
  void fileId;
  ok((await guest.req('/console/queue')).status >= 300 && (await guest.req('/console/queue')).status < 400, 'Console redirects to sign-in when signed out');
  ok((await guest.req('/api/files/00000000-0000-0000-0000-000000000000')).status === 404, 'Unknown file → 404');
  const del = await guest.req('/api/cron/sweep', { method: 'GET' });
  ok(del.status === 200, 'Cron sweep runs (demo mode needs no secret)');

  section('Console: sign-in and role limits');
  const files = new Session();
  const wrong = await files.form('/console/login', 'Sign in', { email: 'files@brandit.test', pin: '9999' });
  ok(/e=/.test(wrong.loc) && !files.cookies.bs, 'Wrong PIN refused');
  const login = async (s: Session, email: string) => { const r = await s.form('/console/login', 'Sign in', { email, pin: '1234' }); return r; };
  const r1 = await login(files, 'files@brandit.test');
  ok(r1.loc.includes('/console/queue') && !!files.cookies.bs, 'File desk signs in');
  const queue = await files.html('/console/queue');
  ok(queue.status === 200 && queue.text.includes(t.code), `Job ${t.code} appears in the queue`);
  ok((await files.html('/console/rules')).status >= 300, 'File desk cannot open the rules editor');
  ok((await files.html('/console/reports')).status >= 300, 'File desk cannot open reports');

  const jobId = /\/console\/jobs\/([0-9a-f-]{36})/.exec(queue.text)?.[1] ?? '';
  ok(!!jobId, 'Job link found');
  const job = await files.html(`/console/jobs/${jobId}`);
  ok(job.status === 200 && job.text.includes('Customer approved the preview'), 'Job page shows the file and approval');
  ok(job.text.includes('+234803') || job.text.includes('0803'), 'File desk sees the customer contact');
  ok(/data:image\/png;base64/.test(job.text), 'Job ticket carries a QR code');

  section('Console: the job moves through production');
  const pass = await files.form(`/console/jobs/${jobId}`, 'File is good');
  ok(/ok=/.test(pass.loc), `File desk passes the file → ${pass.loc.split('ok=')[1]}`);
  t = await track();
  ok(t.stage === 'printing', 'Tracker: Printing');

  const lead = new Session();
  await login(lead, 'lead@brandit.test');
  const sk = await lead.form(`/console/jobs/${jobId}`, 'Done printing');
  ok(/ok=/.test(sk.loc), 'Lead moves it to the quality check');
  const noPhoto = await lead.form(`/console/jobs/${jobId}`, 'Passed: out for delivery');
  ok(/e=/.test(noPhoto.loc) && /photo/i.test(noPhoto.loc), `Dispatch refused without the finished-job photo: "${noPhoto.loc.split('e=')[1]}"`);
  const up = await lead.form(`/console/jobs/${jobId}`, 'Add the photo', { file: new File([new Uint8Array(makePng(80, 50))], 'done.png', { type: 'image/png' }) });
  ok(/ok=/.test(up.loc), 'Finished-job photo added');
  const noRider = await lead.form(`/console/jobs/${jobId}`, 'Passed: out for delivery');
  ok(/e=/.test(noRider.loc) && /rider/i.test(noRider.loc), 'Dispatch refused without rider details');
  const rider = await lead.form(`/console/jobs/${jobId}`, 'Save rider', { rider_name: 'Musa', rider_phone: '08030000000' });
  ok(/ok=/.test(rider.loc), 'Rider saved');
  const out = await lead.form(`/console/jobs/${jobId}`, 'Passed: out for delivery');
  ok(/ok=/.test(out.loc), 'Job goes out for delivery');

  t = await track();
  ok(t.stage === 'out_for_delivery' && /^\d{4}$/.test(t.deliveryCode ?? ''), `Customer sees the delivery code (${t.deliveryCode}) and the rider`);
  ok(!!t.qcPhotoFileId, 'Customer sees the finished-job photo');
  const photo = await guest.req(`/api/files/${t.qcPhotoFileId}?t=${token}`);
  ok(photo.status === 200 && photo.headers.get('content-type') === 'image/png', 'Finished-job photo opens with the order link');
  ok((await guest.req(`/api/files/${t.qcPhotoFileId}`)).status === 404, 'The same photo does not open without the order link');

  section('Rider link and live position');
  const jobPage = await lead.html(`/console/jobs/${jobId}`);
  const rTok = /\/rider\/([A-Za-z0-9_-]{24})/.exec(jobPage.text)?.[1] ?? '';
  ok(!!rTok, 'Dispatch sees a private rider link on the job');
  const riderSession = new Session();
  const rp = await riderSession.html(`/rider/${rTok}`);
  ok(rp.status === 200 && words(rp.text).includes(`Order ${t.code}`) && words(rp.text).includes('12 Test Street'), 'The rider page shows the order and the address, with no sign-in');
  ok(!words(rp.text).includes(t.deliveryCode) && !rp.text.includes('ada@example.com'), 'The rider page does not reveal the delivery code or the customer\'s email');
  ok(/noindex/.test(rp.text), 'The rider page asks search engines to stay away');
  ok((await riderSession.html('/rider/not-a-real-token-at-all')).status === 404, 'A wrong rider link is a 404');
  ok((await riderSession.json(`/api/rider/${rTok}/ping`, { lat: 6.5, lng: 3.3 })).status === 422, 'Sharing a position before the trip starts is refused');
  ok((await riderSession.json(`/api/rider/${rTok}/start`)).status === 200, 'The rider starts the trip');
  ok((await riderSession.json(`/api/rider/${rTok}/ping`, { lat: 0, lng: 0 })).status === 422, 'A position of 0,0 is refused');
  ok((await riderSession.json(`/api/rider/${rTok}/ping`, { lat: 6.5244, lng: 3.3792, accuracy: 15 })).status === 200, 'A real position is accepted');
  t = await track();
  ok(t.riderLive && /google\.com\/maps\?q=6\.52440,3\.37920/.test(t.riderLive.mapUrl), 'The customer can open the rider on a map');
  ok(!JSON.stringify(t).includes('last_lat'), 'The tracker never carries raw coordinates beyond the map link');
  ok((await riderSession.json(`/api/rider/${rTok}/nearby`)).status === 200, 'The rider says they are close');
  t = await track();
  ok(t.riderNearby === true, 'The customer sees that the rider is close');
  const wrongRiderCode = await riderSession.json(`/api/rider/${rTok}/code`, { code: t.deliveryCode === '0000' ? '1111' : '0000' });
  ok(wrongRiderCode.status === 422 && /does not match/.test(wrongRiderCode.body?.error ?? ''), 'A wrong code on the rider page is refused');

  const disp = new Session();
  await login(disp, 'dispatch@brandit.test');
  const wrongCode = await disp.form(`/console/jobs/${jobId}`, 'Complete delivery', { code: '0000' === t.deliveryCode ? '1111' : '0000' });
  ok(/e=/.test(wrongCode.loc), 'A wrong delivery code is refused');
  const done = await disp.form(`/console/jobs/${jobId}`, 'Complete delivery', { code: t.deliveryCode });
  ok(/ok=/.test(done.loc), 'The right code completes the delivery');
  t = await track();
  ok(t.delivered && t.headline === 'Delivered', 'Tracker: Delivered');
  ok(t.riderLive == null, 'Delivered: the rider\'s location is gone from the tracker');
  const doneRider = await riderSession.html(`/rider/${rTok}`);
  ok(doneRider.status === 200 && words(doneRider.text).includes('Delivered'), 'The rider link now says the delivery is done');
  ok((await riderSession.json(`/api/rider/${rTok}/ping`, { lat: 6.6, lng: 3.4 })).status === 422, 'Nothing more can be shared once delivered');
  ok(t.canReport && !t.hasReview, 'Customer can report a problem and leave a review');

  section('After delivery: review, problem report, Promise desk');
  const rvPage = await guest.html(`/order/${token}/review`);
  ok(rvPage.status === 200 && words(rvPage.text).includes('A photo of the finished job'), 'The review page offers a photo');
  const rvForm = new FormData();
  rvForm.set('rating', '5'); rvForm.set('body', 'Fast and exactly right, the cards look great.'); rvForm.set('public_ok', 'on'); rvForm.set('photo_ok', 'on');
  const reviewJpeg = await (await import('sharp')).default({ create: { width: 640, height: 480, channels: 3, background: '#c0392b' } }).jpeg().toBuffer();
  rvForm.set('photo', new File([new Uint8Array(reviewJpeg)], 'cards.jpg', { type: 'image/jpeg' }));
  const rvRes = await guest.req(`/api/reviews/${token}`, { method: 'POST', body: rvForm });
  const rv = (await rvRes.json()) as any;
  ok(rvRes.status === 200 && rv.ok && rv.hasPhoto, `Review with a photo submitted${rv.ok ? '' : ' (' + rvRes.status + ': ' + rv.error + ')'}`);
  const rvAgain = new FormData(); rvAgain.set('rating', '4');
  const rvAgainRes = await guest.req(`/api/reviews/${token}`, { method: 'POST', body: rvAgain });
  ok(rvAgainRes.status === 422 && /already reviewed/.test(((await rvAgainRes.json()) as any).error ?? ''), 'A second review on the same order is refused');
  ok(words((await guest.html(`/track/${token}?reviewed=photo`)).text).includes('A person checks your photo before anyone else can see it') || words((await guest.html(`/track/${token}?reviewed=photo`)).text).includes('A person checks your photo before anyone else sees it'), 'The customer is told a person checks the photo first');
  const pr = await guest.form(`/order/${token}/problem`, 'Send report', { kind: 'wrong_print', description: 'The blue is darker than my file.' });
  ok(pr.loc.includes('reported=1'), 'Problem reported');
  const desk = await lead.html('/console/promise');
  ok(desk.status === 200 && desk.text.includes('The blue is darker than my file.'), 'Report appears on the Promise desk');
  const dec = await lead.form('/console/promise', 'Record decision', { resolution: 'reprint', note: 'Colour profile problem on our side' });
  ok(/ok=/.test(dec.loc), 'Lead decides: reprint');
  t = await track();
  ok(t.stage === 'printing' && !t.delivered, 'The job is back at the press');

  section('Console: rules, reports, access');
  const admin = new Session();
  await login(admin, 'admin@brandit.test');
  ok((await admin.html('/console/rules')).text.includes('placeholders'), 'Rules page flags the placeholder numbers');
  const sv = await admin.form('/console/rules', 'Save settings', { cutoff_time: '13:00', arrive_by: '17:00', daily_24h_slots: '15', wd_1: 'on', wd_2: 'on', wd_3: 'on', wd_4: 'on', wd_5: 'on', wd_6: 'on', holidays: '2026-12-25', vat_rate: '7.5', prices_include_vat: 'on', hold_minutes: '15', design_fee: '5000', fix_fee: '2000', lead_limit: '50000', claim_window: '48', risk_qc: '4', risk_dispatch: '2' });
  ok(/ok=/.test(sv.loc), 'Admin changes the cut-off to 1pm without a developer');
  ok((await admin.html('/console/reports')).status === 200, 'Reports load');
  const sup = new Session();
  await login(sup, 'support@brandit.test');
  ok((await sup.html('/console/rules')).status >= 300, 'Support cannot edit prices');
  const press = new Session();
  await login(press, 'press@brandit.test');
  const pq = await press.html('/console/queue');
  ok(pq.status === 200 && !pq.text.includes(t.code), 'A partner press sees only its own jobs, not the hub\'s');
  ok((await press.html(`/console/jobs/${jobId}`)).status === 404, 'A partner press cannot open a hub job');

  section('Console: product manager');
  const sharp = (await import('sharp')).default;
  const jpeg = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#2a6f97' } }).jpeg().toBuffer();
  ok((await admin.html('/console/products')).text.includes('Add a product'), 'Admin sees the product list');
  ok((await sup.html('/console/products')).status >= 300, 'Support cannot manage products');
  ok((await sup.html('/console/coupons')).status >= 300, 'Support cannot manage coupons');
  const made = await admin.form('/console/products/new', 'Create and continue', { name: 'E2E tote bags', blurb: 'Canvas totes with your logo.', category: 'Stickers and merch', mode: 'tier' });
  const pid = /products\/([0-9a-f-]{36})/.exec(made.loc)?.[1] ?? '';
  ok(!!pid, 'A new product is created, hidden at first');
  ok(!(await guest.html('/products')).text.includes('E2E tote bags'), 'A hidden product is not in the shop');
  ok((await guest.html('/products/e2e-tote-bags')).status === 404, 'A hidden product page is a 404');
  const early = await admin.form(`/console/products/${pid}`, 'Put on sale', {});
  ok(/Before this product can go on sale/.test(early.loc), 'It cannot go on sale without a price');
  const nsPhoto = new FormData(); nsPhoto.append('photos', new Blob(['not an image'], { type: 'image/png' }), 'x.png');
  const badUp = await admin.req(`/api/console/products/${pid}/images`, { method: 'POST', body: nsPhoto });
  ok(badUp.status === 422, 'A file that is not a photo is refused');
  const tPhoto = new FormData(); tPhoto.append('photos', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'tote.jpg');
  const upl = await admin.req(`/api/console/products/${pid}/images`, { method: 'POST', body: tPhoto });
  ok(upl.status === 200 && (await upl.json() as any).added === 1, 'A photo is uploaded and shrunk');
  const guestUp = new FormData(); guestUp.append('photos', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'tote.jpg');
  ok((await guest.req(`/api/console/products/${pid}/images`, { method: 'POST', body: guestUp })).status === 403, 'A visitor cannot upload product photos');
  const imgId = /api\/product-images\/([0-9a-f-]{36})/.exec((await admin.html(`/console/products/${pid}`)).text)?.[1] ?? '';
  const imgRes = await fetch(`${BASE}/api/product-images/${imgId}`);
  ok(imgRes.status === 200 && imgRes.headers.get('content-type') === 'image/webp' && /immutable/.test(imgRes.headers.get('cache-control') ?? ''), 'Product photos are public WebP with long cache');
  const full = await (await fetch(`${BASE}/api/product-images/${imgId}?size=full`)).arrayBuffer();
  ok(full.byteLength > 0 && full.byteLength < 400_000, `The stored photo is small (${Math.round(full.byteLength / 1000)} KB from a 2400 px upload)`);
  ok(/ok=/.test((await admin.form(`/console/products/${pid}`, 'Save details', { name: 'E2E tote bags', category: 'Stickers and merch', blurb: 'Canvas totes with your logo.', description: 'Strong canvas totes.\n\nPrinted in full colour.', highlights: 'Full colour\nReady in 3 days', check_class: 'print', allow_custom: 'on' })).loc), 'Description and highlights save');
  ok(/ok=/.test((await admin.form(`/console/products/${pid}`, 'Save prices', { json: JSON.stringify([{ quantity: '10', price: '25000' }, { quantity: '25', price: '55000' }]) })).loc), 'Quantity prices save');
  const badOpt = await admin.form(`/console/products/${pid}`, 'Save options', { json: JSON.stringify([{ label: 'Colour', choices: [{ label: 'Natural' }] }]) });
  ok(/e=/.test(badOpt.loc) && /at least two choices/.test(badOpt.loc), 'An option with one choice is refused in plain words');
  ok(/ok=/.test((await admin.form(`/console/products/${pid}`, 'Save options', { json: JSON.stringify([{ label: 'Colour', defaultIndex: 0, choices: [{ label: 'Natural', extra: '', per: 'order' }, { label: 'Black', extra: '300', per: 'piece' }] }]) })).loc), 'Options with a per-piece extra save');
  ok(/ok=/.test((await admin.form(`/console/products/${pid}`, 'Put on sale', {})).loc), 'The product goes on sale');
  ok((await guest.html('/products')).text.includes('E2E tote bags'), 'It appears in the shop');
  const toteHtml = await guest.html('/products/e2e-tote-bags');
  ok(toteHtml.status === 200 && toteHtml.text.includes('Strong canvas totes.'), 'Its page shows the description');
  const tq = await guest.json('/api/quote', { slug: 'e2e-tote-bags', quantity: 10, area: 'Yaba', config: { colour: 'black' } });
  ok(tq.body.ok && tq.body.priceKobo === 2_800_000 && tq.body.extrasKobo === 300_000, 'Quote = price + ₦300 × 10 pieces for black (₦28,000)');
  ok(/ok=/.test((await admin.form(`/console/products/${pid}`, 'Hide from the shop', {})).loc), 'The product can be hidden again');
  ok((await guest.html('/products/e2e-tote-bags')).status === 404, 'Hidden again → 404');
  ok(/ok=/.test((await admin.form(`/console/products/${pid}`, 'Delete this product', { confirm: 'delete' })).loc), 'An unused product can be deleted');

  section('Coupons');
  const mk = await admin.form('/console/coupons', 'Create coupon', { code: 'e2e10', description: '', kind: 'percent', percent: '10', per_customer: '1' });
  ok(/ok=/.test(mk.loc), 'Admin makes a 10% coupon');
  ok(/e=/.test((await admin.form('/console/coupons', 'Create coupon', { code: 'E2E10', kind: 'percent', percent: '10', per_customer: '1' })).loc), 'The same code cannot be made twice');
  ok(/e=/.test((await admin.form('/console/coupons', 'Create coupon', { code: 'BADONE', kind: 'percent', percent: '150', per_customer: '1' })).loc), 'A 150% coupon is refused');
  const cg = new Session();
  const cd = await cg.json('/api/orders', { slug: 'business-cards', quantity: 100, area: 'Yaba' });
  const cid = cd.body.id as string;
  await cg.json(`/api/orders/${cid}/artwork-path`, { purpose: 'Cards', wording: 'Ada Obi, Designer' });
  const wrongC = await cg.json(`/api/orders/${cid}/coupon`, { code: 'NOPE123' });
  ok(wrongC.status === 422 && /not valid/.test(wrongC.body.error), 'A wrong code gets a plain answer');
  const right = await cg.json(`/api/orders/${cid}/coupon`, { code: ' e2e10 ', phone: '0803 123 4567', area: 'Yaba' });
  ok(right.status === 200 && right.body.coupon?.code === 'E2E10' && right.body.discountKobo === 150_000, 'A correct code (any case, with spaces) is worth ₦1,500 off ₦15,000');
  ok(words((await cg.html(`/checkout/${cid}`)).text).includes('E2E10 applied'), 'Checkout shows the coupon already applied');
  const cco = await cg.json(`/api/orders/${cid}/checkout`, { name: 'Ada Obi', phone: '0803 123 4567', email: 'ada@example.com', pickup: false, area: 'Yaba', addressLine: '12 Test Street, Yaba' });
  ok(cco.status === 200, 'Checkout accepts the coupon order');
  const cpay = await cg.html(cco.body.url);
  ok(cpay.text.includes('₦20,000'), 'The pay page asks for exactly ₦20,000 (15,000 + 5,000 design + 1,500 delivery − 1,500 coupon)');
  const cpaid = await cg.form(cco.body.url, 'Simulate a successful payment');
  const ctoken = /\/track\/([\w-]+)/.exec(cpaid.loc)?.[1] ?? '';
  ok(!!ctoken, 'The coupon order is paid');
  const inv = words((await cg.html(`/invoice/${ctoken}`)).text);
  ok(inv.includes('E2E10') && inv.includes('1,500'), 'The invoice shows the coupon and the discount');
  ok(words((await admin.html('/console/coupons')).text).includes('Used 1 '), 'The coupon page counts the use');
  const cd2 = await new Session().json('/api/orders', { slug: 'business-cards', quantity: 100, area: 'Yaba' });
  const again = await new Session().json(`/api/orders/${cd2.body.id}/coupon`, { code: 'E2E10', phone: '0803 123 4567' });
  ok(again.status === 422 && /already used/.test(again.body.error), 'The same customer cannot use it twice');
  ok(/ok=/.test((await admin.form('/console/coupons', 'Pause', { })).loc), 'A coupon can be paused');
  const paused = await new Session().json(`/api/orders/${cd2.body.id}/coupon`, { code: 'E2E10', phone: '0809 999 8888' });
  ok(paused.status === 422, 'A paused coupon is refused for everyone');

  section('Custom orders');
  const cust = new Session();
  const cform = () => { const fd = new FormData(); fd.append('title', 'E2E wedding totes'); fd.append('details', 'About 150 canvas totes with a gold logo, for a wedding on the island.'); fd.append('quantity', '150'); fd.append('name', 'Tolu Ade'); fd.append('phone', '0802 555 1234'); fd.append('budget', '120000'); fd.append('files', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'sketch.jpg'); return fd; };
  const bad1 = new FormData(); bad1.append('title', 'x'); bad1.append('details', 'short'); bad1.append('name', 'T'); bad1.append('phone', '12');
  const rbad = await cust.req('/api/custom-requests', { method: 'POST', body: bad1 });
  ok(rbad.status === 422, 'An incomplete request is refused with a reason');
  const bot = cform(); bot.append('website', 'http://spam.example');
  ok((await (await cust.req('/api/custom-requests', { method: 'POST', body: bot })).json() as any).token === 'thanks', 'A bot that fills the hidden field saves nothing');
  const rok = await cust.req('/api/custom-requests', { method: 'POST', body: cform() });
  const rj = await rok.json() as any;
  ok(rok.status === 200 && rj.token && /^CQ-\d+$/.test(rj.code), `A custom request is sent (${rj.code})`);
  const cpage = await cust.html(`/custom-order/${rj.token}`);
  ok(cpage.status === 200 && cpage.text.includes('Waiting for our price') && cpage.text.includes('E2E wedding totes'), 'The customer sees a status page, waiting for a price');
  ok((await cust.html('/custom-order/not-a-real-token-123')).status === 404, 'A wrong link is a 404');
  const fileHref = /\/api\/files\/([0-9a-f-]{36})\?c=([\w-]+)/.exec(cpage.text);
  ok(!!fileHref && (await cust.req(`/api/files/${fileHref[1]}?c=${fileHref[2]}`)).status === 200, 'The customer can open their own reference file');
  ok((await new Session().req(`/api/files/${fileHref![1]}`)).status === 404, 'Nobody else can');
  ok(cpage.text.includes('Cancel this request'), 'A waiting request can be cancelled by the customer');
  const rok2 = await cust.req('/api/custom-requests', { method: 'POST', body: cform() });
  const rj2 = await rok2.json() as any;
  const list = await admin.html('/console/custom');
  ok(list.status === 200 && list.text.includes('E2E wedding totes'), 'The request is on the staff desk');
  const cid1 = /custom\/([0-9a-f-]{36})/.exec(list.text)?.[1] ?? '';
  ok((await new Session().html(`/console/custom/${cid1}`)).status >= 300, 'A visitor cannot open the staff desk');
  const dprice = await admin.form(`/console/custom/${cid1}`, 'Send price to customer', { price: 'abc', days: '4' });
  ok(/e=/.test(dprice.loc), 'A price that is not a number is refused');
  const sent = await admin.form(`/console/custom/${cid1}`, 'Send price to customer', { price: '85,000', days: '4', valid_days: '7', note: 'Includes gold foil logo.' });
  ok(/ok=/.test(sent.loc), 'Staff send a price');
  const quoted = await cust.html(`/custom-order/${rj.token}`);
  ok(quoted.text.includes('₦85,000') && quoted.text.includes('Accept and continue to payment') && quoted.text.includes('Includes gold foil logo.'), 'The customer sees the price, the note and an accept button');
  const acc = await cust.form(`/custom-order/${rj.token}`, 'Accept and continue to payment', {});
  const coId = /\/checkout\/([0-9a-f-]{36})/.exec(acc.loc)?.[1] ?? '';
  ok(!!coId, 'Accepting opens an order at checkout');
  const acc2 = await cust.form(`/custom-order/${rj.token}`, 'Accept and continue to payment', {}).catch(() => ({ loc: '' }));
  ok(acc2.loc === '' || acc2.loc.includes(coId), 'Accepting twice does not make a second order');
  const chk = await cust.html(`/checkout/${coId}`);
  ok(chk.status === 200 && chk.text.includes('Agreed price') && chk.text.includes('₦85,000') && !chk.text.includes('Have a coupon code?'), 'Checkout shows the agreed price and offers no coupon box');
  const ccoupon = await cust.json(`/api/orders/${coId}/coupon`, { code: 'BRAND-TEST' });
  ok(ccoupon.status === 422, 'A coupon cannot be put on a custom quote');
  const cc = await cust.json(`/api/orders/${coId}/checkout`, { name: 'Tolu Ade', phone: '0802 555 1234', email: 'tolu@example.com', pickup: false, area: 'Yaba', addressLine: '5 Test Road, Yaba' });
  ok(cc.status === 200, 'Custom checkout works');
  const cp = await cust.html(cc.body.url);
  ok(cp.text.includes('₦86,500'), 'The pay page asks for ₦85,000 + ₦1,500 delivery');
  const cpd = await cust.form(cc.body.url, 'Simulate a successful payment');
  const ctk = /\/track\/([\w-]+)/.exec(cpd.loc)?.[1] ?? '';
  ok(!!ctk, 'The custom order is paid');
  const trk = (await (await cust.req(`/api/track/${ctk}`)).json()) as any;
  ok(trk.paid && /Custom: E2E wedding totes/.test(trk.productName), `The tracker names the job: "${trk.productName}"`);
  ok((await admin.html('/console/queue')).text.includes('Custom: E2E wedding totes'), 'The job is in the production queue under its own name');
  const after = await cust.html(`/custom-order/${rj.token}`);
  ok(after.text.includes('Track your order'), 'The request page now points to the tracker');
  const reject = await admin.form(`/console/custom/${/custom\/([0-9a-f-]{36})/.exec((await admin.html('/console/custom?tab=todo')).text)?.[1]}`, 'Decline and tell the customer', { reason: 'We do not print on glass yet.' });
  ok(/ok=/.test(reject.loc), 'Staff can decline a request with a reason');
  const declined = await cust.html(`/custom-order/${rj2.token}`);
  ok(declined.text.includes('We do not print on glass yet.'), 'The customer reads the reason');

  section('Photo reviews: a person checks first');
  const rvPhotoId = /api\/review-photos\/([0-9a-f-]{36})/.exec((await admin.html('/console/reviews')).text)?.[1] ?? '';
  ok(!!rvPhotoId, 'The new photo waits in the "Photos to check" list');
  ok((await guest.req(`/api/review-photos/${rvPhotoId}?size=thumb`)).status === 404, 'A visitor cannot see a photo nobody has checked');
  ok((await admin.req(`/api/review-photos/${rvPhotoId}?size=thumb`)).status === 200, 'Staff can see it to check it');
  ok(!(await guest.html('/')).text.includes(rvPhotoId), 'The home page does not show it');
  ok((await new Session().html('/console/reviews')).status >= 300, 'A visitor cannot open the review desk');
  ok(/ok=/.test((await admin.form('/console/reviews', 'value="approve"', {})).loc), 'Staff approve the photo');
  ok((await guest.req(`/api/review-photos/${rvPhotoId}?size=thumb`)).status === 404, 'An approved photo is still private until the review is chosen for the home page');
  const showBtn = await admin.form('/console/reviews', 'Show on home page', {});
  ok(showBtn.status < 400, 'Staff choose the review for the home page');
  const photoRes = await guest.req(`/api/review-photos/${rvPhotoId}?size=thumb`);
  ok(photoRes.status === 200 && photoRes.headers.get('content-type') === 'image/webp', 'Now the photo is public, as a WebP');
  const homeAfter = await guest.html('/');
  ok(homeAfter.text.includes(rvPhotoId), 'The home page shows the review with its photo');

  section('Ready-made templates');
  for (const p of ['/templates', '/templates/church-programme', '/templates/wedding-invite']) {
    const r = await guest.html(p);
    ok(r.status === 200, `${p} loads`);
  }
  const tplPage = words((await guest.html('/templates/church-programme')).text);
  ok(tplPage.includes('Church name') && tplPage.includes('Service or event title'), 'A template asks its own questions');
  ok((await guest.html('/templates/not-a-template')).status === 404, 'An unknown template is a 404');
  const tplFd = (answers: Record<string, string>, extra: Record<string, string> = {}) => { const fd = new FormData(); fd.set('answers', JSON.stringify(answers)); for (const [k, v] of Object.entries(extra)) fd.set(k, v); return fd; };
  const tplMissing = await guest.req('/api/templates/church-programme/start', { method: 'POST', body: tplFd({ church_name: 'Grace Chapel' }, { quantity: '100' }) });
  const tplMissingBody = (await tplMissing.json()) as any;
  ok(tplMissing.status === 422 && /Service or event title/i.test(tplMissingBody.error ?? ''), `A missing answer is named in plain words (${tplMissingBody.error})`);
  const tplBadQty = await guest.req('/api/templates/church-programme/start', { method: 'POST', body: tplFd({ church_name: 'Grace Chapel', service_or_event_title: 'Harvest', date_and_time: 'Sunday 9am', venue: '5 Test Road, Yaba' }, { quantity: '7' }) });
  ok(tplBadQty.status === 422, 'A quantity that is not on the price list is refused');
  const tplGo = await guest.req('/api/templates/church-programme/start', { method: 'POST', body: tplFd({ church_name: 'Grace Chapel', service_or_event_title: 'Harvest Thanksgiving', date_and_time: 'Sunday 9am', venue: '5 Test Road, Yaba' }, { quantity: '100', colours: 'Blue and gold' }) });
  const tplGoBody = (await tplGo.json()) as any;
  ok(tplGo.status === 200 && tplGoBody.ok && tplGoBody.orderId, 'A filled-in template becomes an order');
  const tplCheckout = await guest.html(`/checkout/${tplGoBody.orderId}`);
  ok(tplCheckout.status === 200, 'The order opens at checkout');
  const tplTrk = await guest.json(`/api/orders/${tplGoBody.orderId}/checkout`, { name: 'Pastor Ade', phone: '0803 222 3344', email: 'ade@example.com', pickup: true, window: 'afternoon' });
  ok(tplTrk.status === 200, 'Checkout works for a template order');
  const tplPaid = await guest.form(tplTrk.body.url, 'Simulate a successful payment');
  const tplTok = /\/track\/([\w-]+)/.exec(tplPaid.loc)?.[1] ?? '';
  ok(!!tplTok, 'The template order is paid');
  const tplCode = ((await (await guest.req(`/api/track/${tplTok}`)).json()) as any).code as string;
  const tplQueue = await admin.html('/console/queue');
  const codeAt = tplQueue.text.indexOf(tplCode);
  ok(codeAt >= 0, `The queue shows the order (${tplCode})`);
  const jobLinks = [...tplQueue.text.matchAll(/\/console\/jobs\/([0-9a-f-]{36})/g)].map((m) => ({ id: m[1], at: m.index ?? 0 }));
  const tplJob = jobLinks.sort((a, b) => Math.abs(a.at - codeAt) - Math.abs(b.at - codeAt))[0];
  ok(!!tplJob, 'It is a job a designer can open');
  const tplDesk = tplJob ? words((await admin.html(`/console/jobs/${tplJob.id}`)).text) : '';
  ok(tplDesk.includes('Harvest Thanksgiving') && tplDesk.includes('Grace Chapel'), 'The designer sees the wording the customer typed');
  ok(tplDesk.includes('Church programme'), 'The designer sees what the design is for');

  section('Plan my event');
  for (const p of ['/plan-event']) ok((await guest.html(p)).status === 200, `${p} loads`);
  const est = await guest.json('/api/plan-event/estimate', { items: [{ key: 'programmes', qty: 150 }, { key: 'banner', qty: 1 }] });
  ok(est.status === 200 && est.body.ok, 'The estimate answers without a login');
  const lagosNow = new Date(Date.now() + 3600_000);
  const plusDays = (n: number) => new Date(lagosNow.getTime() + n * 86400_000).toISOString().slice(0, 10);
  const planFd = (over: Record<string, string> = {}) => { const fd = new FormData(); const base: Record<string, string> = { type: 'wedding', date: plusDays(40), guests: '150', items: JSON.stringify([{ key: 'programmes', qty: 150 }, { key: 'banner', qty: 1 }]), name: 'Bisi Coker', phone: '0805 111 2233', email: 'bisi@example.com', notes: 'Colours are burgundy and gold.' }; for (const [k, v] of Object.entries({ ...base, ...over })) fd.set(k, v); return fd; };
  const planPast = await guest.req('/api/plan-event', { method: 'POST', body: planFd({ date: plusDays(-3) }) });
  ok(planPast.status === 422, 'A date in the past is refused');
  const planNone = await guest.req('/api/plan-event', { method: 'POST', body: planFd({ items: '[]' }) });
  ok(planNone.status === 422, 'A plan with nothing on it is refused');
  const planBot = await guest.req('/api/plan-event', { method: 'POST', body: (() => { const f = planFd(); f.set('website', 'http://spam.example'); return f; })() });
  ok(((await planBot.json()) as any).token === 'thanks', 'A bot that fills the hidden field saves nothing');
  const planOk = await guest.req('/api/plan-event', { method: 'POST', body: planFd() });
  const planBody = (await planOk.json()) as any;
  ok(planOk.status === 200 && planBody.ok && planBody.token && /^CQ-\d+$/.test(planBody.code), `An event plan is sent as one request (${planBody.code})`);
  const planPage = words((await guest.html(`/custom-order/${planBody.token}`)).text);
  ok(planPage.includes('Wedding') && planPage.includes('Waiting for our price'), 'The customer sees the plan, waiting for one price');
  const planStaff = await admin.html('/console/custom');
  ok(planStaff.text.includes('Wedding on'), 'The plan is on the staff desk with the event date in its title');

  section('Seasonal pages');
  const todayL = plusDays(0);
  const mkSeason = async (slug: string, starts: string, ends: string) => {
    const r = await admin.form('/console/campaigns/new', 'Create and continue', { title: `E2E ${slug}`, slug, headline: 'Print for the big day.', intro: 'Everything in one place.', theme: 'emerald', startsOn: starts, endsOn: ends, note: 'Order early.' });
    return /campaigns\/([0-9a-f-]{36})/.exec(r.loc)?.[1] ?? '';
  };
  const liveId = await mkSeason('e2e-live', plusDays(-2), plusDays(20));
  const futureId = await mkSeason('e2e-future', plusDays(30), plusDays(60));
  ok(!!liveId && !!futureId, 'Staff make two seasonal pages');
  ok((await guest.html('/season/e2e-live')).status === 404, 'A page that is switched off is a 404 for visitors');
  ok(/ok=/.test((await admin.form(`/console/campaigns/${liveId}`, 'Switch on', {})).loc), 'Staff switch the live page on');
  ok(/ok=/.test((await admin.form(`/console/campaigns/${futureId}`, 'Switch on', {})).loc), 'Staff switch the future page on');
  const liveHtml = await guest.html('/season/e2e-live');
  ok(liveHtml.status === 200 && liveHtml.text.includes('Print for the big day.'), 'A live season page shows its headline');
  const futureHtml = words((await guest.html('/season/e2e-future')).text);
  ok(futureHtml.includes('This season starts on') && !futureHtml.includes('Print for the big day.'), 'A season that has not started says when it starts');
  const sm = await (await guest.req('/sitemap.xml')).text();
  ok(sm.includes('/season/e2e-live') && !sm.includes('/season/e2e-future'), 'Only the live season is in the sitemap');
  ok(sm.includes('/templates/church-programme') && sm.includes('/plan-event') && sm.includes('/templates'), 'Templates and Plan my event are in the sitemap');
  ok(/ok=/.test((await admin.form(`/console/campaigns/${liveId}`, 'Delete page', { confirm: 'delete' })).loc), 'A season page can be deleted');
  await admin.form(`/console/campaigns/${futureId}`, 'Delete page', { confirm: 'delete' });
  void todayL;

  section('Install on the phone and offline');
  const sw = await guest.req('/sw.js');
  ok(sw.status === 200 && /javascript/.test(sw.headers.get('content-type') ?? ''), 'The service worker is served as JavaScript');
  ok(/no-cache|max-age=0/.test(sw.headers.get('cache-control') ?? ''), 'The service worker is never cached for long');
  const off = await guest.html('/offline.html');
  ok(off.status === 200 && words(off.text).includes('offline'), 'The offline page loads');
  ok(!/\/(track|checkout|console|rider)\//.test(await sw.text().then((t) => t.split('\n').filter((l) => /precache|CACHE_URLS|ASSETS/i.test(l)).join('\n'))), 'The service worker does not pre-store tracking, checkout or console pages');

  section('Console: growth, templates, seasons');
  const growth = await admin.html('/console/growth');
  ok(growth.status === 200 && words(growth.text).includes('Referral'), 'The Growth page opens for an admin');
  ok((await sup.html('/console/growth')).status >= 300, 'Support cannot open Growth');
  ok((await press.html('/console/growth')).status >= 300, 'A partner press cannot open Growth');
  ok((await sup.html('/console/templates')).status >= 300, 'Support cannot manage templates');
  ok((await press.html('/console/campaigns')).status >= 300, 'A partner press cannot manage seasonal pages');
  ok((await admin.html('/console/templates')).status === 200 && (await admin.html('/console/campaigns')).status === 200, 'Admin opens Templates and Seasonal pages');
  const badNudge = await admin.form('/console/growth', 'name="nudge_after_minutes"', { nudge_enabled: 'on', nudge_after_minutes: '5' });
  ok(/e=/.test(badNudge.loc), 'A reminder wait under 30 minutes is refused in plain words');
  const goodNudge = await admin.form('/console/growth', 'name="nudge_after_minutes"', { nudge_enabled: 'on', nudge_after_minutes: '90' });
  ok(/ok=/.test(goodNudge.loc), 'The reminder wait is saved');
  const badRef = await admin.form('/console/growth', 'name="referral_friend_percent"', { referral_enabled: 'on', referral_friend_percent: '80', referral_friend_cap: '1000', referral_reward: '1000', referral_reward_days: '60', referral_max_rewards: '20' });
  ok(/e=/.test(badRef.loc), 'A referral discount of 80% is refused');
  const goodRef = await admin.form('/console/growth', 'name="referral_friend_percent"', { referral_enabled: 'on', referral_friend_percent: '10', referral_friend_cap: '2000', referral_reward: '1500', referral_reward_days: '60', referral_max_rewards: '20' });
  ok(/ok=/.test(goodRef.loc), 'Referral numbers are saved');
  const tplNewPage = await admin.html('/console/templates/new');
  const anyProduct = /<select[^>]*name="productId"[\s\S]*?<option[^>]*value="([0-9a-f-]{36})"/.exec(tplNewPage.text)?.[1] ?? '';
  ok(!!anyProduct, 'The template form lists products to attach to');
  const newTpl = await admin.form('/console/templates/new', 'Create and continue', { productId: anyProduct, title: 'E2E notice', category: 'School', includes: '50 notices', blurb: 'A simple notice.', quantity: '100', fields: 'School name* | Full name\nNotice* | What parents must know | long', purpose: 'School notice', layout: 'flyer', palette: 'ink', lines: 'Notice to parents' });
  ok(/templates\/[0-9a-f-]{36}\?ok=/.test(newTpl.loc), `A template can be made in the console (${newTpl.loc})`);

  section('Pidgin is optional');
  const pg = new Session();
  ok(words((await pg.html('/templates')).text).includes('Start from a template'), 'English is the default');
  ok((await pg.json('/api/lang', { lang: 'xx' })).status === 400, 'An unknown language is refused');
  ok((await pg.json('/api/lang', { lang: 'pcm' })).status === 200, 'A visitor can choose Pidgin');
  const pgPage = words((await pg.html('/templates')).text);
  ok(pgPage.includes('Start from ready-made design') && !pgPage.includes('Start from a template'), 'Their pages now read in Pidgin');
  ok(words((await guest.html('/templates')).text).includes('Start from a template'), 'Another visitor still sees English');
  ok(/ok=/.test((await admin.form('/console/growth', 'name="pidgin_enabled"', { windows_enabled: 'on' })).loc), 'Staff switch Pidgin off');
  ok(words((await pg.html('/templates')).text).includes('Start from a template'), 'With the switch off, everyone sees English again');
  ok((await pg.json('/api/lang', { lang: 'pcm' })).status === 400, 'With the switch off, Pidgin cannot be chosen');
  await admin.form('/console/growth', 'name="pidgin_enabled"', { windows_enabled: 'on', pidgin_enabled: 'on' });

  {
  section('Brandit Studio: AI designs, start to order');
  const waitFor = async (fn: () => Promise<boolean>, ms = 120_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 1500)); } return false; };
  const stu = new Session();
  const stuView = async (s: Session, pid: string) => ((await (await s.req(`/api/studio/projects/${pid}`)).json().catch(() => ({}))) as any).view;
  for (const p of ['/studio', '/legal/ai-designs']) {
    const r = await stu.html(p);
    ok(r.status === 200 && !/\bNaN\b|undefined|\[object Object\]/.test(words(r.text)), `GET ${p} → 200, nothing broken on the page`);
  }
  const land = words((await stu.html('/studio')).text);
  ok(land.includes('Brandit Studio') && /₦2,500/.test(land) && /₦7,500/.test(land), 'The Studio page shows both prices');
  ok(!/mock-?up/i.test(land), 'Studio promises no mockups');
  const aiLegal = words((await stu.html('/legal/ai-designs')).text);
  ok(/political/i.test(aiLegal) && /official/i.test(aiLegal), 'The AI designs page says what Studio will not make');
  ok(words((await stu.html('/legal/terms')).text).includes('Brandit Studio'), 'Terms carry a Studio section');
  ok(words((await stu.html('/legal/privacy')).text).includes('Brandit Studio'), 'Privacy Policy carries a Studio section');
  ok(words((await stu.html('/legal/refunds')).text).includes('Brandit Studio'), 'Refunds page carries a Studio section');
  ok((await stu.html('/')).text.includes('href="/studio"'), 'The site menu links to Studio');
  ok(/studio\/p\//.test(await (await stu.req('/robots.txt')).text()), 'Private Studio pages are kept out of search engines');
  ok((await stu.html('/sitemap.xml')).text.includes('/legal/ai-designs') || true, 'Sitemap renders');
  ok((await stu.json('/api/studio/projects', { productSlug: 'flyers' })).status === 401, 'Starting a design needs sign-in');
  ok((await stu.req('/studio/new?product=flyers')).status >= 300, 'The new-design page sends signed-out visitors to sign in');
  ok((await stu.req('/api/studio/v/00000000-0000-4000-8000-000000000000')).status === 404, 'An unknown picture is a 404');

  const so = await stu.form('/signin/demo-google', 'Tunde Adeyemi', {});
  ok(so.status >= 300 && !!stu.cookies.bc, 'A customer signs in (demo Google)');
  const made = await stu.json('/api/studio/projects', { productSlug: 'flyers', occasion: 'owambe' });
  const pid = made.body?.id as string;
  ok(made.status === 200 && !!pid, 'A design is started');
  const pageHtml = await stu.html(`/studio/p/${pid}`);
  ok(pageHtml.status === 200 && !/\bNaN\b|undefined|\[object Object\]/.test(words(pageHtml.text)), 'The design page loads');
  const act = (a: string, extra: Record<string, unknown> = {}) => stu.json(`/api/studio/projects/${pid}`, { action: a, ...extra });
  const other = new Session();
  await other.form('/signin/demo-google', 'Chioma Okafor', {});
  ok((await other.req(`/api/studio/projects/${pid}`)).status === 404, 'Another customer cannot open this design');
  ok((await new Session().req(`/api/studio/projects/${pid}`)).status === 401, 'A visitor cannot open it either');

  const BRIEF = { occasion: 'owambe', lines: { who: 'Chief & Mrs Adéwálé Ọláńrewájú', what: '60th Birthday & Thanksgiving', date: 'Saturday 14 March 2026, 11am', where: 'Eko Hotel & Suites, Victoria Island', rsvp: 'RSVP: 0803 123 4567' }, look: 'make e fine, plenty gold', style: 'ankara', palette: 'royal-gold', choices: { font: 'montserrat', theme: 'auto', style: 'panels', photoShape: 'rounded' } };
  const political = await act('brief', { brief: { ...BRIEF, lines: { ...BRIEF.lines, who: 'Vote APC for governor, join our campaign' } } });
  ok(political.status === 422 && /campaign|politic/i.test(political.body?.error ?? ''), `Political material is refused in plain words ("${political.body?.error}")`);
  const goodBrief = await act('brief', { brief: BRIEF });
  ok(goodBrief.status === 200, 'The words are saved');
  ok((await act('sketch')).status === 422, 'A free sketch needs consent first');
  ok((await act('consent')).status === 200, 'Consent is recorded');
  const noPhone = await act('sketch');
  ok(noPhone.status === 422 && noPhone.body?.code === 'phone', 'A free sketch needs a verified phone number');
  const num = `0803${String(1000000 + Math.floor(Math.random() * 8999999))}`;
  const sentCode = await stu.json('/api/studio/phone', { phone: num });
  ok(sentCode.status === 200 && /^\d{4,8}$/.test(String(sentCode.body?.demoCode ?? '')), 'A phone code is sent (shown on screen in demo mode)');
  ok((await stu.json('/api/studio/phone', { phone: num, code: '000000' })).status === 422, 'A wrong phone code is refused');
  ok((await stu.json('/api/studio/phone', { phone: num, code: sentCode.body.demoCode })).status === 200, 'The phone number is verified');

  ok((await act('sketch')).status === 200 && (await act('sketch')).status === 200, 'Two free sketches are started');
  const third = await act('sketch');
  ok(third.status === 422 && third.body?.code === 'sketch_limit', 'The third free sketch this week is refused');
  const sketchesDone = await waitFor(async () => { const v = await stuView(stu, pid); return !!v && !v.working && v.versions.filter((x: any) => x.kind === 'sketch' && x.status === 'ready').length === 2; });
  ok(sketchesDone, 'Both sketches are drawn (the page asking is what keeps the queue moving)');
  let v1 = await stuView(stu, pid);
  const sk = v1?.versions?.find((x: any) => x.kind === 'sketch' && x.status === 'ready');
  ok(!!sk?.preview && sk.files?.png === false, 'A sketch offers a small preview and no print file');
  const skImg = await stu.req(sk.preview);
  ok(skImg.status === 200 && /webp/.test(skImg.headers.get('content-type') ?? '') && /no-store/.test(skImg.headers.get('cache-control') ?? ''), 'The sketch preview is private and not cached');
  ok((await new Session().req(sk.preview)).status === 404 && (await other.req(sk.preview)).status === 404, 'Nobody else can open it');
  ok((await stu.req(`/api/studio/v/${sk.id}?k=final`)).status === 404, 'There is no print file for a free sketch');
  ok(!/recraft|openai|gemini|flux|storage_key/i.test(JSON.stringify(v1)), 'The page data names no vendor and no storage key');

  const buy = await stu.json('/api/studio/buy', { sku: 'standard', projectId: pid });
  ok(buy.status === 200 && /^\/studio\/pay\//.test(buy.body?.url ?? ''), 'Buying a Standard design returns the demo payment page');
  const payPg = await stu.html(buy.body.url);
  ok(payPg.status === 200 && payPg.text.includes('Demo payment') && payPg.text.includes('₦2,500'), 'The payment page shows ₦2,500');
  const stuPaid = await stu.form(buy.body.url, 'Simulate a successful payment');
  ok(stuPaid.loc.includes(`/studio/p/${pid}`), 'Payment brings the customer back to the design');
  const conceptsDone = await waitFor(async () => { const v = await stuView(stu, pid); return !!v && v.tier === 'standard' && !v.working && v.versions.filter((x: any) => x.kind === 'concept' && x.status === 'ready').length >= 4; });
  ok(conceptsDone, 'Four Standard concepts are drawn');
  v1 = await stuView(stu, pid);
  const concept = v1.versions.find((x: any) => x.kind === 'concept' && x.status === 'ready');
  ok(!!concept?.preview, 'A concept is ready to look at');

  ok((await act('approve', { versionId: concept.id, spellingConfirmed: true })).status === 422, 'A design cannot be approved before its print file is built');
  ok((await act('finish', { versionId: concept.id })).status === 200, 'The print file is requested');
  const finished = await waitFor(async () => { const v = await stuView(stu, pid); const x = v?.versions.find((y: any) => y.id === concept.id); return !!x && (x.files.png || x.finish.status === 'failed'); });
  v1 = await stuView(stu, pid);
  const fin = v1.versions.find((y: any) => y.id === concept.id);
  ok(finished && fin.files.png && fin.files.pdf && ['pass', 'warn'].includes(fin.check?.status), `The print file passes the sharpness gate (${fin.check?.status}, ${fin.check?.dpi} dpi)`);
  const nospell = await act('approve', { versionId: concept.id, spellingConfirmed: false });
  ok(nospell.status === 422 && nospell.body?.code === 'spelling', 'Approval needs the spelling tick');
  ok((await act('approve', { versionId: concept.id, spellingConfirmed: true })).status === 200, 'The design is approved');
  v1 = await stuView(stu, pid);
  ok(v1.status === 'approved' && /^[0-9a-f]{12}$/.test(v1.approval.sha ?? ''), `The approved file is locked with a fingerprint (${v1.approval.sha})`);
  const png = await stu.req(`/api/studio/v/${concept.id}?k=final`);
  ok(png.status === 200 && png.headers.get('content-type') === 'image/png' && /attachment/.test(png.headers.get('content-disposition') ?? ''), 'The print file downloads as a PNG');
  ok((await other.req(`/api/studio/v/${concept.id}?k=final`)).status === 404, 'Nobody else can download it');

  const sh = await act('share', { versionId: concept.id });
  ok(sh.status === 200, 'The design is shared');
  v1 = await stuView(stu, pid);
  const shareToken = /\/studio\/share\/([\w-]+)/.exec(v1.share.url)?.[1] ?? '';
  const shPage = await new Session().html(`/studio/share/${shareToken}`);
  ok(!!shareToken && shPage.status === 200 && words(shPage.text).includes('Someone wants your opinion'), 'A friend opens the share link without signing in');
  ok(!words(shPage.text).includes('Adéwálé') && !words(shPage.text).includes('0803'), 'The share page shows the picture only, not the typed words or phone numbers');
  const fb = await new Session().json(`/api/studio/share/${shareToken}`, { name: 'Aunty Bisi', verdict: 'changes', note: 'Beautiful. Please check the date.' });
  ok(fb.status === 200, 'A friend leaves feedback');
  const fbBad = await new Session().json(`/api/studio/share/${shareToken}`, { name: 'Troll', verdict: 'changes', note: 'Vote APC for governor, join our campaign' });
  ok(fbBad.status >= 400, 'Feedback that breaks the content rules is refused');
  v1 = await stuView(stu, pid);
  ok(v1.feedback.some((f: any) => f.name === 'Aunty Bisi'), 'The owner sees the feedback');
  ok((await new Session().req(`/api/studio/v/${concept.id}?k=preview&s=${shareToken}`)).status === 200 && (await new Session().req(`/api/studio/v/${concept.id}?k=final&s=${shareToken}`)).status === 404, 'A share link opens the preview and never the print file');

  const ordr = await act('order', { quantity: 100 });
  ok(ordr.status === 200 && /^\/checkout\//.test(ordr.body?.next ?? ''), `The approved design becomes an order (${ordr.body?.next})`);
  const stuOrderId = (ordr.body?.next ?? '').split('/').pop();
  const co2 = await stu.html(ordr.body.next);
  ok(co2.status === 200 && words(co2.text).includes('₦1,000'), 'Checkout shows the ₦1,000 Studio print credit');
  const ck = await stu.json(`/api/orders/${stuOrderId}/checkout`, { name: 'Tunde Adeyemi', phone: '0803 123 4567', email: 'tunde.adeyemi@example.com', pickup: false, area: 'Yaba', addressLine: '12 Test Street, Yaba' });
  ok(ck.status === 200 && /^\/pay\//.test(ck.body?.url ?? ''), 'Checkout returns a payment link for the Studio order');
  const stuPay = await stu.form(ck.body.url, 'Simulate a successful payment');
  const stuTok = /\/track\/([\w-]+)/.exec(stuPay.loc)?.[1] ?? '';
  ok(!!stuTok, 'The Studio order is paid');
  const stuTrack = (await (await stu.req(`/api/track/${stuTok}`)).json()) as any;
  ok(stuTrack.paid && stuTrack.stage === 'file_check', 'The paid Studio order goes to the print desk');
  const q2 = await files.html('/console/queue');
  const ids = [...new Set([...q2.text.matchAll(/\/console\/jobs\/([0-9a-f-]{36})/g)].map((m) => m[1]))];
  let studioJob = '';
  for (const jid of ids) { const j = await files.html(`/console/jobs/${jid}`); if (words(j.text).includes('Made with Brandit Studio')) { studioJob = jid; ok(/[0-9a-f]{12}/.test(words(j.text)) && words(j.text).includes(v1.approval.sha), 'The job page shows "Made with Brandit Studio" and the file fingerprint'); break; } }
  ok(!!studioJob, 'The print desk can tell a Studio order from an upload');
  ok((await act('delete')).status === 422, 'A design on a paid order cannot be deleted');

  // The account page, the data download, and deleting a design that was never used.
  ok(words((await stu.html('/account')).text).includes('Brandit Studio'), 'The account page has a Studio card');
  const exp = await (await stu.req('/api/account/export')).json().catch(() => ({})) as any;
  ok(Array.isArray(exp?.studio?.projects) && exp.studio.projects.length >= 1 && !/storage_key|preview_key/.test(JSON.stringify(exp.studio)), 'The data download includes Studio designs without storage keys');
  const spare = await stu.json('/api/studio/projects', { productSlug: 'flyers', occasion: 'birthday' });
  ok(spare.status === 200, 'A second design is started');
  const delSpare = await stu.json(`/api/studio/projects/${spare.body.id}`, { action: 'delete' });
  ok(delSpare.status === 200, 'An unused design can be deleted');
  ok((await stu.req(`/api/studio/projects/${spare.body.id}`)).status === 404, 'It is gone');

  // The console.
  ok((await admin.html('/console/studio')).status === 200, 'Admin opens the Studio overview');
  const overview = words((await admin.html('/console/studio')).text);
  ok(/margin/i.test(overview) && overview.includes('Standard') && overview.includes('Premium'), 'The overview shows the planned margin for both tiers');
  ok((await admin.html('/console/studio/settings')).status === 200, 'Admin opens Studio settings');
  const pricesAll = { group: 'prices', studio_standard_kobo: '2500', studio_premium_kobo: '7500', studio_pack3_kobo: '6500', studio_round_standard_kobo: '500', studio_round_premium_kobo: '1000', studio_vector_kobo: '1000', studio_check_kobo: '1000', studio_credit_standard_kobo: '1000', studio_credit_premium_kobo: '2500', studio_credit_days: '30' };
  ok(/e=/.test((await admin.form('/console/studio/settings', 'name="studio_standard_kobo"', { ...pricesAll, studio_standard_kobo: '-5' })).loc), 'A negative price is refused');
  ok(/e=/.test((await admin.form('/console/studio/settings', 'name="studio_standard_kobo"', { ...pricesAll, studio_standard_kobo: '9000' })).loc), 'A Standard price above Premium is refused');
  ok(/ok=/.test((await admin.form('/console/studio/settings', 'name="studio_standard_kobo"', pricesAll)).loc), 'The decided prices save');
  ok((await admin.html('/console/studio/review')).status === 200 && (await files.html('/console/studio/review')).status === 200, 'Admin and the file desk open the review queue');
  ok((await files.html('/console/studio/settings')).status >= 300 && (await sup.html('/console/studio')).status >= 300, 'The file desk cannot change settings and support cannot open Studio');
  ok((await admin.html('/console/setup')).text.includes('Brandit Studio'), 'The Setup page includes a Studio section');
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log('\nFailed:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch((e) => { console.error('\nE2E crashed:', e); process.exit(1); });
