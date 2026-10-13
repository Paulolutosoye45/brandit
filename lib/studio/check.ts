import { checkArtwork, effectiveDpi, type CheckLine, type Status } from '../accuracy';
import type { Thresholds } from '../settings-defaults';
import type { Product, SizeOption } from '../types';
import type { LayoutOut, Rect } from './layout';
import { REF } from './layout';
import { sizesThatPass, type Spec } from './specs';

/*
 * The print gate. Before a Studio design can be approved it must pass the same sharpness rules the rest of Brandit uses,
 * plus the things only a made design can get wrong: a customer photo too small for the space it was given, a logo that
 * will print soft, words too small to read on paper, a line too long to fit. The result is in plain words and, when
 * something stops the design, it offers the three ways forward: a size that works, the design without the photo, or a person.
 */
export type StudioCheck = {
  status: Status;
  dpi: number | null;
  lines: CheckLine[];
  headline: string;
  /** Sizes of this product that the customer's photo can fill sharply, when the photo is the problem. */
  sizesThatPass: SizeOption[];
  options: { id: 'smaller' | 'no_photo' | 'designer' | 'shorten' | 'upgrade' | 'bigger_photo'; label: string }[];
};

export type Dims = { w: number; h: number };
export type CheckIn = {
  spec: Spec;
  layout: LayoutOut;
  tier: 'standard' | 'premium';
  /** Pixels of the art before it was enlarged. */
  art: Dims | null;
  photo: Dims | null;
  logo: Dims | null;
  /** The file that will be printed. */
  file: { mime: string; bytes: number; w: number; h: number };
  thresholds: Thresholds;
  maxBytes: number;
  product?: Product | null;
  /** Hex colours used in the design (palette), to warn about screen-only brights. */
  colours?: string[];
  minTextPt?: number;
};

const worst = (a: Status, b: Status): Status => (a === 'stop' || b === 'stop' ? 'stop' : a === 'warn' || b === 'warn' ? 'warn' : 'pass');

/** A bright screen colour that CMYK ink cannot reach, so it prints duller. */
export function screenOnlyColour(hex: string): boolean {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (g > 200 && r < 90 && b < 150) || (b > 225 && r < 70 && g < 210) || (r > 225 && b > 170 && g < 90) || (r > 235 && g > 230 && b < 60);
}

/** Regions of a print in inches, from reference units. */
const inches = (r: Rect, spec: Spec, layout: LayoutOut) => ({ w: (r.w / layout.w) * spec.printWIn, h: (r.h / layout.h) * spec.printHIn });

