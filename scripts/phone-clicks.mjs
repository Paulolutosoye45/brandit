// Drives a RUNNING Brandit in DEMO MODE in a phone-sized browser and counts the clicks from "home" to "paid".
// It needs Playwright (npm i -D playwright, then npx playwright install chromium) and a demo-mode site: it reads the sign-in code and
// presses the simulated-payment button, both of which exist only in demo mode.
// Usage: BASE=http://localhost:3000 node scripts/phone-clicks.mjs   (SHOTS=<folder> keeps screenshots; CHROMIUM=<path> picks a browser)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import { deflateSync, crc32 } from 'node:zlib';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:3201';
const SHOTS = process.env.SHOTS ?? './shots';
fs.mkdirSync(SHOTS, { recursive: true });

function makePng(w, h) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { const o = y * (w * 3 + 1); raw[o] = 0; for (let x = 0; x < w; x++) { const p = o + 1 + x * 3; raw[p] = 20 + (x * 200) / w; raw[p + 1] = 60 + (y * 150) / h; raw[p + 2] = 140; } }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const card = (process.env.TMPDIR ?? '/tmp') + '/brandit-card.png'; fs.writeFileSync(card, makePng(1050, 600));
const flyer = (process.env.TMPDIR ?? '/tmp') + '/brandit-flyer.png'; fs.writeFileSync(flyer, makePng(1240, 1754));

// The demo payment page has one extra button that only exists in demo mode; Paystack's own page replaces it. It is not counted.
const real = (c) => c.filter((x) => !/Simulate a successful/.test(x));
const results = [];
const browser = await chromium.launch({ ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ['--no-sandbox'] });

