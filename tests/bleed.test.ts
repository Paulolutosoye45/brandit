import { beforeAll, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

process.env.PGLITE_DIR = 'memory';
process.env.DEMO_MODE = 'true';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-bleed-${process.pid}`);
delete process.env.PAYSTACK_SECRET_KEY;

import { checkArtwork, BLEED_IN } from '../lib/accuracy';
import { addBleed } from '../lib/imageTools';

const thresholds = { print: { pass: 250, warn: 150 }, photo: { pass: 200, warn: 120 }, large: { pass: 60, warn: 30 } } as any;
const base = { cls: 'print' as const, thresholds, maxBytes: 20_000_000 };

let db: typeof import('../lib/db');
let O: typeof import('../lib/orders');
let A: typeof import('../lib/artwork');

beforeAll(async () => {
  db = await import('../lib/db');
  await db.ready();
  O = await import('../lib/orders');
  A = await import('../lib/artwork');
}, 60_000);

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();
const withStripe = async (w: number, h: number) => {
  // A left-to-right gradient so mirrored edges can be told apart from the middle.
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 3; raw[i] = Math.round((x / (w - 1)) * 255); raw[i + 1] = 40; raw[i + 2] = 40; }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
};

describe('the check offers an extra edge only when it makes sense', () => {
  const facts = { mime: 'image/png', bytes: 1000, widthPx: 1050, heightPx: 600 }; // 3.5 x 2 in at 300 dpi
  it('offers it for a design exactly the finished size', () => {
    const r = checkArtwork({ ...base, facts, printWIn: 3.5, printHIn: 2, bleedOffer: true });
    expect(r.status).toBe('pass');
    const l = r.lines.find((x) => x.id === 'bleed');
    expect(l?.action).toBe('add_bleed');
  });
  it('says nothing when the product does not take one, or the file is a PDF, or the shape is different', () => {
    expect(checkArtwork({ ...base, facts, printWIn: 3.5, printHIn: 2 }).lines.some((x) => x.id === 'bleed')).toBe(false);
    expect(checkArtwork({ ...base, facts: { mime: 'application/pdf', bytes: 1000, pageWidthIn: 3.5, pageHeightIn: 2 }, printWIn: 3.5, printHIn: 2, bleedOffer: true }).lines.some((x) => x.id === 'bleed')).toBe(false);
    expect(checkArtwork({ ...base, facts: { ...facts, heightPx: 900 }, printWIn: 3.5, printHIn: 2, bleedOffer: true }).lines.some((x) => x.action === 'add_bleed')).toBe(false);
  });
  it('does not offer it for a file too soft to print, and measures a file that has it against the bigger size', () => {
    const soft = checkArtwork({ ...base, facts: { ...facts, widthPx: 350, heightPx: 200 }, printWIn: 3.5, printHIn: 2, bleedOffer: true });
    expect(soft.lines.some((x) => x.action === 'add_bleed')).toBe(false);
    const w = Math.round((3.5 + 2 * BLEED_IN) * 300); const h = Math.round((2 + 2 * BLEED_IN) * 300);
    const done = checkArtwork({ ...base, facts: { ...facts, widthPx: w, heightPx: h }, printWIn: 3.5, printHIn: 2, bleedIn: BLEED_IN });
    expect(done.status).toBe('pass');
    expect(done.lines.find((x) => x.id === 'shape')?.status).toBe('pass');
    expect(done.lines.find((x) => x.id === 'bleed')?.action).toBeUndefined();
    // The same bigger file with no note about the extra edge looks like the wrong shape.
    expect(checkArtwork({ ...base, facts: { ...facts, widthPx: w, heightPx: h }, printWIn: 3.5, printHIn: 2 }).lines.find((x) => x.id === 'shape')?.status).toBe('warn');
  });
});

describe('adding the extra edge', () => {
  it('grows the picture by 3 mm each side, continues the edges, and leaves the design where it was', async () => {
    const src = await withStripe(1050, 600);
    const r = await addBleed(src, { trimWIn: 3.5, trimHIn: 2, bleedIn: BLEED_IN });
    expect(r.bleedPx).toBe(Math.round(300 * BLEED_IN)); // 38
    expect(r.widthPx).toBe(1050 + 2 * r.bleedPx);
    expect(r.heightPx).toBe(600 + 2 * r.bleedPx);
    expect(r.mime).toBe('image/png');
    // The middle is untouched: the pixel at the old top-left corner is the old top-left pixel.
    const out = await sharp(r.buf).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => out.data[(y * out.info.width + x) * out.info.channels];
    const old = await sharp(src).raw().toBuffer({ resolveWithObject: true });
    const oldPx = (x: number, y: number) => old.data[(y * old.info.width + x) * old.info.channels];
    expect(px(r.bleedPx, r.bleedPx)).toBe(oldPx(0, 0));
    expect(px(r.bleedPx + 500, r.bleedPx + 300)).toBe(oldPx(500, 300));
    // The new border continues the picture: just outside the left edge looks like just inside it (mirrored).
    expect(px(r.bleedPx - 1, r.bleedPx + 300)).toBe(oldPx(0, 300));
    expect(px(r.bleedPx - 5, r.bleedPx + 300)).toBe(oldPx(4, 300));
  });

  it('handles a portrait design and a JPG, and refuses what it cannot', async () => {
    const jpg = await sharp({ create: { width: 600, height: 1050, channels: 3, background: { r: 10, g: 100, b: 200 } } }).jpeg().toBuffer();
    const r = await addBleed(jpg, { trimWIn: 3.5, trimHIn: 2, bleedIn: BLEED_IN }); // the file is portrait; the product is landscape
    expect(r.mime).toBe('image/jpeg');
    expect(r.widthPx).toBe(600 + 2 * r.bleedPx);
    expect(r.bleedPx).toBe(Math.round(300 * BLEED_IN));
    await expect(addBleed(Buffer.from('not an image at all'), { trimWIn: 3.5, trimHIn: 2, bleedIn: BLEED_IN })).rejects.toThrow(/JPG and PNG/);
    const webp = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#fff' } }).webp().toBuffer();
    await expect(addBleed(webp, { trimWIn: 3.5, trimHIn: 2, bleedIn: BLEED_IN })).rejects.toThrow(/JPG and PNG/);
  });
});

describe('on an order line', () => {
  async function line(file: Buffer, slug = 'business-cards', quantity = 100) {
    const d: any = await O.createDraft({ slug, quantity, area: 'Yaba' });
    expect(d.id, JSON.stringify(d)).toBeTruthy();
    const item = (await O.getItem(d.id))!;
    const r = await A.saveArtwork(d.id, { name: 'card.png', type: 'image/png', buf: file }, item.id);
    expect(r.ok).toBe(true);
    return { orderId: d.id as string, itemId: item.id as string, first: r };
  }

  it('is offered after upload, and replaces the file with a copy that remembers the original', async () => {
    const { orderId, itemId, first } = await line(await png(1050, 600));
    expect(first.ok && first.check.lines.find((l) => l.id === 'bleed')?.action).toBe('add_bleed');
    const before = (await O.getItem(orderId, itemId))!.artwork_file_id;
    await db.query('update order_items set preview_approved_at = now() where id = $1', [itemId]);
    const r = await A.addBleedToLine(orderId, itemId);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.beforeFileId).toBe(before);
    expect(r.check.status).toBe('pass');
    expect(r.check.lines.find((l) => l.id === 'bleed')?.action).toBeUndefined();
    const item = (await O.getItem(orderId, itemId))!;
    expect(item.artwork_file_id).toBe(r.fileId);
    expect(item.preview_approved_at).toBeNull(); // the customer approves the new file
    const f = (await db.one<any>('select * from files where id = $1', [r.fileId]))!;
    expect(f.original_file_id).toBe(before);
    expect(f.fix_note).toBe('bleed:0.125');
    expect((await db.one<any>('select storage_key from files where id = $1', [before]))!.storage_key).not.toBe('deleted.bin');
    // Asking twice is refused.
    expect((await A.addBleedToLine(orderId, itemId)).ok).toBe(false);
    // The size changes later: the file is checked again and still counts as having its extra edge.
    const re = await A.recheckArtwork(orderId, itemId);
    expect(re?.lines.find((l) => l.id === 'shape')?.status).toBe('pass');
  });

  it('can be undone, back to the customer\'s own file', async () => {
    const { orderId, itemId } = await line(await png(1050, 600));
    const original = (await O.getItem(orderId, itemId))!.artwork_file_id;
    const added = await A.addBleedToLine(orderId, itemId);
    expect(added.ok).toBe(true);
    const undone = await A.undoBleedOnLine(orderId, itemId);
    expect(undone.ok, JSON.stringify(undone)).toBe(true);
    expect((await O.getItem(orderId, itemId))!.artwork_file_id).toBe(original);
    expect(undone.ok && undone.check.lines.find((l) => l.id === 'bleed')?.action).toBe('add_bleed'); // offered again
    expect((await A.undoBleedOnLine(orderId, itemId)).ok).toBe(false); // nothing left to undo
  });

  it('is not offered for products that do not take one, or for a PDF-less line, or after production starts', async () => {
    const tee = await O.createDraft({ slug: 'tees-and-totes', quantity: 1, area: 'Yaba' } as any).catch(() => null);
    if (tee && 'id' in tee) {
      const item = (await O.getItem(tee.id))!;
      const r = await A.saveArtwork(tee.id, { name: 't.png', type: 'image/png', buf: await png(1050, 600) }, item.id);
      expect(r.ok && r.check.lines.some((l) => l.action === 'add_bleed')).toBe(false);
    }
    const none: any = await O.createDraft({ slug: 'business-cards', quantity: 100, area: 'Yaba' });
    const it = (await O.getItem(none.id))!;
    expect((await A.addBleedToLine(none.id, it.id)).ok).toBe(false); // no file yet
    const { orderId, itemId } = await line(await png(1050, 600));
    await db.query("update orders set status = 'in_production' where id = $1", [orderId]);
    const late = await A.addBleedToLine(orderId, itemId);
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.status).toBe(409);
  });
});
