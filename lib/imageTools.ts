/*
 * One place that turns an uploaded photo into two small, safe WebP copies.
 * Re-encoding drops everything hidden in a phone photo (the GPS position, the camera, the time),
 * which matters when a picture will be shown to other people.
 */
export class ImageError extends Error {}

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
export function sniffImage(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export type Processed = { full: Buffer; thumb: Buffer; mime: 'image/webp'; ext: 'webp'; width: number; height: number };

export async function processImage(
  buf: Buffer,
  name: string,
  o: { fullMax?: number; thumbMax?: number; minSide?: number; maxBytes?: number } = {},
): Promise<Processed> {
  const { fullMax = 1600, thumbMax = 480, minSide = 0, maxBytes = 8_000_000 } = o;
  if (buf.length > maxBytes) throw new ImageError(`"${name}" is larger than ${Math.round(maxBytes / 1_000_000)} MB. Pick a smaller photo.`);
  if (!sniffImage(buf)) throw new ImageError(`"${name}" is not a JPG, PNG or WebP photo.`);
  const sharp = await sharpOrNull();
  if (!sharp) throw new ImageError('Photos cannot be processed on this server right now. Please try again later.');
  try {
    const meta = await sharp(buf, { limitInputPixels: 80_000_000 }).metadata();
    if (!meta.width || !meta.height) throw new Error('no size');
    if (minSide && (meta.width < minSide || meta.height < minSide)) throw new ImageError(`"${name}" is too small (${meta.width} × ${meta.height}). Use a photo at least ${minSide} px on each side.`);
    const base = sharp(buf, { failOn: 'error', limitInputPixels: 80_000_000 }).rotate();
    const full = await base.clone().resize({ width: fullMax, height: fullMax, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    const thumb = await base.clone().resize({ width: thumbMax, height: thumbMax, fit: 'inside', withoutEnlargement: true }).webp({ quality: 76 }).toBuffer();
    const out = await sharp(full).metadata();
    return { full, thumb, mime: 'image/webp', ext: 'webp', width: out.width ?? meta.width, height: out.height ?? meta.height };
  } catch (e) {
    if (e instanceof ImageError) throw e;
    throw new ImageError(`We could not read "${name}". Try saving it again as a JPG and upload that.`);
  }
}

export type Bled = { buf: Buffer; mime: 'image/jpeg' | 'image/png'; widthPx: number; heightPx: number; bleedPx: number };

/**
 * Give a design an extra edge on every side by mirroring its outermost pixels outward.
 * The design itself is not touched or resized: the new picture is the old one with a border that continues it.
 * `trimWIn` and `trimHIn` are the finished size; the dots per inch come from how big the picture is against that.
 */
export async function addBleed(buf: Buffer, o: { trimWIn: number; trimHIn: number; bleedIn: number }): Promise<Bled> {
  const kind = sniffImage(buf);
  if (kind !== 'image/jpeg' && kind !== 'image/png') throw new ImageError('Only JPG and PNG files can be given an extra edge here.');
  const sharp = await sharpOrNull();
  if (!sharp) throw new ImageError('Files cannot be processed on this server right now. Please try again later.');
  try {
    const base = sharp(buf, { failOn: 'error', limitInputPixels: 80_000_000 }).rotate();
    const { data, info } = await base.toBuffer({ resolveWithObject: true });
    const portrait = info.height > info.width;
    const [tw, th] = portrait === o.trimHIn > o.trimWIn ? [o.trimWIn, o.trimHIn] : [o.trimHIn, o.trimWIn];
    const dpi = Math.min(info.width / tw, info.height / th);
    const bleedPx = Math.max(4, Math.round(dpi * o.bleedIn));
    const out = sharp(data).extend({ top: bleedPx, bottom: bleedPx, left: bleedPx, right: bleedPx, extendWith: 'mirror' });
    const done = kind === 'image/png' ? await out.png({ compressionLevel: 6 }).toBuffer({ resolveWithObject: true }) : await out.jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer({ resolveWithObject: true });
    return { buf: done.data, mime: kind, widthPx: done.info.width, heightPx: done.info.height, bleedPx };
  } catch (e) {
    if (e instanceof ImageError) throw e;
    throw new ImageError('We could not add an extra edge to this file. Upload a copy that has one, or let us fix it for you.');
  }
}
