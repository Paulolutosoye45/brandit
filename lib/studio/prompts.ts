import { LEXICON, OCCASIONS, PALETTES, STYLES, VARIATIONS, occasionById, paletteById, styleById, type LineRole, type Palette } from '../../content/studio';
import { DEFAULT_CHOICES, type LayoutChoices, type PhotoShape } from './layout';
import { isFontId, cleanText } from './fonts';
import type { Spec } from './specs';
import { orientationOf } from './specs';
import type { GenIn } from './providers/types';

/*
 * The brief is what the customer typed and chose. Only the art direction (occasion, style, colours, composition and the
 * look sentence) is ever turned into a prompt for a picture maker. The customer's words (names, dates, phone numbers)
 * and photos are never sent to one: Brandit sets the words itself, so spelling is exact and faces are never redrawn.
 */
export type Brief = {
  occasion: string;
  lines: Record<string, string>;
  look: string;
  style: string;
  palette: string;
  choices: LayoutChoices;
  qrUrl: string;
};

export const LIMITS = { look: 300, line: 140, qr: 300 };
const SHAPES: PhotoShape[] = ['rect', 'rounded', 'circle', 'oval', 'cutout'];

export function defaultBrief(occasionId: string): Brief {
  const o = occasionById(occasionId);
  return { occasion: o.id, lines: {}, look: '', style: o.styles[0] ?? 'modern-minimal', palette: o.palette, choices: { ...DEFAULT_CHOICES }, qrUrl: '' };
}

/** Anything from a form, made safe and complete. Unknown fields are dropped. Never throws. */
export function normaliseBrief(raw: unknown, prev?: Brief): Brief {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const occ = occasionById(String(r.occasion ?? prev?.occasion ?? 'other'));
  const base = prev && prev.occasion === occ.id ? prev : defaultBrief(occ.id);
  const lines: Record<string, string> = {};
  const incoming = (r.lines && typeof r.lines === 'object' ? r.lines : base.lines) as Record<string, unknown>;
  for (const def of occ.lines) {
    const v = cleanText(String(incoming[def.id] ?? '')).replace(/[ \t]+/g, ' ').trim().slice(0, Math.min(def.max ?? LIMITS.line, LIMITS.line));
    if (v) lines[def.id] = v;
  }
  const ch = (r.choices && typeof r.choices === 'object' ? r.choices : base.choices) as Record<string, any>;
  const choices: LayoutChoices = {
    font: isFontId(ch.font) ? ch.font : base.choices.font,
    theme: ['auto', 'light', 'dark'].includes(ch.theme) ? ch.theme : base.choices.theme,
    style: ch.style === 'clean' || ch.style === 'panels' ? ch.style : base.choices.style,
    photoShape: SHAPES.includes(ch.photoShape) ? ch.photoShape : base.choices.photoShape,
  };
  const palette = r.palette === 'logo' ? 'logo' : PALETTES.some((p) => p.id === r.palette) ? String(r.palette) : base.palette;
  const style = STYLES.some((s) => s.id === r.style) ? String(r.style) : base.style;
  const look = cleanText(String(r.look ?? base.look ?? '')).replace(/\s+/g, ' ').trim().slice(0, LIMITS.look);
  let qrUrl = String(r.qrUrl ?? base.qrUrl ?? '').trim().slice(0, LIMITS.qr);
  if (qrUrl && !/^https:\/\/[^\s/]+\.[^\s/]+/i.test(qrUrl)) qrUrl = '';
  return { occasion: occ.id, lines, look, style, palette, choices, qrUrl };
}

/** The boxes in the order the layout wants them, with their roles. */
export function layoutLines(b: Brief): { id: string; role: LineRole; text: string }[] {
  const occ = occasionById(b.occasion);
  return occ.lines.map((d) => ({ id: d.id, role: d.role, text: b.lines[d.id] ?? '' })).filter((l) => l.text.trim());
}

/** Plain text of every word, for the content check and the spelling tick. */
export const wordsOf = (b: Brief) => layoutLines(b).map((l) => l.text);

export function missingRequired(b: Brief): string[] {
  const occ = occasionById(b.occasion);
  return occ.lines.filter((d) => d.required && !b.lines[d.id]?.trim()).map((d) => d.label);
}

/** The look sentence in plain English for the picture maker. Pidgin and Yoruba phrases become art direction. */
export function lookToEnglish(look: string): string {
  let s = look.trim();
  for (const [re, to] of LEXICON) s = s.replace(re, to);
  return s;
}

const NEGATIVE = [
  'text', 'letters', 'words', 'numbers', 'typography', 'captions', 'watermark', 'signature', 'logo', 'brand names',
  'faces', 'portraits', 'people', 'hands', 'photograph of a printed poster', 'product mockup', 'paper texture on a table', 'frame', 'blurry', 'low resolution', 'jpeg artifacts',
].join(', ');

/** Art direction for a picture maker. No customer words, no photos. */
export function buildArt(o: { brief: Brief; spec: Pick<Spec, 'printWIn' | 'printHIn' | 'productName' | 'slug'>; variation: number; note?: string; palette: Palette; hasPhoto: boolean; hasLogo: boolean; seed: number; sketch?: boolean }): GenIn {
  const occ = occasionById(o.brief.occasion);
  const style = styleById(o.brief.style) ?? STYLES[0];
  const orient = orientationOf(o.spec.printWIn, o.spec.printHIn);
  const variation = VARIATIONS[o.variation % VARIATIONS.length];
  const calm = o.hasPhoto ? 'Keep the middle of the page calm and uncluttered, because a photo will be placed there.' : 'Keep a calm, uncluttered area in the middle for words.';
  const tone = occ.tone === 'dignified' ? 'Mood: dignified, restrained, respectful; muted and elegant; no playful motifs, no balloons, no confetti.' : occ.tone === 'playful' ? 'Mood: playful, bright and energetic.' : occ.tone === 'business' ? 'Mood: professional, clean and trustworthy.' : 'Mood: warm, festive and celebratory.';
  const colours = `Colour palette: ${o.palette.label.toLowerCase()} (main ${o.palette.bg}, accent ${o.palette.accent}, light ${o.palette.soft}).`;
  const look = o.brief.look ? `Extra direction from the customer: ${lookToEnglish(o.brief.look)}.` : '';
  const note = o.note ? `Change requested: ${lookToEnglish(o.note)}.` : '';
  const prompt = [
    `Print background artwork for a ${orient} ${o.spec.productName.toLowerCase()}, flat graphic design, crisp clean edges, high detail, print-ready.`,
    `Theme: ${occ.art}.`,
    `Style: ${style.art}.`,
    colours,
    `Composition: ${variation}.`,
    calm,
    tone,
    look,
    note,
    'There must be no text, no letters, no numbers, no logos and no human faces anywhere in the picture.',
  ].filter(Boolean).join(' ');
  return {
    prompt,
    negative: NEGATIVE,
    aspect: o.spec.printWIn / o.spec.printHIn,
    seed: o.seed,
    hint: { palette: [o.palette.bg, o.palette.accent, o.palette.soft], style: style.id },
  };
}

export const occasionOptions = OCCASIONS.map((o) => ({ id: o.id, label: o.label, blurb: o.blurb }));
export { occasionById, paletteById };