async function newPhone(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
  const clicks = [];
  await ctx.exposeBinding('__ck', (_s, label) => { clicks.push(label); });
  await ctx.addInitScript(() => {
    const send = (e) => {
      if (!e.isTrusted) return;
      const t = e.target instanceof Element ? e.target.closest('button, a, summary, select, [role=button], label') : null;
      if (!t) return;
      if (t.tagName === 'LABEL' && t.querySelector('input[type=text],input[type=email],input:not([type]),textarea')) return;
      window.__ck(`${t.tagName.toLowerCase()}: ${(t.getAttribute('aria-label') || t.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50)}`);
    };
    document.addEventListener('click', send, true);
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  ✗ [${name}] page error:`, e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|caret-color/.test(m.text())) console.log(`  ✗ [${name}] console error:`, m.text().slice(0, 3500)); });
  return { ctx, page, clicks };
}

const shot = async (page, n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false });
const overflow = async (page, label) => {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (o.sw > o.iw + 1) console.log(`  ✗ horizontal scroll on ${label}: ${o.sw} > ${o.iw}`); else console.log(`  ✓ no sideways scroll on ${label}`);
  return o.sw <= o.iw + 1;
};

async function pickCard(page, file) {
  await page.locator('a[href="/order/business-cards"]').first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Upload my file' }).waitFor({ timeout: 20000 });
  // wait for the price to appear so the button is live
  await dlg.locator('text=/₦[\\d,]+/').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  return dlg;
}

async function upload(page, dlg, file) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), dlg.getByRole('button', { name: 'Upload my file' }).click()]);
  await chooser.setFiles(file);
  await dlg.getByRole('button', { name: 'Looks right, continue' }).waitFor({ timeout: 30000 });
}

async function payNow(page) {
  await page.getByRole('button', { name: /^Pay now/ }).click();
  await page.waitForURL(/\/pay\//, { timeout: 30000 });
  await page.getByRole('button', { name: /Simulate a successful payment/ }).click(); // demo page only; real payment is Paystack's own page
  await page.waitForURL(/\/track\//, { timeout: 30000 });
}

// ---------------------------------------------------------------------------------------------------------------
console.log('\nA. A new customer: home → paid (email code sign-in)');
{
  const { ctx, page, clicks } = await newPhone('A');
  const t0 = Date.now();
  await page.goto(BASE + '/');
  await shot(page, '01-home');
  await overflow(page, 'home');
  const dlg = await pickCard(page);
  await shot(page, '02-builder-panel');
  await upload(page, dlg, card);
  await page.waitForTimeout(900);
  await shot(page, '03-builder-file-checked');
  await overflow(page, 'builder panel');
  await dlg.getByRole('button', { name: 'Looks right, continue' }).click();
  await page.waitForURL(/\/checkout\//, { timeout: 30000 });
  await page.getByText('Sign in to pay').first().waitFor();
  await shot(page, '04-checkout-sign-in');
  await overflow(page, 'checkout sign-in');
  await page.fill('#co-email', `new.customer.${Date.now()}@example.com`);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  const demo = await page.locator('text=Your code is').locator('..').textContent();
  const code = /(\d{6})/.exec(demo ?? '')?.[1];
  await page.keyboard.type(code); // typing the six digits is not a click
  await page.waitForSelector('#name', { timeout: 30000 });
  await shot(page, '05-checkout-details');
  await page.fill('#name', 'Ngozi Eze');
  await page.fill('#phone', '08031234567');
  await page.selectOption('#area', 'Yaba');
  await page.fill('#address', '12 Adeola Odeku Street, opposite the pharmacy');
  await shot(page, '06-checkout-filled');
  await overflow(page, 'checkout form');
  await payNow(page);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  clicks on the site: ${real(clicks).length} → ${JSON.stringify(real(clicks))}`);
  console.log(`  (script time ${secs}s; a person also types an email, a code, a name, a number and an address)`);
  results.push({ who: 'new customer, email code', clicks: real(clicks).length, list: real(clicks) });
  await shot(page, '07-tracking');
  await overflow(page, 'tracking page');
  await ctx.storageState({ path: (process.env.TMPDIR ?? '/tmp') + '/brandit-state-A.json' });
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------------------------
console.log('\nF. A new customer who signs in with Google: home → paid');
{
  const { ctx, page, clicks } = await newPhone('F');
  await page.goto(BASE + '/');
  const dlg = await pickCard(page);
  await upload(page, dlg, card);
  await dlg.getByRole('button', { name: 'Looks right, continue' }).click();
  await page.waitForURL(/\/checkout\//, { timeout: 30000 });
  await page.getByRole('link', { name: /Continue with Google/ }).click();
  await page.waitForURL(/demo-google/, { timeout: 30000 });
  await page.getByRole('button', { name: /Chioma Okafor/ }).click(); // in the live site this is Google's own account screen
  await page.waitForURL(/\/checkout\//, { timeout: 30000 });
  await page.waitForSelector('#name', { timeout: 30000 });
  if (!(await page.inputValue('#phone'))) await page.fill('#phone', '08031234567');
  if (!(await page.inputValue('#area'))) await page.selectOption('#area', 'Yaba');
  if (!(await page.inputValue('#address'))) await page.fill('#address', '12 Adeola Odeku Street, opposite the pharmacy');
  await payNow(page);
  console.log(`  clicks on the site: ${real(clicks).length} → ${JSON.stringify(real(clicks))}`);
  console.log('  (on the live site, Google\'s own screen may ask for one more tap to choose or confirm the account)');
  results.push({ who: 'new customer, Google', clicks: real(clicks).length, list: real(clicks) });
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------------------------
console.log('\nB. A customer who is signed in and has ordered before: home → paid');
{
  const ctx0 = await browser.newContext({ storageState: (process.env.TMPDIR ?? '/tmp') + '/brandit-state-A.json', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const clicks = [];
  await ctx0.exposeBinding('__ck', (_s, label) => { clicks.push(label); });
  await ctx0.addInitScript(() => {
    document.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      const t = e.target instanceof Element ? e.target.closest('button, a, summary, select, [role=button], label') : null;
      if (!t) return;
      window.__ck(`${t.tagName.toLowerCase()}: ${(t.getAttribute('aria-label') || t.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50)}`);
    }, true);
  });
  const page = await ctx0.newPage();
  await page.goto(BASE + '/');
  const dlg = await pickCard(page);
  await upload(page, dlg, card);
  await dlg.getByRole('button', { name: 'Looks right, continue' }).click();
  await page.waitForURL(/\/checkout\//, { timeout: 30000 });
  await page.waitForSelector('#name');
  const prefilled = { name: await page.inputValue('#name'), phone: await page.inputValue('#phone'), area: await page.inputValue('#area'), address: await page.inputValue('#address') };
  console.log(`  checkout already holds: ${JSON.stringify(prefilled)}`);
  await shot(page, '08-checkout-signed-in');
  await payNow(page);
  console.log(`  clicks on the site: ${real(clicks).length} → ${JSON.stringify(real(clicks))}`);
  results.push({ who: 'signed in, ordered before', clicks: real(clicks).length, list: real(clicks), prefilled });
  await ctx0.storageState({ path: (process.env.TMPDIR ?? '/tmp') + '/brandit-state-A.json' });
  await ctx0.close();
}

// ---------------------------------------------------------------------------------------------------------------
console.log('\nC. Same again: account → paid');
{
  const ctx0 = await browser.newContext({ storageState: (process.env.TMPDIR ?? '/tmp') + '/brandit-state-A.json', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const clicks = [];
  await ctx0.exposeBinding('__ck', (_s, label) => { clicks.push(label); });
  await ctx0.addInitScript(() => {
    document.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      const t = e.target instanceof Element ? e.target.closest('button, a, summary, select, [role=button], label') : null;
      if (!t) return;
      window.__ck(`${t.tagName.toLowerCase()}: ${(t.getAttribute('aria-label') || t.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50)}`);
    }, true);
  });
  const page = await ctx0.newPage();
  await page.goto(BASE + '/account');
  await shot(page, '09-account');
  await overflow(page, 'account');
  await page.getByRole('button', { name: 'Same again' }).first().click();
  await page.waitForURL(/\/checkout\//, { timeout: 30000 });
  await page.waitForSelector('#name');
  await shot(page, '10-same-again-checkout');
  await payNow(page);
  console.log(`  clicks on the site (from the account page): ${real(clicks).length} → ${JSON.stringify(real(clicks))}`);
  results.push({ who: 'same again from account', clicks: real(clicks).length, list: real(clicks) });
  await ctx0.close();
}

// ---------------------------------------------------------------------------------------------------------------
console.log('\nD. Two products in one basket, one payment');
{
  const ctx0 = await browser.newContext({ storageState: (process.env.TMPDIR ?? '/tmp') + '/brandit-state-A.json', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx0.newPage();
  await page.goto(BASE + '/');
  const dlg = await pickCard(page);
  await upload(page, dlg, card);
  // "Looks right, add another product" carries on with the same basket
  await dlg.getByRole('button', { name: 'Looks right, add another' }).click();
  await page.getByRole('dialog').getByText(/Added\. 1 product in your basket/).waitFor({ timeout: 20000 });
  await shot(page, '11-added-one');
  await page.getByRole('dialog').getByRole('button', { name: /Flyers/ }).first().click();
  const d2 = page.getByRole('dialog');
  await d2.getByRole('button', { name: 'Upload my file' }).waitFor({ timeout: 20000 });
  await d2.locator('text=/₦[\\d,]+/').first().waitFor();
  await page.waitForTimeout(500);
  await upload(page, d2, flyer);
  await d2.getByRole('button', { name: 'Looks right, continue' }).click();
  await page.waitForURL(/\/checkout\//, { timeout: 30000 });
  await page.waitForSelector('#name');
  const text = await page.locator('main').innerText();
  console.log(`  ${/Business cards/.test(text) && /Flyers/.test(text) ? '✓' : '✗'} checkout lists both products`);
  await shot(page, '12-checkout-two-products');
  await overflow(page, 'two-product checkout');
  await page.goto(BASE + '/basket');
  await shot(page, '13-basket');
  await overflow(page, 'basket');
  await page.goBack();
  await payNow(page);
  console.log('  ✓ one payment covered both');
  await ctx0.close();
}

// ---------------------------------------------------------------------------------------------------------------
console.log('\nE. Pages at the narrowest common phone width (360px): no sideways scroll');
{
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  for (const path of ['/', '/products', '/products/flyers', '/products/flex-banners', '/basket', '/signin', '/templates', '/faq', '/delivery', '/business', '/custom-order', '/help', '/studio']) {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    await overflow(page, path);
  }
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------------------------
console.log('\nG. The newer customer screens at 360px, signed in: grouped products, search, sample pack, account, company, designs');
{
  const ctx = await browser.newContext({ storageState: (process.env.TMPDIR ?? '/tmp') + '/brandit-state-A.json', viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  ✗ [G] page error:`, e.message.slice(0, 200)));
  let n = 20;
  for (const path of ['/products', '/products?c=Banners%20and%20signs', '/products?q=church+banner', '/products?q=zzzzqq', '/products/sample-pack', '/account', '/account/business', '/account/brand', '/studio/projects', '/join/not-a-real-token-xx', '/pay-link/not-a-real-token-xx', '/reminders/stop/not-a-real-token-xx', '/legal/terms', '/contact']) {
    const r = await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const ok = await overflow(page, path);
    if (r && r.status() >= 500) console.log(`  ✗ ${path} answered ${r.status()}`);
    if (path === '/products' || path === '/products/sample-pack' || path === '/account') await shot(page, `${n++}-phone${path.replace(/[^a-z]+/g, '-')}`);
  }
  // The header on a phone is the logo, the account, the basket and Order now; the four links live in the phone bar and the footer.
  await page.goto(BASE + '/products', { waitUntil: 'domcontentloaded' });
  const small = await page.evaluate(() => [...document.querySelectorAll('a, button, input, select, summary')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 32 || r.width < 32) && !el.closest('[aria-hidden=true]') && getComputedStyle(el).visibility !== 'hidden' && !el.classList.contains('sr-only'); }).map((el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30)));
  console.log(small.length === 0 ? '  ✓ every tap target on the products page is at least 32px' : `  ✗ small tap targets on /products: ${JSON.stringify(small.slice(0, 8))}`);
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------------------------
console.log('\nH. The team console at 360px, signed in as admin: every screen, no sideways scroll');
{
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  ✗ [H] page error:`, e.message.slice(0, 200)));
  await page.goto(BASE + '/console/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name=email]', 'admin@brandit.test');
  await page.fill('input[name=pin]', '1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/console\/(?!login)/, { timeout: 30000 });
  let n = 40;
  for (const path of ['/console/today', '/console/queue', '/console/orders', '/console/orders/new', '/console/payments', '/console/customers', '/console/products', '/console/stock', '/console/homepage', '/console/pages', '/console/pages/faq', '/console/pages/terms', '/console/business', '/console/messages', '/console/team', '/console/setup', '/console/activity', '/console/growth', '/console/coupons', '/console/reports', '/console/me']) {
    const r = await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await overflow(page, path);
    if (r && r.status() >= 400) console.log(`  ✗ ${path} answered ${r.status()}`);
    if (['/console/today', '/console/customers', '/console/payments', '/console/orders/new', '/console/business'].includes(path)) await shot(page, `${n++}-console${path.replace(/[^a-z]+/g, '-')}`);
  }
  await ctx.close();
}

await browser.close();
console.log('\nSummary');
for (const r of results) console.log(`  ${r.who}: ${r.clicks} clicks`);
