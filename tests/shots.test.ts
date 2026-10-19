import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { compareImages, DEFAULT_PAGES, failedShots, formatShots, reportHtml, shotName, type ShotRow } from '../lib/shots';

/** A plain coloured picture of any size, optionally with a coloured block drawn on it. */
const pic = async (w: number, h: number, bg: [number, number, number] = [255, 255, 255], block?: { x: number; y: number; w: number; h: number; c: [number, number, number] }) => {
  const img = sharp({ create: { width: w, height: h, channels: 3, background: { r: bg[0], g: bg[1], b: bg[2] } } });
  if (!block) return img.png().toBuffer();
  const patch = await sharp({ create: { width: block.w, height: block.h, channels: 3, background: { r: block.c[0], g: block.c[1], b: block.c[2] } } }).png().toBuffer();
  return img.composite([{ input: patch, left: block.x, top: block.y }]).png().toBuffer();
};

describe('naming the pictures', () => {
  it('makes a safe file name from the page address', () => {
    expect(shotName('/')).toBe('home');
    expect(shotName('/products')).toBe('products');
    expect(shotName('/products/business-cards')).toBe('products-business-cards');
    expect(shotName('/console/login?next=/console')).toBe('console-login');
    expect(shotName('/a b/../c')).toBe('a-b-c');
  });
  it('watches the pages customers use', () => {
    for (const p of ['/', '/products', '/track', '/signin']) expect(DEFAULT_PAGES).toContain(p);
  });
});

describe('comparing two pictures', () => {
  it('calls identical pictures the same', async () => {
    const a = await pic(390, 800);
    const d = await compareImages(a, a);
    expect(d).toMatchObject({ same: true, ratio: 0, changed: 0, sizeChanged: false });
  });

  it('ignores a faint difference in colour (the fuzz around text)', async () => {
    const d = await compareImages(await pic(100, 100, [255, 255, 255]), await pic(100, 100, [245, 245, 245]));
    expect(d.same).toBe(true);
    expect(d.changed).toBe(0);
  });

  it('forgives a few stray pixels but not a moved button', async () => {
    const base = await pic(390, 1000);
    const tiny = await compareImages(base, await pic(390, 1000, [255, 255, 255], { x: 10, y: 10, w: 20, h: 20, c: [0, 0, 0] }));
    expect(tiny.same).toBe(true);                       // 400 of 390,000 pixels: 0.1%
    expect(tiny.changed).toBe(400);
    const moved = await compareImages(base, await pic(390, 1000, [255, 255, 255], { x: 20, y: 400, w: 350, h: 60, c: [255, 196, 0] }));
    expect(moved.same).toBe(false);                     // a whole button: 5.4%
    expect(moved.ratio).toBeCloseTo(21000 / 390000, 3);
  });

  it('treats a page that grew taller as changed, and says so', async () => {
    const d = await compareImages(await pic(390, 800), await pic(390, 1000));
    expect(d.sizeChanged).toBe(true);
    expect(d.baseline).toEqual({ w: 390, h: 800 });
    expect(d.current).toEqual({ w: 390, h: 1000 });
    expect(d.ratio).toBeCloseTo(0.2, 2);
    expect(d.same).toBe(false);
  });

  it('draws what changed in red on a faded copy of the new picture', async () => {
    const d = await compareImages(await pic(100, 100), await pic(100, 100, [255, 255, 255], { x: 40, y: 40, w: 20, h: 20, c: [0, 0, 255] }));
    const { data, info } = await sharp(d.diffPng).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(100);
    const at = (x: number, y: number) => [data[(y * info.width + x) * info.channels], data[(y * info.width + x) * info.channels + 1], data[(y * info.width + x) * info.channels + 2]];
    expect(at(50, 50)).toEqual([230, 30, 30]);          // changed: red
    expect(at(5, 5)).toEqual([255, 255, 255]);          // unchanged white stays white
  });

  it('lets the allowed share be set', async () => {
    const a = await pic(100, 100);
    const b = await pic(100, 100, [255, 255, 255], { x: 0, y: 0, w: 10, h: 10, c: [0, 0, 0] });  // 1%
    expect((await compareImages(a, b)).same).toBe(false);
    expect((await compareImages(a, b, { threshold: 0.02 })).same).toBe(true);
  });
});

describe('the report', () => {
  const rows: ShotRow[] = [
    { path: '/', name: 'home', status: 'same', detail: 'Identical.' },
    { path: '/products', name: 'products', status: 'changed', detail: '12.0% of the screen changed.' },
    { path: '/track', name: 'track', status: 'sideways', sideways: true, detail: 'Scrolls sideways on a phone (520 px wide on a 390 px screen).' },
    { path: '/signin', name: 'signin', status: 'new', detail: 'No earlier picture.' },
    { path: '/oops<script>', name: 'oops', status: 'error', detail: 'Could not take the picture: the page answered 500' },
  ];
  it('counts what needs a look', () => {
    expect(failedShots(rows)).toBe(3);
    expect(failedShots(rows.filter((r) => r.status === 'same' || r.status === 'new'))).toBe(0);
  });
  it('lists every page and ends with what to do', () => {
    const t = formatShots(rows);
    expect(t).toMatch(/CHANGED\s+\/products/);
    expect(t).toMatch(/SIDEWAYS\s+\/track/);
    expect(t).toMatch(/3 pages need a look/);
    expect(formatShots([rows[1]])).toMatch(/1 page needs a look/);
    expect(formatShots([rows[0]])).toMatch(/Nothing changed on a phone/);
    expect(formatShots([rows[3]])).toMatch(/starting point/);
  });
  it('shows problems first, with before, now and what changed, and escapes page names', () => {
    const html = reportHtml('https://thebrandit.ng', rows, new Date('2026-10-15T10:00:00Z'));
    const at = (h: string) => html.indexOf(`<h2>${h}`);
    expect(at('/oops&lt;script&gt;')).toBeGreaterThan(-1);
    expect(html).not.toContain('<script>');
    // errors, then sideways scrolling, then changes, then new pages, then the ones that are fine
    expect(at('/oops')).toBeLessThan(at('/track'));
    expect(at('/track')).toBeLessThan(at('/products'));
    expect(at('/products')).toBeLessThan(at('/signin'));
    expect(at('/signin')).toBeLessThan(at('/ <span'));
    expect(html).toContain('src="baseline/products.png"');
    expect(html).toContain('src="current/products.png"');
    expect(html).toContain('src="diff/products.png"');
    expect(html).not.toContain('baseline/signin.png');   // a new page has nothing to compare with
    expect(html).not.toContain('diff/home.png');         // an unchanged page has no diff picture
    expect(html).toContain('2026-10-15 10:00 UTC');
  });
});
