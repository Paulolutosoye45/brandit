import type * as fontkit from 'fontkit';
import { covers, fontFor, cleanText, type FontId, type Weight } from './fonts';

/*
 * Sets words as outlines. Each letter is a shape taken from the font, positioned by the font's own rules (so a dot
 * under an e with an accent over it lands where it should), and scaled to the print. Because the words are shapes, not
 * pictures, they are sharp at any size and spelled exactly as typed. No operating-system fonts are involved, so the
 * result is the same on a laptop, on Render and in Docker.
 */
type Font = fontkit.Font;

export type Glyph = { d: string; x: number; y: number; s: number };
export type TextBlock = { glyphs: Glyph[]; w: number; h: number; size: number; lines: string[]; fontId: FontId; weight: Weight; fellBack: boolean; clipped: boolean };

const flipped = new WeakMap<Font, Map<number, string>>();
function glyphPath(font: Font, g: fontkit.Glyph): string {
  let m = flipped.get(font);
  if (!m) { m = new Map(); flipped.set(font, m); }
  let d = m.get(g.id);
  if (d === undefined) {
    // Flip once, in font units, so the path reads top-down like an SVG and the baseline is at 0.
    d = g.path.transform(1, 0, 0, -1, 0, 0).toSVG();
    m.set(g.id, d);
  }
  return d;
}

const lineWidth = (font: Font, text: string, size: number, track: number): number => {
  const run = font.layout(text);
  const s = size / font.unitsPerEm;
  return run.advanceWidth * s + track * size * Math.max(0, [...text].length - 1);
};

/** Break text into lines no wider than maxW. Explicit line breaks are kept. A word too wide for the box is split as a last resort. */
export function wrap(font: Font, text: string, size: number, maxW: number, track = 0): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let cur = '';
    for (const word of words) {
      const trial = cur ? `${cur} ${word}` : word;
      if (lineWidth(font, trial, size, track) <= maxW || !cur) {
        if (!cur && lineWidth(font, word, size, track) > maxW) {
          // One long word (an email, a hashtag). Split it by letters at the box edge.
          let piece = '';
          for (const ch of [...word]) {
            if (piece && lineWidth(font, piece + ch, size, track) > maxW) { out.push(piece); piece = ch; } else piece += ch;
          }
          cur = piece;
        } else cur = trial;
      } else { out.push(cur); cur = word; }
    }
    if (cur) out.push(cur);
  }
  return out;
}

export type FitOpts = {
  text: string; fontId: FontId; weight: Weight; maxW: number; maxH: number;
  maxSize: number; minSize: number; maxLines?: number; lineHeight?: number; track?: number; align?: 'left' | 'center' | 'right';
};

/**
 * Find the largest size at which the words fit the box. If even the smallest size does not fit, the block is returned
 * at the smallest size and marked clipped, so the design check can tell the customer to shorten the line.
 */
export function fit(o: FitOpts): TextBlock {
  const text = cleanText(o.text).trim();
  let fontId = o.fontId;
  let fellBack = false;
  let font = fontFor(fontId, o.weight);
  if (!covers(font, text)) { fontId = 'noto'; font = fontFor('noto', o.weight); fellBack = true; }
  const lh = o.lineHeight ?? 1.14;
  const track = o.track ?? 0;
  const maxLines = o.maxLines ?? 6;

  const attempt = (size: number) => {
    const lines = wrap(font, text, size, o.maxW, track);
    const h = lines.length * size * lh;
    const wide = Math.max(...lines.map((l) => lineWidth(font, l, size, track)), 0);
    return { lines, h, wide, ok: lines.length <= maxLines && h <= o.maxH && wide <= o.maxW + 0.5 };
  };

  let lo = o.minSize, hi = o.maxSize, best = attempt(lo), bestSize = lo;
  if (!best.ok) return build(font, fontId, o, best.lines, lo, lh, track, fellBack, true);
  for (let i = 0; i < 16 && hi - lo > 0.25; i++) {
    const mid = (lo + hi) / 2;
    const a = attempt(mid);
    if (a.ok) { lo = mid; best = a; bestSize = mid; } else hi = mid;
  }
  const top = attempt(o.maxSize);
  if (top.ok) return build(font, fontId, o, top.lines, o.maxSize, lh, track, fellBack, false);
  return build(font, fontId, o, best.lines, bestSize, lh, track, fellBack, false);
}

function build(font: Font, fontId: FontId, o: FitOpts, lines: string[], size: number, lh: number, track: number, fellBack: boolean, clipped: boolean): TextBlock {
  const s = size / font.unitsPerEm;
  const align = o.align ?? 'left';
  const glyphs: Glyph[] = [];
  const widths = lines.map((l) => (l ? lineWidth(font, l, size, track) : 0));
  const w = Math.max(...widths, 0);
  const asc = (font.ascent ?? font.unitsPerEm * 0.9) * s;
  const desc = Math.abs(font.descent ?? -font.unitsPerEm * 0.2) * s;
  const lineH = size * lh;
  lines.forEach((line, li) => {
    if (!line) return;
    const run = font.layout(line);
    const slackX = align === 'center' ? (w - widths[li]) / 2 : align === 'right' ? w - widths[li] : 0;
    // Centre the glyph row in its line box so lines of different fonts stack evenly.
    const baseline = li * lineH + (lineH - (asc + desc)) / 2 + asc;
    let x = slackX;
    let ci = 0;
    for (let i = 0; i < run.glyphs.length; i++) {
      const g = run.glyphs[i], p = run.positions[i];
      const d = glyphPath(font, g);
      if (d) glyphs.push({ d, x: x + p.xOffset * s, y: baseline - p.yOffset * s, s });
      x += p.xAdvance * s + (track ? track * size * (g.codePoints?.length ?? 1) : 0);
      ci += g.codePoints?.length ?? 1;
    }
    void ci;
  });
  return { glyphs, w, h: lines.length * lineH, size, lines, fontId, weight: o.weight, fellBack, clipped };
}

/** The real width of a one-line string at a size, for placing small things next to words. */
export const measure = (fontId: FontId, weight: Weight, text: string, size: number, track = 0) => lineWidth(fontFor(fontId, weight), cleanText(text), size, track);
