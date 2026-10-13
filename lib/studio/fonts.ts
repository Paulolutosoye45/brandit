import fs from 'node:fs';
import path from 'node:path';
import * as fontkit from 'fontkit';

/*
 * The fonts Studio sets words in. Only fonts that have the naira sign and every letter Nigerian names need
 * (Yoruba dots and tone marks, Igbo, Hausa hooked letters) are offered. A test checks this, so a font that
 * would silently drop a mark can never be added by accident. Files live in studio-assets/fonts (SIL Open Font Licence).
 */
export type FontId = 'inter' | 'montserrat' | 'anton' | 'garamond' | 'script' | 'noto';
export type Weight = 'regular' | 'bold';

export const FONTS: { id: FontId; label: string; blurb: string; files: Record<Weight, string> }[] = [
  { id: 'montserrat', label: 'Bold modern', blurb: 'Clear and confident. Good for almost anything.', files: { regular: 'inter-regular.ttf', bold: 'montserrat-extrabold.ttf' } },
  { id: 'anton', label: 'Tall and heavy', blurb: 'Big, loud headlines for parties, shops and shirts.', files: { regular: 'inter-regular.ttf', bold: 'anton-regular.ttf' } },
  { id: 'garamond', label: 'Classic serif', blurb: 'Elegant. Weddings, memorials and church programmes.', files: { regular: 'garamond-regular.ttf', bold: 'garamond-bold.ttf' } },
  { id: 'script', label: 'Script', blurb: 'Flowing handwriting for names. Check capital letters carefully.', files: { regular: 'garamond-regular.ttf', bold: 'vibes-regular.ttf' } },
  { id: 'inter', label: 'Plain and neutral', blurb: 'Simple and easy to read.', files: { regular: 'inter-regular.ttf', bold: 'inter-bold.ttf' } },
  { id: 'noto', label: 'Universal', blurb: 'The safety font. Every letter and symbol Studio can print.', files: { regular: 'noto-regular.ttf', bold: 'noto-bold.ttf' } },
];
export const FONT_IDS = FONTS.map((f) => f.id);
export const isFontId = (v: unknown): v is FontId => FONT_IDS.includes(v as FontId);

export const fontDir = () => path.resolve(process.env.STUDIO_FONT_DIR ?? path.join(process.cwd(), 'studio-assets', 'fonts'));

type Font = fontkit.Font;
const cache = new Map<string, Font>();

export function loadFile(file: string): Font {
  let f = cache.get(file);
  if (!f) {
    const p = path.join(fontDir(), file);
    if (!fs.existsSync(p)) throw new Error(`Studio font file missing: ${p}. The studio-assets folder must be deployed with the app.`);
    const opened = fontkit.openSync(p);
    if ('fonts' in opened) throw new Error(`Font collections are not supported: ${file}`);
    f = opened as Font;
    cache.set(file, f);
  }
  return f;
}

export function fontFor(id: FontId, weight: Weight): Font {
  const def = FONTS.find((f) => f.id === id) ?? FONTS[0];
  return loadFile(def.files[weight]);
}

/** True when the font has a drawing for every visible character in the text. */
export function covers(font: Font, text: string): boolean {
  for (const ch of text.normalize('NFC')) {
    if (/\s/.test(ch)) continue;
    if (!font.hasGlyphForCodePoint(ch.codePointAt(0)!)) return false;
  }
  return true;
}

/** Characters no Studio font can print (emoji, hearts, symbols). The customer is told which ones. */
export function unsupportedChars(text: string): string[] {
  const noto = [fontFor('noto', 'regular'), fontFor('noto', 'bold')];
  const bad = new Set<string>();
  for (const ch of String(text).normalize('NFC')) {
    if (/\s/.test(ch)) continue;
    const cp = ch.codePointAt(0)!;
    if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) { bad.add(ch); continue; }
    if (!noto.every((f) => f.hasGlyphForCodePoint(cp))) bad.add(ch);
  }
  return [...bad];
}

/** Zero-width marks, control characters and stray format characters removed. Accents and Yoruba marks stay. */
export const cleanText = (s: string) =>
  String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g, '').replace(/\r\n?/g, '\n').normalize('NFC');
