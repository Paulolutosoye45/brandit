/*
 * Phone-width screenshot comparison, the part that needs no browser: naming the shots, comparing two pictures pixel by pixel,
 * drawing what changed, and writing the page you look at. scripts/shots.ts does the browsing.
 *
 * Why: most Brandit customers arrive on a phone. A change to one page can quietly break another (a button pushed off the
 * screen, a table that scrolls sideways). This shows every important page before and after a change, side by side.
 */
import sharp from 'sharp';

export const PHONE = { width: 390, height: 844 };
/** The pages worth watching. Product pages are added from the sitemap. */
export const DEFAULT_PAGES = ['/', '/products', '/track', '/signin', '/custom-order', '/help', '/faq', '/delivery', '/business', '/contact', '/about', '/console/login'];

/** "/products/business-cards" becomes "products-business-cards"; "/" becomes "home". */
export const shotName = (path: string): string => {
  const n = path.split(/[?#]/)[0].replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return n || 'home';
};

export type Diff = {
  same: boolean;
  /** Share of the picture that changed, 0 to 1. */
  ratio: number;
  changed: number;
  total: number;
  baseline: { w: number; h: number };
  current: { w: number; h: number };
  sizeChanged: boolean;
  /** The current picture faded, with every changed pixel in red. */
  diffPng: Buffer;
};

type Raw = { data: Buffer; w: number; h: number };
const decode = async (png: Buffer): Promise<Raw> => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
};

/**
 * Compare two pictures. A pixel counts as changed when any colour differs by more than `tolerance` (out of 255), which ignores
 * the faint fuzz around text. Anything outside the smaller picture counts as changed, so a page that grew taller is not "the same".
 */
export async function compareImages(baselinePng: Buffer, currentPng: Buffer, opts: { tolerance?: number; threshold?: number } = {}): Promise<Diff> {
  const tol = opts.tolerance ?? 24;
  const threshold = opts.threshold ?? 0.005;
  const [a, b] = await Promise.all([decode(baselinePng), decode(currentPng)]);
  const W = Math.max(a.w, b.w), H = Math.max(a.h, b.h);
  const out = Buffer.alloc(W * H * 4, 255);
  let changed = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const inA = x < a.w && y < a.h, inB = x < b.w && y < b.h;
      let differs = !(inA && inB);
      if (inA && inB) {
        const ia = (y * a.w + x) * 4, ib = (y * b.w + x) * 4;
        differs = Math.abs(a.data[ia] - b.data[ib]) > tol || Math.abs(a.data[ia + 1] - b.data[ib + 1]) > tol || Math.abs(a.data[ia + 2] - b.data[ib + 2]) > tol;
      }
      if (differs) { changed++; out[o] = 230; out[o + 1] = 30; out[o + 2] = 30; out[o + 3] = 255; }
      else if (inB) {
        const ib = (y * b.w + x) * 4;
        // Fade what is unchanged towards white so the red stands out.
        out[o] = 255 - (255 - b.data[ib]) * 0.35; out[o + 1] = 255 - (255 - b.data[ib + 1]) * 0.35; out[o + 2] = 255 - (255 - b.data[ib + 2]) * 0.35;
      }
    }
  }
  const total = W * H;
  const ratio = total ? changed / total : 0;
  const diffPng = await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
  return { same: ratio <= threshold, ratio, changed, total, baseline: { w: a.w, h: a.h }, current: { w: b.w, h: b.h }, sizeChanged: a.w !== b.w || a.h !== b.h, diffPng };
}

export type ShotRow = {
  path: string;
  name: string;
  status: 'same' | 'changed' | 'new' | 'sideways' | 'error';
  detail: string;
  sideways?: boolean;
};

export const failedShots = (rows: ShotRow[]) => rows.filter((r) => r.status === 'changed' || r.status === 'sideways' || r.status === 'error').length;

export function formatShots(rows: ShotRow[]): string {
  const mark: Record<ShotRow['status'], string> = { same: 'SAME   ', changed: 'CHANGED', new: 'NEW    ', sideways: 'SIDEWAYS', error: 'ERROR  ' };
  const w = Math.max(...rows.map((r) => r.path.length));
  const lines = rows.map((r) => `  ${mark[r.status].padEnd(8)} ${r.path.padEnd(w)}  ${r.detail}`);
  const bad = failedShots(rows), isNew = rows.filter((r) => r.status === 'new').length;
  const tail = bad
    ? `${bad} page${bad > 1 ? 's need' : ' needs'} a look. Open report.html: left is before, middle is now, right shows what changed in red.`
    : isNew ? `${isNew} page${isNew > 1 ? 's' : ''} had no earlier picture, so they were saved as the starting point.` : 'Nothing changed on a phone.';
  return `${lines.join('\n')}\n\n${tail}`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** One page to open in a browser: for each screen, before, now, and what changed. Pictures are referred to by relative path. */
export function reportHtml(site: string, rows: ShotRow[], when = new Date()): string {
  const card = (r: ShotRow) => `<section class="card ${r.status}">
  <h2>${esc(r.path)} <span class="tag">${r.status === 'same' ? 'same' : r.status === 'new' ? 'new' : r.status === 'sideways' ? 'scrolls sideways' : r.status === 'changed' ? 'changed' : 'error'}</span></h2>
  <p>${esc(r.detail)}</p>
  ${r.status === 'error' ? '' : `<div class="row">
    ${r.status === 'new' ? '' : `<figure><figcaption>Before</figcaption><img loading="lazy" src="baseline/${esc(r.name)}.png" alt="Before"></figure>`}
    <figure><figcaption>Now</figcaption><img loading="lazy" src="current/${esc(r.name)}.png" alt="Now"></figure>
    ${r.status === 'changed' ? `<figure><figcaption>What changed</figcaption><img loading="lazy" src="diff/${esc(r.name)}.png" alt="What changed"></figure>` : ''}
  </div>`}
</section>`;
  const order: Record<ShotRow['status'], number> = { error: 0, sideways: 1, changed: 2, new: 3, same: 4 };
  const sorted = [...rows].sort((a, b) => order[a.status] - order[b.status]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Phone screenshots: ${esc(site)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;margin:0;background:#F3F5F7;color:#0B1F33}main{max-width:1280px;margin:0 auto;padding:24px 16px}h1{margin:0 0 4px}.card{background:#fff;border:1px solid #D9DFE5;border-radius:12px;padding:16px;margin:16px 0}.card.changed,.card.sideways,.card.error{border-color:#C0392B}h2{font-size:18px;margin:0 0 4px}.tag{font-size:12px;font-weight:700;border-radius:6px;padding:2px 8px;background:#E3F4EC;color:#146B3A;vertical-align:middle}.changed .tag,.sideways .tag,.error .tag{background:#FDE8E6;color:#C0392B}.new .tag{background:#FFF1CC;color:#7A5A00}.row{display:flex;gap:16px;overflow-x:auto;align-items:flex-start}figure{margin:0;flex:0 0 auto}figcaption{font-size:13px;font-weight:700;margin-bottom:6px}img{width:260px;height:auto;border:1px solid #D9DFE5;display:block}p{margin:0 0 10px;color:#3D5166}</style></head>
<body><main><h1>Phone screenshots</h1><p>${esc(site)} at 390 pixels wide, ${esc(when.toISOString().slice(0, 16).replace('T', ' '))} UTC. Pages that need a look come first.</p>
${sorted.map(card).join('\n')}
</main></body></html>`;
}
