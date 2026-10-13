import { PDFDocument, rgb } from 'pdf-lib';
import type { Element, LayoutOut, PhotoShape, Rect } from './layout';
import { REF } from './layout';
import type { Palette } from '../../content/studio';
import { fit } from './typeset';

/*
 * Puts the picture, the customer's photo and logo, the shapes and the words together into one print file.
 *
 * The layout is worked out in reference units (see layout.ts). Here it is drawn at the size asked for: a small preview
 * for the screen, or the full print size. Words are always drawn from font outlines, never from a picture.
 */
type Sharp = typeof import('sharp').default;
let sharpMod: Sharp | null = null;
export async function sharpLib(): Promise<Sharp> {
  if (sharpMod) return sharpMod;
  const m: any = await import('sharp');
  sharpMod = (m.default ?? m) as Sharp;
  return sharpMod;
}

export type Format = 'png' | 'jpeg' | 'webp';
export type ComposeIn = {
  layout: LayoutOut;
  /** Output size in pixels. */
  outW: number;
  outH: number;
  palette: Palette;
  art: Buffer | null;
  photo?: Buffer | null;
  /** The photo with its background removed, when the customer chose a cut-out. */
  photoCut?: Buffer | null;
  logo?: Buffer | null;
  /** A repeating "BRANDIT PREVIEW" mark. Free sketches only. */
  watermark?: boolean;
  /** Round stickers are cut to a circle. Everything outside is transparent in the PNG. */
  round?: boolean;
  format: Format;
  quality?: number;
  /** Written into the file so printers and the check read the right size. */
  dpi?: number;
  /** Leave the words out (the PDF draws them as vectors on top). */
  skipText?: boolean;
};

const n2 = (v: number) => +v.toFixed(2);

