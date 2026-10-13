import { fit, type Glyph, type TextBlock } from './typeset';
import type { FontId } from './fonts';
import type { Palette, LineRole } from '../../content/studio';
import type { Preset } from './specs';

/*
 * Where every word, photo, logo and code goes. The layout is worked out once, in "reference units" (the long side of the
 * print is 2000 units), and then drawn at any size by scaling. So the small preview, the free sketch and the print file
 * have exactly the same line breaks and positions: what the customer approves is what prints.
 */
export const REF = 2000;

export type Rect = { x: number; y: number; w: number; h: number };
export type PhotoShape = 'rect' | 'rounded' | 'circle' | 'oval' | 'cutout';
export type Element =
  | { t: 'rect'; x: number; y: number; w: number; h: number; r: number; fill: string; opacity: number }
  | { t: 'text'; x: number; y: number; w: number; h: number; glyphs: Glyph[]; fill: string; lineId: string; size: number }
  | { t: 'path'; d: string; fill: string; opacity?: number; box: Rect }
  | { t: 'image'; src: 'photo' | 'logo'; x: number; y: number; w: number; h: number; shape: PhotoShape; plate: boolean };

export type LayoutChoices = { font: FontId; theme: 'auto' | 'light' | 'dark'; style: 'panels' | 'clean'; photoShape: PhotoShape };
export const DEFAULT_CHOICES: LayoutChoices = { font: 'montserrat', theme: 'auto', style: 'panels', photoShape: 'rounded' };

export type LineIn = { id: string; role: LineRole; text: string };
export type LayoutIn = {
  w: number; h: number; preset: Preset; lines: LineIn[]; palette: Palette; choices: LayoutChoices;
  hasPhoto: boolean; hasLogo: boolean; qr: boolean | { modules: boolean[][] } | null; safePct: number;
  /** Mean brightness (0 dark to 1 light) of the art under a rectangle, for choosing light or dark words when there is no panel. */
  lumaAt?: (r: Rect) => number;
};
export type LayoutOut = { w: number; h: number; elements: Element[]; photo: Rect | null; logo: Rect | null; qr: Rect | null; clipped: string[]; fallbackFont: boolean; notes: string[] };

/** Reference canvas for a print: long side 2000. */
export const refCanvas = (printW: number, printH: number) => {
  const k = REF / Math.max(printW, printH);
  return { w: Math.round(printW * k), h: Math.round(printH * k) };
};

const SUPPORT: Record<FontId, FontId> = { montserrat: 'inter', anton: 'inter', garamond: 'garamond', script: 'garamond', inter: 'inter', noto: 'noto' };

const hexLum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
};
export const contrastOn = (bg: string, light = '#FFFFFF', dark = '#0B1F33') => (hexLum(bg) < 0.4 ? light : dark);

