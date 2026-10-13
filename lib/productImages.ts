import { query, one, tx } from './db';
import { putFile, deleteFile, getFile } from './storage';
import { MAX_IMAGES, ProductError } from './productAdmin';

/*
 * Photos for the catalogue. Staff upload a phone photo straight from the camera roll (often 4 to 8 MB).
 * We keep two small copies: a 1600 px one for the product page and a 640 px one for cards, both WebP,
 * so the catalogue stays fast on mobile data.
 */
export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGE_BYTES = 8_000_000;

export type ProductImage = { id: string; product_id: string; storage_key: string; thumb_key: string; mime: string; width_px: number | null; height_px: number | null; alt: string; sort: number };

type Sharp = typeof import('sharp').default;
async function sharpOrNull(): Promise<Sharp | null> {
  try {
    const m: any = await import('sharp');
    return (m.default ?? m) as Sharp;
  } catch {
    return null;
  }
}

/** Look at the first bytes, not the file name or the type the browser claimed. */
export function sniff(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export async function listImages(productId: string): Promise<ProductImage[]> {
  return query<ProductImage>('select id, product_id, storage_key, thumb_key, mime, width_px, height_px, alt, sort from product_images where product_id = $1 order by sort, created_at', [productId]);
}

export async function addProductImage(productId: string, f: { name: string; buf: Buffer }): Promise<ProductImage> {
  const p = await one<{ name: string }>('select name from products where id = $1 and not system', [productId]);
  if (!p) throw new ProductError('We could not find that product.');
  const have = (await one<{ n: number }>('select count(*)::int as n from product_images where product_id = $1', [productId]))!.n;
  if (have >= MAX_IMAGES) throw new ProductError(`A product can have up to ${MAX_IMAGES} photos. Remove one first.`);
  if (f.buf.length > MAX_IMAGE_BYTES) throw new ProductError(`"${f.name}" is larger than ${MAX_IMAGE_BYTES / 1_000_000} MB. Pick a smaller photo.`);
  const kind = sniff(f.buf);
  if (!kind) throw new ProductError(`"${f.name}" is not a JPG, PNG or WebP photo.`);

  let full: Buffer;
  let thumb: Buffer;
  let ext: string;
  let mime: string;
  let w: number | null = null;
  let h: number | null = null;
  const sharp = await sharpOrNull();
  if (sharp) {
    try {
      const base = sharp(f.buf, { failOn: 'error', limitInputPixels: 80_000_000 }).rotate();
      const meta = await sharp(f.buf, { limitInputPixels: 80_000_000 }).metadata();
      if (!meta.width || !meta.height) throw new Error('no size');
      if (meta.width < 200 || meta.height < 200) throw new ProductError(`"${f.name}" is too small (${meta.width} × ${meta.height}). Use a photo at least 200 px on each side.`);
      full = await base.clone().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
      thumb = await base.clone().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
      const out = await sharp(full).metadata();
      w = out.width ?? null;
      h = out.height ?? null;
      ext = 'webp';
      mime = 'image/webp';
    } catch (e) {
      if (e instanceof ProductError) throw e;
      throw new ProductError(`We could not read "${f.name}". Try saving it again as a JPG and upload that.`);
    }
  } else {
    // No image library on this host: keep the original, it is still a valid web image.
    full = thumb = f.buf;
    ext = kind === 'image/jpeg' ? 'jpg' : kind === 'image/png' ? 'png' : 'webp';
    mime = kind;
  }

  const fullKey = await putFile(full, ext);
  let thumbKey = fullKey;
  try {
    if (thumb !== full) thumbKey = await putFile(thumb, ext);
  } catch (e) {
    await deleteFile(fullKey);
    throw e;
  }
  const sort = (await one<{ n: number }>('select coalesce(max(sort), -1)::int + 1 as n from product_images where product_id = $1', [productId]))!.n;
  const alt = p.name.slice(0, 120);
  const row = await one<ProductImage>(
    `insert into product_images (product_id, storage_key, thumb_key, mime, width_px, height_px, alt, sort)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, product_id, storage_key, thumb_key, mime, width_px, height_px, alt, sort`,
    [productId, fullKey, thumbKey, mime, w, h, alt, sort],
  );
  return row!;
}

async function dropKeys(r: { storage_key: string; thumb_key: string }) {
  for (const k of new Set([r.storage_key, r.thumb_key])) {
    try { await deleteFile(k); } catch { /* an orphaned file is harmless; the row is already gone */ }
  }
}

export async function deleteProductImage(imageId: string): Promise<string | null> {
  const r = await one<{ storage_key: string; thumb_key: string; product_id: string }>('delete from product_images where id = $1 returning storage_key, thumb_key, product_id', [imageId]);
  if (!r) return null;
  await dropKeys(r);
  return r.product_id;
}

/** Delete every photo a product has (when the product itself is removed). */
export async function deleteAllImages(productId: string) {
  const rows = await query<{ storage_key: string; thumb_key: string }>('delete from product_images where product_id = $1 returning storage_key, thumb_key', [productId]);
  for (const r of rows) await dropKeys(r);
}

export async function makeCover(imageId: string) {
  const r = await one<{ product_id: string }>('select product_id from product_images where id = $1', [imageId]);
  if (!r) return;
  const rows = await query<{ id: string }>('select id from product_images where product_id = $1 order by sort, created_at', [r.product_id]);
  const order = [imageId, ...rows.map((x) => x.id).filter((id) => id !== imageId)];
  await tx(async (q) => {
    for (let i = 0; i < order.length; i++) await q.query('update product_images set sort = $2 where id = $1', [order[i], i]);
  });
}

export async function setAlt(imageId: string, alt: string) {
  await query('update product_images set alt = $2 where id = $1', [imageId, alt.replace(/\s+/g, ' ').trim().slice(0, 120)]);
}

export async function readImage(id: string, size: 'thumb' | 'full'): Promise<{ buf: Buffer; mime: string } | null> {
  const r = await one<{ storage_key: string; thumb_key: string; mime: string }>('select storage_key, thumb_key, mime from product_images where id = $1', [id]);
  if (!r) return null;
  try {
    return { buf: await getFile(size === 'full' ? r.storage_key : r.thumb_key), mime: r.mime };
  } catch {
    return null;
  }
}