/** Mean brightness (0 dark, 1 light) of the art under any rectangle, from a tiny copy of the art. */
export async function lumaMap(art: Buffer | null, refW: number, refH: number): Promise<(r: Rect) => number> {
  if (!art) return () => 0.35;
  const sharp = await sharpLib();
  const S = 48;
  const { data, info } = await sharp(art).resize(S, S, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const at = (i: number) => data[i] / 255;
  return (r) => {
    const x0 = Math.max(0, Math.floor((r.x / refW) * S)), x1 = Math.min(S - 1, Math.ceil(((r.x + r.w) / refW) * S));
    const y0 = Math.max(0, Math.floor((r.y / refH) * S)), y1 = Math.min(S - 1, Math.ceil(((r.y + r.h) / refH) * S));
    let sum = 0, cnt = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { sum += at(y * info.width + x); cnt++; }
    return cnt ? sum / cnt : 0.35;
  };
}

/** The main colours in a picture, as hex strings, most common first. Near-white and near-grey are skipped. */
export async function dominantColours(buf: Buffer, count = 4): Promise<string[]> {
  const sharp = await sharpLib();
  const { data } = await sharp(buf).resize(32, 32, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 2 < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx > 235 && mn > 215) continue; // paper white
    if (mx - mn < 18 && mx > 60) continue; // grey
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const e = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    bins.set(key, e);
  }
  const all = [...bins.values()].sort((a, b) => b.n - a.n).map((e) => [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)] as const);
  const out: (readonly [number, number, number])[] = [];
  for (const c of all) {
    if (out.every((o) => Math.abs(o[0] - c[0]) + Math.abs(o[1] - c[1]) + Math.abs(o[2] - c[2]) > 90)) out.push(c);
    if (out.length >= count) break;
  }
  return out.map(([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase());
}

/** Build a palette from a logo's own colours so a flyer looks like the business. */
export async function paletteFromLogo(buf: Buffer): Promise<Palette | null> {
  const cols = await dominantColours(buf, 3);
  if (!cols.length) return null;
  const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
  const sorted = [...cols].sort((a, b) => lum(a) - lum(b));
  const dark = sorted[0];
  const bg = lum(dark) < 0.5 ? dark : shade(dark, 0.55);
  const accent = cols.find((c) => c !== dark) ?? '#E8B931';
  return { id: 'logo', label: 'Matches your logo', bg, accent: lum(accent) < 0.25 ? '#E8B931' : accent, ink: '#0B1F33', soft: '#FFFFFF' };
}
const shade = (hex: string, f: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
};

// ---------- Pieces drawn as small SVG overlays ----------
type Px = { left: number; top: number; width: number; height: number };
function pxBox(r: Rect, kx: number, ky: number, W: number, H: number): Px {
  const left = Math.max(0, Math.min(W - 1, Math.round(r.x * kx)));
  const top = Math.max(0, Math.min(H - 1, Math.round(r.y * ky)));
  const width = Math.max(1, Math.min(W - left, Math.round((r.x + r.w) * kx) - left));
  const height = Math.max(1, Math.min(H - top, Math.round((r.y + r.h) * ky) - top));
  return { left, top, width, height };
}
const svgWrap = (b: Px, vb: Rect, inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="${n2(vb.x)} ${n2(vb.y)} ${n2(vb.w)} ${n2(vb.h)}" preserveAspectRatio="none">${inner}</svg>`;

const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${n2(x + rr)} ${n2(y)}H${n2(x + w - rr)}A${n2(rr)} ${n2(rr)} 0 0 1 ${n2(x + w)} ${n2(y + rr)}V${n2(y + h - rr)}A${n2(rr)} ${n2(rr)} 0 0 1 ${n2(x + w - rr)} ${n2(y + h)}H${n2(x + rr)}A${n2(rr)} ${n2(rr)} 0 0 1 ${n2(x)} ${n2(y + h - rr)}V${n2(y + rr)}A${n2(rr)} ${n2(rr)} 0 0 1 ${n2(x + rr)} ${n2(y)}Z`;
};

const textInner = (el: Extract<Element, { t: 'text' }>) =>
  `<g fill="${el.fill}">${el.glyphs.map((g) => `<path transform="translate(${n2(el.x + g.x)} ${n2(el.y + g.y)}) scale(${+g.s.toFixed(6)})" d="${g.d}"/>`).join('')}</g>`;

export const textSvgFragment = textInner;

function shapeMaskSvg(shape: PhotoShape, w: number, h: number): string | null {
  if (shape === 'rect') return null;
  const body = shape === 'circle' ? `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}"/>` : shape === 'oval' ? `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}"/>` : `<rect width="${w}" height="${h}" rx="${n2(Math.min(w, h) * 0.06)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><g fill="#fff">${body}</g></svg>`;
}

/** The "BRANDIT PREVIEW" mark, tiled at a slant, for free sketches. */
export function watermarkSvg(w: number, h: number): string {
  const size = Math.max(14, Math.min(w, h) * 0.07);
  const block = fit({ text: 'BRANDIT PREVIEW', fontId: 'inter', weight: 'bold', maxW: size * 12, maxH: size * 1.5, maxSize: size, minSize: size * 0.5, maxLines: 1 });
  const stepX = block.w + size * 2.2, stepY = size * 3.4;
  const reps: string[] = [];
  const diag = Math.hypot(w, h);
  for (let row = -2, r = 0; row * stepY < diag; row++, r++) {
    for (let x = -diag / 2 + (r % 2 ? stepX / 2 : 0); x < diag * 1.2; x += stepX) {
      reps.push(`<g transform="translate(${n2(x)} ${n2(row * stepY)})">${block.glyphs.map((g) => `<path transform="translate(${n2(g.x)} ${n2(g.y)}) scale(${+g.s.toFixed(6)})" d="${g.d}"/>`).join('')}</g>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g transform="rotate(-24 ${w / 2} ${h / 2}) translate(${n2(w / 2 - diag / 2)} ${n2(h / 2 - diag / 2)})" fill="#ffffff" fill-opacity="0.34" stroke="#000000" stroke-opacity="0.16" stroke-width="${n2(size * 0.03)}">${reps.join('')}</g></svg>`;
}

type Overlay = { input: Buffer; left: number; top: number };

async function imageOverlays(el: Extract<Element, { t: 'image' }>, i: ComposeIn, kx: number, ky: number): Promise<Overlay[]> {
  const sharp = await sharpLib();
  const b = pxBox(el, kx, ky, i.outW, i.outH);
  const out: Overlay[] = [];
  const ref = (r: Rect): Rect => ({ x: 0, y: 0, w: r.w, h: r.h });
  const accent = i.palette.accent;

  if (el.src === 'logo') {
    if (!i.logo) return out;
    const pad = Math.round(Math.min(b.width, b.height) * 0.08);
    const plateSvg = svgWrap(b, ref(el), `<path d="${roundRect(0, 0, el.w, el.h, Math.min(el.w, el.h) * 0.12)}" fill="#ffffff" fill-opacity="0.94"/>`);
    out.push({ input: Buffer.from(plateSvg), left: b.left, top: b.top });
    const lw = Math.max(1, b.width - 2 * pad), lh = Math.max(1, b.height - 2 * pad);
    const logo = await sharp(i.logo, { limitInputPixels: 80_000_000 }).rotate().resize(lw, lh, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
    out.push({ input: logo, left: b.left + pad, top: b.top + pad });
    return out;
  }

  const shape = el.shape;
  if (shape === 'cutout' && i.photoCut) {
    // The person stands on a soft round plate in the accent colour, with a shadow under the feet.
    const plate = svgWrap(b, ref(el), `<ellipse cx="${n2(el.w / 2)}" cy="${n2(el.h * 0.88)}" rx="${n2(el.w * 0.42)}" ry="${n2(el.h * 0.06)}" fill="#000" fill-opacity="0.28"/><circle cx="${n2(el.w / 2)}" cy="${n2(el.h * 0.5)}" r="${n2(Math.min(el.w, el.h) * 0.46)}" fill="${accent}" fill-opacity="0.35"/>`);
    out.push({ input: Buffer.from(plate), left: b.left, top: b.top });
    const cut = await sharp(i.photoCut, { limitInputPixels: 80_000_000 }).rotate().resize(b.width, b.height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    out.push({ input: cut, left: b.left, top: b.top });
    return out;
  }
  if (!i.photo) return out;
  const effective: PhotoShape = shape === 'cutout' ? 'rounded' : shape;
  let pic = sharp(i.photo, { limitInputPixels: 80_000_000 }).rotate().resize(b.width, b.height, { fit: 'cover', position: 'attention' });
  const mask = shapeMaskSvg(effective, b.width, b.height);
  let buf: Buffer;
  if (mask) {
    const clipped = await pic.png().toBuffer();
    buf = await sharp(clipped).composite([{ input: Buffer.from(mask), blend: 'dest-in' }]).png().toBuffer();
  } else buf = await pic.png().toBuffer();
  out.push({ input: buf, left: b.left, top: b.top });
  // A thin ring in the accent colour finishes the edge.
  const sw = Math.max(2, Math.min(el.w, el.h) * 0.012);
  const ringBody =
    effective === 'circle' || effective === 'oval'
      ? `<ellipse cx="${n2(el.w / 2)}" cy="${n2(el.h / 2)}" rx="${n2(el.w / 2 - sw / 2)}" ry="${n2(el.h / 2 - sw / 2)}" fill="none" stroke="${accent}" stroke-width="${n2(sw)}"/>`
      : `<rect x="${n2(sw / 2)}" y="${n2(sw / 2)}" width="${n2(el.w - sw)}" height="${n2(el.h - sw)}" rx="${effective === 'rounded' ? n2(Math.min(el.w, el.h) * 0.06) : 0}" fill="none" stroke="${accent}" stroke-width="${n2(sw)}"/>`;
  out.push({ input: Buffer.from(svgWrap(b, ref(el), ringBody)), left: b.left, top: b.top });
  return out;
}

async function overlaysFor(i: ComposeIn, kx: number, ky: number): Promise<Overlay[]> {
  const out: Overlay[] = [];
  for (const el of i.layout.elements) {
    if (el.t === 'rect') {
      const b = pxBox(el, kx, ky, i.outW, i.outH);
      out.push({ input: Buffer.from(svgWrap(b, { x: 0, y: 0, w: el.w, h: el.h }, `<path d="${roundRect(0, 0, el.w, el.h, el.r)}" fill="${el.fill}" fill-opacity="${el.opacity}"/>`)), left: b.left, top: b.top });
    } else if (el.t === 'text') {
      if (i.skipText) continue;
      const b = pxBox({ x: el.x - 2, y: el.y - 2, w: el.w + 4, h: el.h + el.h * 0.3 + 4 }, kx, ky, i.outW, i.outH);
      // Glyph positions are relative to the block; the fragment already adds the block origin, so the view box starts at it.
      out.push({ input: Buffer.from(svgWrap(b, { x: el.x - 2, y: el.y - 2, w: el.w + 4, h: el.h + el.h * 0.3 + 4 }, textInner(el))), left: b.left, top: b.top });
    } else if (el.t === 'path') {
      const b = pxBox(el.box, kx, ky, i.outW, i.outH);
      out.push({ input: Buffer.from(svgWrap(b, el.box, `<path d="${el.d}" fill="${el.fill}"${el.opacity != null ? ` fill-opacity="${el.opacity}"` : ''}/>`)), left: b.left, top: b.top });
    } else {
      out.push(...(await imageOverlays(el, i, kx, ky)));
    }
  }
  return out;
}

/** Draw the whole design as one image. */
export async function renderRaster(i: ComposeIn): Promise<Buffer> {
  const sharp = await sharpLib();
  const kx = i.outW / i.layout.w, ky = i.outH / i.layout.h;
  let pipe = i.art
    ? sharp(i.art, { limitInputPixels: 300_000_000 }).rotate().resize(i.outW, i.outH, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
    : sharp({ create: { width: i.outW, height: i.outH, channels: 3, background: i.palette.bg } });
  const ovs = await overlaysFor(i, kx, ky);
  if (i.watermark) ovs.push({ input: Buffer.from(watermarkSvg(i.outW, i.outH)), left: 0, top: 0 });
  if (ovs.length) pipe = pipe.composite(ovs.map((o) => ({ input: o.input, left: o.left, top: o.top })));
  if (i.round) {
    // Cut a circle and leave the corners clear, for round stickers.
    const buf = await pipe.png().toBuffer();
    const d = Math.min(i.outW, i.outH);
    const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${i.outW}" height="${i.outH}"><ellipse cx="${i.outW / 2}" cy="${i.outH / 2}" rx="${d / 2}" ry="${d / 2}" fill="#fff"/></svg>`;
    pipe = sharp(buf).ensureAlpha().composite([{ input: Buffer.from(mask), blend: 'dest-in' }]);
  }
  return encode(pipe, i);
}

function encode(pipe: ReturnType<Sharp>, i: Pick<ComposeIn, 'format' | 'quality' | 'dpi'>): Promise<Buffer> {
  const p = i.dpi ? pipe.withMetadata({ density: i.dpi }) : pipe;
  if (i.format === 'jpeg') return p.jpeg({ quality: i.quality ?? 92, chromaSubsampling: '4:4:4', mozjpeg: false }).toBuffer();
  if (i.format === 'webp') return p.webp({ quality: i.quality ?? 82 }).toBuffer();
  return p.png({ compressionLevel: 6 }).toBuffer();
}

/** A small, light preview for the screen. */
export async function renderPreview(i: Omit<ComposeIn, 'outW' | 'outH' | 'format'> & { longSide?: number; refW: number; refH: number }): Promise<{ buf: Buffer; w: number; h: number }> {
  const long = i.longSide ?? 1100;
  const k = long / Math.max(i.refW, i.refH);
  const outW = Math.max(1, Math.round(i.refW * k)), outH = Math.max(1, Math.round(i.refH * k));
  const buf = await renderRaster({ ...i, outW, outH, format: 'webp', quality: 82 });
  return { buf, w: outW, h: outH };
}

/** The print file as a PDF: the picture layer as one image and every letter as a vector shape on top. */
export async function renderPdf(i: Omit<ComposeIn, 'format' | 'skipText'> & { printWIn: number; printHIn: number }): Promise<Buffer> {
  const base = await renderRaster({ ...i, format: 'jpeg', quality: 90, skipText: true, round: false });
  const pdf = await PDFDocument.create();
  pdf.setTitle('Brandit Studio design');
  pdf.setProducer('Brandit Studio');
  const W = i.printWIn * 72, H = i.printHIn * 72;
  const page = pdf.addPage([W, H]);
  const img = await pdf.embedJpg(base);
  page.drawImage(img, { x: 0, y: 0, width: W, height: H });
  const pt = W / i.layout.w;
  for (const el of i.layout.elements) {
    if (el.t !== 'text') continue;
    const hex = el.fill.replace('#', '');
    const col = rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
    for (const g of el.glyphs) {
      page.drawSvgPath(g.d, { x: (el.x + g.x) * pt, y: H - (el.y + g.y) * pt, scale: g.s * pt, color: col, borderWidth: 0 });
    }
  }
  return Buffer.from(await pdf.save());
}

// ---------- SVG for the vector add-on ----------
const ALLOWED = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'use', 'title', 'desc']);

/** Accepts a vendor's SVG only if it has nothing but shapes: no scripts, no outside links, no styles that load things. */
export function sanitiseSvg(src: string): string | null {
  let s = String(src ?? '').trim();
  if (!s || s.length > 12_000_000) return null;
  s = s.replace(/<\?xml[^>]*\?>/gi, '').replace(/<!DOCTYPE[^>]*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  if (!/^<svg[\s>]/i.test(s)) return null;
  if (/<\s*(script|foreignObject|iframe|object|embed|style|image|animate|set|a)\b/i.test(s)) return null;
  if (/javascript:|@import|expression\(|url\(\s*['"]?\s*(https?:|\/\/|data:)/i.test(s)) return null;
  for (const m of s.matchAll(/<\s*\/?\s*([a-zA-Z][\w:-]*)/g)) if (!ALLOWED.has(m[1].toLowerCase())) return null;
  for (const m of s.matchAll(/\s(?:xlink:)?href\s*=\s*"([^"]*)"/gi)) if (!m[1].startsWith('#')) return null;
  s = s.replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '').replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '');
  return s;
}

/** The inside of a sanitised SVG and the box it was drawn in. */
function svgParts(svg: string): { inner: string; vb: [number, number, number, number] } | null {
  const open = svg.match(/^<svg\b[^>]*>/i);
  if (!open) return null;
  const tag = open[0];
  const vbm = tag.match(/viewBox\s*=\s*"([^"]+)"/i);
  let vb: [number, number, number, number] | null = null;
  if (vbm) { const p = vbm[1].trim().split(/[\s,]+/).map(Number); if (p.length === 4 && p.every(Number.isFinite) && p[2] > 0 && p[3] > 0) vb = [p[0], p[1], p[2], p[3]]; }
  if (!vb) {
    const w = parseFloat(tag.match(/\swidth\s*=\s*"([\d.]+)/i)?.[1] ?? ''), h = parseFloat(tag.match(/\sheight\s*=\s*"([\d.]+)/i)?.[1] ?? '');
    if (!(w > 0 && h > 0)) return null;
    vb = [0, 0, w, h];
  }
  const inner = svg.slice(open[0].length).replace(/<\/svg>\s*$/i, '');
  return { inner, vb };
}

/**
 * One SVG of the whole design: the picture as shapes (when the vendor gave them), shapes and words as paths. Photos stay
 * pictures inside the file. The words are outlines, so the file opens the same everywhere.
 */
export async function renderSvg(i: Omit<ComposeIn, 'format' | 'skipText' | 'watermark'> & { artSvg: string | null; printWIn: number; printHIn: number }): Promise<string> {
  const sharp = await sharpLib();
  const { layout: L, palette } = i;
  const parts: string[] = [];
  if (i.artSvg) {
    const p = svgParts(i.artSvg);
    if (p) parts.push(`<svg x="0" y="0" width="${L.w}" height="${L.h}" viewBox="${p.vb.join(' ')}" preserveAspectRatio="xMidYMid slice" overflow="hidden">${p.inner}</svg>`);
  }
  if (!parts.length) parts.push(`<rect width="${L.w}" height="${L.h}" fill="${palette.bg}"/>`);
  const dataUri = async (buf: Buffer, w: number, h: number, fitMode: 'cover' | 'contain') => {
    const out = await sharp(buf, { limitInputPixels: 80_000_000 }).rotate().resize(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), { fit: fitMode, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    return `data:image/png;base64,${out.toString('base64')}`;
  };
  for (const el of L.elements) {
    if (el.t === 'rect') parts.push(`<path d="${roundRect(el.x, el.y, el.w, el.h, el.r)}" fill="${el.fill}" fill-opacity="${el.opacity}"/>`);
    else if (el.t === 'text') parts.push(textInner(el));
    else if (el.t === 'path') parts.push(`<path d="${el.d}" fill="${el.fill}"/>`);
    else {
      const src = el.src === 'logo' ? i.logo : el.shape === 'cutout' && i.photoCut ? i.photoCut : i.photo;
      if (!src) continue;
      const uri = await dataUri(src, Math.min(el.w, 1600), Math.min(el.h, 1600), el.src === 'logo' ? 'contain' : 'cover');
      if (el.src === 'logo') parts.push(`<path d="${roundRect(el.x, el.y, el.w, el.h, Math.min(el.w, el.h) * 0.12)}" fill="#fff" fill-opacity="0.94"/>`);
      const pad = el.src === 'logo' ? Math.min(el.w, el.h) * 0.08 : 0;
      const id = `c${parts.length}`;
      const clip = el.src === 'photo' && el.shape !== 'rect' ? (el.shape === 'circle' || el.shape === 'oval' ? `<clipPath id="${id}"><ellipse cx="${n2(el.x + el.w / 2)}" cy="${n2(el.y + el.h / 2)}" rx="${n2(el.w / 2)}" ry="${n2(el.h / 2)}"/></clipPath>` : `<clipPath id="${id}"><path d="${roundRect(el.x, el.y, el.w, el.h, Math.min(el.w, el.h) * 0.06)}"/></clipPath>`) : '';
      if (clip) parts.push(`<defs>${clip}</defs>`);
      parts.push(`<image x="${n2(el.x + pad)}" y="${n2(el.y + pad)}" width="${n2(el.w - 2 * pad)}" height="${n2(el.h - 2 * pad)}" preserveAspectRatio="${el.src === 'logo' ? 'xMidYMid meet' : 'xMidYMid slice'}" href="${uri}"${clip ? ` clip-path="url(#${id})"` : ''}/>`);
    }
  }
  const w = L.w, h = L.h;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${+i.printWIn.toFixed(3)}in" height="${+i.printHIn.toFixed(3)}in" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`;
}