export function checkStudio(i: CheckIn): StudioCheck {
  const { spec, layout: L } = i;
  const lines: CheckLine[] = [];
  let status: Status = 'pass';
  const add = (l: CheckLine) => { lines.push(l); status = worst(status, l.status); };
  const options: StudioCheck['options'] = [];
  let ok: SizeOption[] = [];

  // 1. The file itself, by the platform's own rules.
  const base = checkArtwork({
    facts: { mime: i.file.mime, bytes: i.file.bytes, widthPx: i.file.w, heightPx: i.file.h },
    printWIn: spec.printWIn, printHIn: spec.printHIn, cls: spec.cls, thresholds: i.thresholds, maxBytes: i.maxBytes,
  });
  for (const l of base.lines) add(l);

  // 2. Size guaranteed for this tier.
  if (spec.needsPremium && i.tier === 'standard') {
    add({ id: 'tier', status: 'stop', label: 'Print size', message: 'This size is bigger than Standard designs are guaranteed sharp for. Upgrade to Premium, or choose a smaller size.' });
    options.push({ id: 'upgrade', label: 'Upgrade to Premium' }, { id: 'smaller', label: 'Choose a smaller size' });
  }

  // 3. How far the art was enlarged. Flat graphics take enlarging well; a lot of it is worth a note.
  if (i.art) {
    const cover = Math.max(spec.w / i.art.w, spec.h / i.art.h);
    if (cover > 6) add({ id: 'art', status: 'warn', label: 'Background sharpness', message: `The background was enlarged ${cover.toFixed(1)} times to fill this size. Fine edges may look a little soft up close. A designer can check it.` });
    else add({ id: 'art', status: 'pass', label: 'Background sharpness', message: cover > 1.05 ? `The background was enlarged ${cover.toFixed(1)} times with a sharpening tool and holds up at this size.` : 'The background is sharp at this size.' });
  }

  // 4. The customer's photo in the space it was given.
  const photoEl = L.elements.find((e) => e.t === 'image' && e.src === 'photo');
  if (i.photo && L.photo && photoEl) {
    const r = inches(L.photo, spec, L);
    const dpi = Math.round(effectiveDpi(i.photo.w, i.photo.h, r.w, r.h));
    const t = i.thresholds[spec.cls];
    if (dpi >= t.pass * 0.8) add({ id: 'photo', status: 'pass', label: 'Your photo', message: `Your photo is sharp at this size (${dpi} dots per inch).` });
    else if (dpi >= t.warn) add({ id: 'photo', status: 'warn', label: 'Your photo', message: `Your photo will print a little soft at this size (${dpi} dots per inch). It is usable. A larger photo will look better.` });
    else {
      add({ id: 'photo', status: 'stop', label: 'Your photo', message: `Your photo is too small for this space and will print blurry (${dpi} dots per inch). Choose a smaller print size, use a bigger photo, or leave the photo out.` });
      if (i.product) ok = sizesThatPass(i.product, i.photo.w, i.photo.h, t.warn);
      options.push({ id: 'smaller', label: ok.length ? `Choose a size that works: ${ok.map((s) => s.label).slice(0, 3).join(', ')}` : 'Choose a smaller size' }, { id: 'bigger_photo', label: 'Upload a bigger photo' }, { id: 'no_photo', label: 'Make the design without the photo' });
    }
  }

  // 5. The logo.
  if (i.logo && L.logo) {
    const r = inches(L.logo, spec, L);
    const dpi = Math.round(effectiveDpi(i.logo.w, i.logo.h, r.w * 0.84, r.h * 0.84));
    const t = i.thresholds[spec.cls];
    if (dpi >= t.warn) add({ id: 'logo', status: 'pass', label: 'Your logo', message: `Your logo is sharp enough (${dpi} dots per inch).` });
    else add({ id: 'logo', status: 'warn', label: 'Your logo', message: `Your logo will print a little soft (${dpi} dots per inch). Send a larger copy, or a PDF or vector version, for the best result.` });
  }

  // 6. Words: too long, wrong characters, too small to read.
  if (L.clipped.length) {
    add({ id: 'fit', status: 'stop', label: 'Your words', message: 'One of your lines is too long to fit in the space. Shorten it, or choose a bigger print size.' });
    options.push({ id: 'shorten', label: 'Shorten the long line' });
  } else add({ id: 'fit', status: 'pass', label: 'Your words', message: 'Every line fits with room to spare.' });
  if (L.fallbackFont) add({ id: 'font', status: 'warn', label: 'Letters', message: 'A letter in your words is not in the font you chose, so Brandit used the universal font to print every letter correctly.' });

  const printLong = Math.max(spec.printWIn, spec.printHIn);
  let smallest = Infinity;
  for (const e of L.elements) if (e.t === 'text') smallest = Math.min(smallest, e.size);
  if (Number.isFinite(smallest)) {
    const pt = (smallest / REF) * printLong * 72;
    const min = i.minTextPt ?? 6;
    if (pt < min * 0.65) add({ id: 'legible', status: 'stop', label: 'Smallest text', message: `The smallest line prints at about ${pt.toFixed(1)} point, too small to read. Shorten the words or choose a bigger print size.` });
    else if (pt < min) add({ id: 'legible', status: 'warn', label: 'Smallest text', message: `The smallest line prints at about ${pt.toFixed(1)} point. It is readable, but small.` });
    else add({ id: 'legible', status: 'pass', label: 'Smallest text', message: `The smallest line prints at about ${Math.round(pt)} point and is easy to read.` });
  }

  // 7. Colours that look brighter on a screen than on paper.
  if (i.colours?.some(screenOnlyColour)) add({ id: 'colour', status: 'warn', label: 'Colours', message: 'Very bright screen colours print a little duller on paper. That is normal for every printer.' });

  const headline = status === 'pass' ? 'Sharp, readable and ready to print.' : status === 'warn' ? 'This will print well, with a note.' : (lines.find((l) => l.status === 'stop')?.message ?? 'This design needs a change before it can print.');
  if ((status as Status) === 'stop' && !options.some((o) => o.id === 'designer')) options.push({ id: 'designer', label: 'Ask a Brandit designer to fix it' });
  return { status, dpi: base.dpi, lines, headline, sizesThatPass: ok, options };
}
