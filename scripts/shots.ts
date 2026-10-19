/**
 * Phone-width screenshots of the important pages, compared with the last good set.
 *
 *   npm run shots -- https://thebrandit.ng                    compare with the saved set (the first run saves it)
 *   npm run shots -- https://thebrandit.ng --update           accept what the site looks like now as the new good set
 *   npm run shots -- https://staging.example.com --password <team password>
 *   npm run shots -- <url> --dir my-shots --pages /,/products,/track
 *
 * Use it on the test site before and after a change. It writes shots/<site>/report.html: for each page, before, now and what
 * changed in red. It also fails any page that scrolls sideways on a phone, which needs no earlier picture to spot.
 *
 * It needs a browser once:   npm install --no-save playwright   then   npx playwright install chromium
 */
import fs from 'node:fs';
import path from 'node:path';
import { compareImages, DEFAULT_PAGES, failedShots, formatShots, PHONE, reportHtml, shotName, type ShotRow } from '../lib/shots';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const val = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const url = args.find((a) => /^https?:\/\//.test(a));
if (!url) {
  console.error('Usage: npm run shots -- https://thebrandit.ng [--update] [--password <team password>] [--dir <folder>] [--pages /,/products] [--threshold 0.005]');
  process.exit(2);
}
const root = url.replace(/\/+$/, '');
const site = new URL(root).host.replace(/[^a-z0-9.-]/gi, '_');
const dir = path.resolve(val('dir') ?? path.join('shots', site));
const threshold = Number(val('threshold') ?? 0.005);

async function loadPlaywright(): Promise<any> {
  for (const m of [process.env.PLAYWRIGHT_MODULE, 'playwright', 'playwright-core'].filter(Boolean) as string[]) {
    try { return await import(m); } catch { /* try the next */ }
  }
  console.error('\nA browser is needed once. Run:\n\n  npm install --no-save playwright\n  npx playwright install chromium\n\nthen run this again.\n');
  process.exit(2);
}

/** Product pages from the sitemap, so new products are watched without editing a list. */
async function productPaths(): Promise<string[]> {
  try {
    const headers: Record<string, string> = val('password') ? { Authorization: `Basic ${Buffer.from(`team:${val('password')}`).toString('base64')}` } : {};
    const xml = await (await fetch(`${root}/sitemap.xml`, { headers, signal: AbortSignal.timeout(15_000) })).text();
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => /\/products\/[^/?#]+$/.exec(m[1])?.[0]).filter((x): x is string => !!x).slice(0, 8);
  } catch { return []; }
}

const NO_MOTION = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';

async function main() {
  const pw = await loadPlaywright();
  const chromium = (pw.chromium ?? pw.default?.chromium);
  const paths = val('pages') ? val('pages')!.split(',').map((p) => p.trim()).filter(Boolean) : [...DEFAULT_PAGES, ...(await productPaths())];
  for (const sub of ['baseline', 'current', 'diff']) fs.mkdirSync(path.join(dir, sub), { recursive: true });

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({
    viewport: PHONE, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'en-NG', timezoneId: 'Africa/Lagos', reducedMotion: 'reduce',
    ...(val('password') ? { httpCredentials: { username: 'team', password: val('password')! } } : {}),
  });
  const rows: ShotRow[] = [];
  console.log(`\nPhone screenshots of ${root} (${PHONE.width} px wide), ${paths.length} pages ...\n`);
  for (const p of paths) {
    const name = shotName(p);
    const page = await ctx.newPage();
    try {
      const res = await page.goto(root + p, { waitUntil: 'networkidle', timeout: 45_000 });
      if (!res || res.status() >= 500) throw new Error(`the page answered ${res?.status() ?? 'nothing'}`);
      await page.addStyleTag({ content: NO_MOTION });
      await page.evaluate(() => (document as any).fonts?.ready);
      // Scroll down and back so pictures that load as they appear are in the shot.
      await page.evaluate(async () => { const h = document.body.scrollHeight; for (let y = 0; y < h; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
      await page.waitForTimeout(250);
      const sideways = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth <= vw + 1) return null;
        const offenders: string[] = [];
        for (const el of Array.from(document.body.querySelectorAll('*'))) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > vw + 1) {
            let q = el.parentElement, inside = false;
            while (q && q !== document.body) { if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(q).overflowX)) { inside = true; break; } q = q.parentElement; }
            if (!inside) offenders.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''} "${(el.textContent ?? '').trim().slice(0, 30)}"`);
          }
          if (offenders.length >= 3) break;
        }
        return { width: document.documentElement.scrollWidth, vw, offenders };
      });
      const shot: Buffer = await page.screenshot({ fullPage: true });
      fs.writeFileSync(path.join(dir, 'current', `${name}.png`), shot);
      const basePath = path.join(dir, 'baseline', `${name}.png`);
      let row: ShotRow;
      if (flag('update') || !fs.existsSync(basePath)) {
        fs.writeFileSync(basePath, shot);
        row = { path: p, name, status: 'new', detail: flag('update') ? 'Saved as the new good picture.' : 'No earlier picture: saved as the starting point.' };
      } else {
        const d = await compareImages(fs.readFileSync(basePath), shot, { threshold });
        if (d.same) row = { path: p, name, status: 'same', detail: d.changed ? `${(d.ratio * 100).toFixed(2)}% differs, within the allowed ${(threshold * 100).toFixed(1)}%` : 'Identical.' };
        else {
          fs.writeFileSync(path.join(dir, 'diff', `${name}.png`), d.diffPng);
          row = { path: p, name, status: 'changed', detail: `${(d.ratio * 100).toFixed(1)}% of the screen changed${d.sizeChanged ? `; the page went from ${d.baseline.h} to ${d.current.h} pixels tall` : ''}.` };
        }
      }
      if (sideways) row = { ...row, status: 'sideways', sideways: true, detail: `Scrolls sideways on a phone (${sideways.width} px wide on a ${sideways.vw} px screen). Look at: ${sideways.offenders.join('; ') || 'unknown'}. ${row.status === 'changed' ? row.detail : ''}`.trim() };
      rows.push(row);
    } catch (e) {
      rows.push({ path: p, name, status: 'error', detail: `Could not take the picture: ${(e as Error).message}` });
    } finally { await page.close().catch(() => {}); }
  }
  await browser.close();
  fs.writeFileSync(path.join(dir, 'report.html'), reportHtml(root, rows));
  console.log(formatShots(rows));
  console.log(`\nReport: ${path.join(dir, 'report.html')}\n`);
  process.exit(failedShots(rows) ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