export const roundRectPath = (x: number, y: number, w: number, h: number, r: number) => {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${x + rr} ${y}H${x + w - rr}A${rr} ${rr} 0 0 1 ${x + w} ${y + rr}V${y + h - rr}A${rr} ${rr} 0 0 1 ${x + w - rr} ${y + h}H${x + rr}A${rr} ${rr} 0 0 1 ${x} ${y + h - rr}V${y + rr}A${rr} ${rr} 0 0 1 ${x + rr} ${y}Z`;
};

/** A QR code as one vector path in reference units. */
export const qrPath = (modules: boolean[][], x: number, y: number, size: number) => {
  const n = modules.length, c = size / n;
  let d = '';
  for (let r = 0; r < n; r++) for (let q = 0; q < n; q++) if (modules[r][q]) d += `M${+(x + q * c).toFixed(2)} ${+(y + r * c).toFixed(2)}h${+c.toFixed(2)}v${+c.toFixed(2)}h${-+c.toFixed(2)}z`;
  return d;
};

type Placed = { block: TextBlock; role: LineRole; id: string };

export function buildLayout(i: LayoutIn): LayoutOut {
  const { w: W, h: H, preset, palette, choices } = i;
  const u = Math.min(W, H);
  const m = (i.safePct / 100) * u;
  const pad = 0.03 * u;
  const gap = 0.018 * u;
  const out: Element[] = [];
  const clipped: string[] = [];
  const notes: string[] = [];
  let fallbackFont = false;
  let photo: Rect | null = null, logo: Rect | null = null, qr: Rect | null = null;
  const support = SUPPORT[choices.font];
  const luma = i.lumaAt ?? (() => 0.3);

  const lines = i.lines.map((l) => ({ ...l, text: l.text.trim() })).filter((l) => l.text);
  const heads = lines.filter((l) => l.role === 'headline');
  const subs = lines.filter((l) => l.role === 'sub');
  const details = lines.filter((l) => l.role !== 'headline' && l.role !== 'sub');

  const mk = (role: LineRole, text: string, id: string, maxW: number, maxH: number, maxSize: number, minSize: number, align: 'left' | 'center' | 'right', maxLines?: number): Placed => {
    const head = role === 'headline';
    const fontId = head ? choices.font : support;
    const weight = head ? 'bold' : role === 'date' || role === 'contact' ? 'bold' : 'regular';
    const block = fit({ text, fontId, weight, maxW, maxH, maxSize, minSize, align, maxLines: maxLines ?? (head ? 4 : 3), lineHeight: head ? 1.08 : 1.2 });
    if (block.fellBack) fallbackFont = true;
    if (block.clipped) clipped.push(id);
    return { block, role, id };
  };
  const joinText = (ls: { text: string }[]) => ls.map((l) => l.text).join('\n');

  // Colours. On a panel the words always have the contrast they need. Without one, the art decides.
  const headPanel = (() => {
    if (choices.theme === 'dark') return { fill: palette.soft, text: palette.ink, op: 0.93 };
    if (choices.theme === 'light') return { fill: '#101820', text: '#FFFFFF', op: 0.88 };
    return { fill: palette.bg, text: contrastOn(palette.bg), op: 0.9 };
  })();
  const detailPanel = { fill: palette.soft, text: palette.ink, op: 0.94 };
  const panels = choices.style === 'panels';

  /** Draw a text block, optionally with a panel behind it. */
  const drawBlocks = (blocks: Placed[], x: number, y: number, w: number, p: { fill: string; text: string; op: number } | null, align: 'left' | 'center' | 'right', accent = false, space = gap): Rect => {
    const innerH = blocks.reduce((s, b, k) => s + b.block.h + (k ? space : 0), 0);
    const boxH = innerH + (p ? 2 * pad : 0);
    if (p) out.push({ t: 'rect', x, y, w, h: boxH, r: 0.03 * u, fill: p.fill, opacity: p.op });
    let cy = y + (p ? pad : 0);
    for (const b of blocks) {
      const bx = align === 'center' ? x + (w - b.block.w) / 2 : align === 'right' ? x + w - (p ? pad : 0) - b.block.w : x + (p ? pad : 0);
      let fill = p?.text;
      if (!fill) {
        const l = luma({ x: bx, y: cy, w: b.block.w, h: b.block.h });
        fill = l > 0.55 ? '#0B1F33' : '#FFFFFF';
        if (l > 0.3 && l < 0.7) out.push({ t: 'rect', x: bx - pad / 2, y: cy - pad / 3, w: b.block.w + pad, h: b.block.h + (2 * pad) / 3, r: pad / 2, fill: fill === '#FFFFFF' ? '#000000' : '#FFFFFF', opacity: 0.38 });
      }
      out.push({ t: 'text', x: bx, y: cy, w: b.block.w, h: b.block.h, glyphs: b.block.glyphs, size: b.block.size, fill, lineId: b.id });
      cy += b.block.h + space;
    }
    if (accent && p) out.push({ t: 'rect', x: x + (align === 'center' ? (w - 0.16 * w) / 2 : pad), y: y + boxH - pad * 0.62, w: 0.16 * w, h: Math.max(3, 0.006 * u), r: 2, fill: palette.accent, opacity: 1 });
    return { x, y, w, h: boxH };
  };

  const headBlocks = (maxW: number, maxH: number, k: number): Placed[] => {
    const arr: Placed[] = [];
    if (heads.length) arr.push(mk('headline', joinText(heads), heads[0].id, maxW, maxH * 0.72, 0.16 * u * k, 0.032 * u, 'center'));
    if (subs.length) arr.push(mk('sub', joinText(subs), subs[0].id, maxW, maxH * 0.34, 0.058 * u * k, 0.022 * u, 'center', 2));
    return arr;
  };
  const detailBlocks = (maxW: number, k: number): Placed[] =>
    details.map((l) => mk(l.role, l.text, l.id, maxW, 0.12 * u, (l.role === 'date' ? 0.056 : 0.046) * u * k, 0.02 * u, 'center', 2));

  // ---------- Logo and QR ----------
  const logoBox = (x: number, y: number, maxW: number, maxH: number): Rect => {
    logo = { x, y, w: maxW, h: maxH };
    out.push({ t: 'image', src: 'logo', x, y, w: maxW, h: maxH, shape: 'rect', plate: false });
    return logo;
  };

  const withQr = (area: Rect, size: number): Rect => {
    // Returns the area left for words once a code sits at the right.
    qr = { x: area.x + area.w - size - pad, y: area.y + (area.h - size) / 2, w: size, h: size };
    return { x: area.x, y: area.y, w: area.w - size - pad * 2, h: area.h };
  };
  const drawQr = (r: Rect) => {
    if (!i.qr || typeof i.qr === 'boolean') return;
    out.push({ t: 'rect', x: r.x - pad / 2, y: r.y - pad / 2, w: r.w + pad, h: r.h + pad, r: pad / 2, fill: '#FFFFFF', opacity: 1 });
    out.push({ t: 'path', d: qrPath(i.qr.modules, r.x, r.y, r.w), fill: '#0B1F33', box: r });
  };

  // ---------- Layouts ----------
  const vertical = () => {
    const R: Rect = { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
    const innerW = R.w - 2 * pad;
    const photoWanted = i.hasPhoto;
    const qrSize = i.qr ? 0.17 * u : 0;
    let top = R.y;
    if (i.hasLogo) {
      const lh = 0.075 * H;
      logoBox(R.x, R.y, Math.min(R.w * 0.42, lh * 3.4), lh);
      top = R.y + lh + gap;
    }
    for (const k of photoWanted ? [1, 0.86, 0.72] : [1]) {
      // Plan: words at the bottom, headline on top, photo in between.
      const dw = innerW - (qrSize ? qrSize + pad : 0);
      const dBlocks = detailBlocks(dw, k);
      const dH = dBlocks.reduce((s, b, q) => s + b.block.h + (q ? gap * 0.6 : 0), 0) + 2 * pad;
      const detailsH = Math.max(dH, qrSize ? qrSize + 2 * pad : 0);
      const hBlocks = headBlocks(innerW, (photoWanted ? 0.2 : 0.34) * H, k);
      const hH = hBlocks.reduce((s, b, q) => s + b.block.h + (q ? gap : 0), 0) + 2 * pad;
      const detailsY = R.y + R.h - detailsH;
      const free = detailsY - gap - (top + (hBlocks.length ? hH + gap : 0));
      if (photoWanted && free < 0.26 * H && k !== 0.72) continue;
      // Draw, in the order they should stack: panel shapes first, then pictures, then words.
      if (hBlocks.length) drawBlocks(hBlocks, R.x, top, R.w, panels ? headPanel : null, 'center', true);
      if (photoWanted) {
        const pw = Math.min(R.w * 0.84, Math.max(0.2 * u, free) * (W / H > 0.7 ? 1.05 : 0.85));
        const ph = Math.max(0.2 * u, free);
        const fw = Math.min(R.w * 0.86, ph * 0.86 * (choices.photoShape === 'circle' ? 1 : 0.82));
        const sq = choices.photoShape === 'circle' ? Math.min(fw, ph) : null;
        const rw = sq ?? Math.min(pw, R.w * 0.84);
        const rh = sq ?? ph;
        const rx = R.x + (R.w - rw) / 2;
        const ry = top + (hBlocks.length ? hH + gap : 0) + (free - rh) / 2;
        photo = { x: rx, y: ry, w: rw, h: rh };
        out.push({ t: 'image', src: 'photo', x: rx, y: ry, w: rw, h: rh, shape: choices.photoShape, plate: false });
      }
      if (dBlocks.length || qrSize) {
        const box: Rect = { x: R.x, y: detailsY, w: R.w, h: detailsH };
        out.push({ t: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, r: 0.03 * u, fill: detailPanel.fill, opacity: detailPanel.op });
        let cy = box.y + (detailsH - dH) / 2 + pad;
        for (const b of dBlocks) {
          out.push({ t: 'text', x: R.x + pad + (dw - b.block.w) / 2, y: cy, w: b.block.w, h: b.block.h, glyphs: b.block.glyphs, size: b.block.size, fill: detailPanel.text, lineId: b.id });
          cy += b.block.h + gap * 0.6;
        }
        if (qrSize) {
          const q: Rect = { x: R.x + R.w - pad - qrSize, y: box.y + (detailsH - qrSize) / 2, w: qrSize, h: qrSize };
          qr = q;
          drawQr(q);
        }
      }
      return;
    }
  };

  const wide = () => {
    const R: Rect = { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
    const split = i.hasPhoto;
    const colW = split ? R.w * 0.56 : R.w;
    const innerW = colW - 2 * pad;
    let top = R.y;
    if (i.hasLogo) {
      const lh = 0.16 * H;
      logoBox(R.x, R.y, Math.min(colW * 0.4, lh * 3.4), lh);
      top = R.y + lh + gap;
    }
    const qrSize = i.qr ? 0.26 * H : 0;
    const dBlocks = detailBlocks(innerW - (qrSize ? qrSize + pad : 0), 0.8);
    const dH = dBlocks.reduce((s, b, q) => s + b.block.h + (q ? gap * 0.6 : 0), 0) + 2 * pad;
    const detailsH = Math.max(dH, qrSize ? qrSize + 2 * pad : 0);
    const hBlocks = headBlocks(innerW, Math.max(0.2 * H, R.y + R.h - detailsH - gap - top - 2 * pad), 1.15);
    drawBlocks(hBlocks, R.x, top, colW, panels ? headPanel : null, split ? 'left' : 'center', true);
    if (dBlocks.length || qrSize) {
      const dy = R.y + R.h - detailsH;
      out.push({ t: 'rect', x: R.x, y: dy, w: colW, h: detailsH, r: 0.03 * u, fill: detailPanel.fill, opacity: detailPanel.op });
      let cy = dy + (detailsH - dH) / 2 + pad;
      const dw = innerW - (qrSize ? qrSize + pad : 0);
      for (const b of dBlocks) {
        out.push({ t: 'text', x: R.x + pad + (split ? 0 : (dw - b.block.w) / 2), y: cy, w: b.block.w, h: b.block.h, glyphs: b.block.glyphs, size: b.block.size, fill: detailPanel.text, lineId: b.id });
        cy += b.block.h + gap * 0.6;
      }
      if (qrSize) { const q = { x: R.x + colW - pad - qrSize, y: dy + (detailsH - qrSize) / 2, w: qrSize, h: qrSize }; qr = q; drawQr(q); }
    }
    if (split) {
      const px = R.x + colW + gap * 2, pw = R.w - colW - gap * 2;
      photo = { x: px, y: R.y, w: pw, h: R.h };
      out.push({ t: 'image', src: 'photo', x: px, y: R.y, w: pw, h: R.h, shape: choices.photoShape, plate: false });
    }
  };

  const card = () => {
    const R: Rect = { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
    const colW = R.w * 0.64;
    const innerW = colW - 2 * pad;
    const blocks: Placed[] = [];
    if (heads.length) blocks.push(mk('headline', joinText(heads), heads[0].id, innerW, R.h * 0.34, 0.2 * H, 0.05 * H, 'left', 2));
    if (subs.length) blocks.push(mk('sub', joinText(subs), subs[0].id, innerW, R.h * 0.18, 0.1 * H, 0.04 * H, 'left', 1));
    for (const l of details) blocks.push(mk(l.role, l.text, l.id, innerW, R.h * 0.16, 0.075 * H, 0.035 * H, 'left', 1));
    const total = blocks.reduce((s, b, q) => s + b.block.h + (q ? gap * 0.5 : 0), 0) + 2 * pad;
    const ph = Math.min(R.h, total);
    const py = R.y + (R.h - ph) / 2;
    out.push({ t: 'rect', x: R.x, y: py, w: colW, h: ph, r: 0.04 * H, fill: detailPanel.fill, opacity: detailPanel.op });
    let cy = py + pad;
    for (const b of blocks) {
      out.push({ t: 'text', x: R.x + pad, y: cy, w: b.block.w, h: b.block.h, glyphs: b.block.glyphs, size: b.block.size, fill: detailPanel.text, lineId: b.id });
      cy += b.block.h + gap * 0.5;
    }
    const rx = R.x + colW + gap * 2, rw = R.w - colW - gap * 2;
    if (i.hasLogo) logoBox(rx, R.y, rw, Math.min(R.h * (i.qr ? 0.5 : 0.7), rw));
    if (i.qr) { const s = Math.min(rw, R.h * 0.42); const q = { x: rx + (rw - s) / 2, y: R.y + R.h - s, w: s, h: s }; qr = q; drawQr(q); }
  };

  const id = () => {
    const R: Rect = { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
    const bandH = 0.24 * H;
    out.push({ t: 'rect', x: 0, y: 0, w: W, h: bandH + m, r: 0, fill: palette.bg, opacity: 1 });
    const bandText = contrastOn(palette.bg);
    let tx = R.x;
    if (i.hasLogo) { logoBox(R.x, R.y, bandH * 1.5, bandH * 0.86); tx = R.x + bandH * 1.5 + gap * 1.5; }
    const comp = heads.length ? mk('headline', joinText(heads), heads[0].id, W - m - tx, bandH * 0.86, 0.1 * H, 0.04 * H, 'left', 2) : null;
    if (comp) out.push({ t: 'text', x: tx, y: R.y + (bandH * 0.86 - comp.block.h) / 2, w: comp.block.w, h: comp.block.h, glyphs: comp.block.glyphs, size: comp.block.size, fill: bandText, lineId: comp.id });
    const bodyY = bandH + m + gap;
    const bodyH = H - m - bodyY;
    let tx2 = R.x;
    if (i.hasPhoto) {
      const pw = Math.min(R.w * 0.3, bodyH * 0.78);
      photo = { x: R.x, y: bodyY, w: pw, h: bodyH };
      out.push({ t: 'image', src: 'photo', x: R.x, y: bodyY, w: pw, h: bodyH, shape: 'rounded', plate: false });
      tx2 = R.x + pw + gap * 2;
    }
    const innerW = W - m - tx2 - 2 * pad;
    const blocks: Placed[] = [];
    if (subs.length) blocks.push(mk('sub', joinText(subs), subs[0].id, innerW, bodyH * 0.36, 0.1 * H, 0.04 * H, 'left', 2));
    for (const l of details) blocks.push(mk(l.role, l.text, l.id, innerW, bodyH * 0.2, 0.07 * H, 0.032 * H, 'left', 1));
    const total = blocks.reduce((s, b, q) => s + b.block.h + (q ? gap * 0.5 : 0), 0) + 2 * pad;
    const ph = Math.min(bodyH, total);
    out.push({ t: 'rect', x: tx2, y: bodyY, w: W - m - tx2, h: bodyH, r: 0.03 * H, fill: detailPanel.fill, opacity: detailPanel.op });
    let cy = bodyY + (bodyH - ph) / 2 + pad;
    for (const b of blocks) {
      out.push({ t: 'text', x: tx2 + pad, y: cy, w: b.block.w, h: b.block.h, glyphs: b.block.glyphs, size: b.block.size, fill: detailPanel.text, lineId: b.id });
      cy += b.block.h + gap * 0.5;
    }
    if (i.qr) notes.push('A QR code is not placed on ID cards.');
  };

  const frame = () => {
    if (!i.hasPhoto) return vertical();
    const R: Rect = { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
    const innerW = R.w - 2 * pad;
    const hasCaption = heads.length || subs.length;
    const cBlocks = hasCaption ? headBlocks(innerW, 0.15 * H, 0.82) : [];
    const cH = cBlocks.reduce((s, b, q) => s + b.block.h + (q ? gap * 0.6 : 0), 0) + (cBlocks.length ? 2 * pad : 0);
    const matX = 0.06 * W, matY = 0.05 * H;
    const phH = H - 2 * matY - (cH ? cH + gap : 0) - m * 0.5;
    const phW = W - 2 * matX;
    photo = { x: matX, y: matY, w: phW, h: Math.max(0.3 * H, phH) };
    out.push({ t: 'image', src: 'photo', x: photo.x, y: photo.y, w: photo.w, h: photo.h, shape: choices.photoShape === 'cutout' ? 'cutout' : choices.photoShape === 'circle' || choices.photoShape === 'oval' ? 'rounded' : choices.photoShape, plate: false });
    if (cBlocks.length) drawBlocks(cBlocks, matX, photo.y + photo.h + gap, phW, panels ? headPanel : null, 'center', false);
    if (details.length) notes.push('Dates and details are not placed on a picture frame. Add them to the headline or second line if you want them printed.');
  };

  const round = () => {
    const side = u;
    const innerW = 0.62 * side;
    let y = 0.2 * side;
    if (i.hasLogo) { const s = 0.2 * side; logoBox(side / 2 - s / 2, y, s, s); y += s + gap; }
    if (i.hasPhoto && !i.hasLogo) {
      const s = 0.36 * side;
      photo = { x: side / 2 - s / 2, y, w: s, h: s };
      out.push({ t: 'image', src: 'photo', x: photo.x, y, w: s, h: s, shape: 'circle', plate: false });
      y += s + gap;
    }
    const k = 1;
    const blocks = headBlocks(innerW, Math.max(0.2 * side, side * 0.8 - y), k);
    const first = details.find((d) => d.role === 'contact') ?? details[0];
    if (first) blocks.push(mk(first.role, first.text, first.id, innerW, 0.1 * side, 0.05 * side, 0.025 * side, 'center', 1));
    const total = blocks.reduce((s, b, q) => s + b.block.h + (q ? gap : 0), 0) + 2 * pad;
    const x = (W - (innerW + 2 * pad)) / 2;
    drawBlocks(blocks, x, Math.min(y, H - m - total), innerW + 2 * pad, panels ? headPanel : null, 'center', false);
    if (details.length > 1) notes.push('A round sticker has room for the headline, one line and one contact detail.');
  };

  switch (preset) {
    case 'wide': wide(); break;
    case 'card': card(); break;
    case 'id': id(); break;
    case 'frame': frame(); break;
    case 'round': round(); break;
    default: vertical();
  }
  if (i.hasLogo && !logo) notes.push('Logo could not be placed.');
  return { w: W, h: H, elements: out, photo, logo, qr, clipped, fallbackFont, notes };
}
