import type { CheckClass, SizeOption } from './types';
import type { Thresholds } from './settings-defaults';

export type Status = 'pass' | 'warn' | 'stop';

export type FileFacts = {
  mime: string;
  bytes: number;
  widthPx?: number;
  heightPx?: number;
  pages?: number;
  pageWidthIn?: number;
  pageHeightIn?: number;
};

export type CheckInput = {
  facts: FileFacts;
  printWIn: number;
  printHIn: number;
  cls: CheckClass;
  thresholds: Thresholds;
  maxBytes: number;
};

export type CheckLine = { id: string; status: Status; label: string; message: string };
export type CheckResult = {
  status: Status;
  dpi: number | null;
  lines: CheckLine[];
  headline: string;
};

export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'application/pdf'];
const SHAPE_TOLERANCE = 0.02;

const worst = (a: Status, b: Status): Status => (a === 'stop' || b === 'stop' ? 'stop' : a === 'warn' || b === 'warn' ? 'warn' : 'pass');

/** Pixels per inch the file gives at print size, using whichever orientation fits best. */
export function effectiveDpi(widthPx: number, heightPx: number, printW: number, printH: number): number {
  const imgPortrait = heightPx > widthPx;
  const printPortrait = printH > printW;
  const [pw, ph] = imgPortrait === printPortrait ? [printW, printH] : [printH, printW];
  return Math.min(widthPx / pw, heightPx / ph);
}

/** How far apart two shapes are, as a fraction. Orientation is ignored. */
export function aspectDifference(wA: number, hA: number, wB: number, hB: number): number {
  const a = Math.max(wA, hA) / Math.min(wA, hA);
  const b = Math.max(wB, hB) / Math.min(wB, hB);
  return Math.abs(a - b) / b;
}

/** The checks run in seconds and speak in plain words. */
export function checkArtwork(i: CheckInput): CheckResult {
  const { facts, thresholds, printWIn: pw, printHIn: ph } = i;
  const t = thresholds[i.cls];
  const lines: CheckLine[] = [];
  let status: Status = 'pass';
  let dpi: number | null = null;
  const add = (l: CheckLine) => {
    lines.push(l);
    status = worst(status, l.status);
  };
  const stopNow = (): CheckResult => ({ status: 'stop', dpi, lines, headline: lines[lines.length - 1].message });

  if (!ALLOWED_MIME.includes(facts.mime)) {
    add({ id: 'type', status: 'stop', label: 'File type', message: 'We can print PDF, JPG and PNG files. Save yours as one of those and upload it again.' });
    return stopNow();
  }
  add({ id: 'type', status: 'pass', label: 'File type', message: 'Good file type.' });

  if (facts.bytes > i.maxBytes) {
    add({ id: 'size', status: 'stop', label: 'File size', message: `This file is larger than ${Math.round(i.maxBytes / 1_000_000)} MB. Export a smaller copy and upload that.` });
    return stopNow();
  }
  add({ id: 'size', status: 'pass', label: 'File size', message: 'Size is fine.' });

  if (facts.mime === 'application/pdf') {
    if (facts.pageWidthIn && facts.pageHeightIn) {
      const diff = aspectDifference(facts.pageWidthIn, facts.pageHeightIn, pw, ph);
      add(
        diff <= SHAPE_TOLERANCE
          ? { id: 'shape', status: 'pass', label: 'Shape', message: 'The page matches the print size.' }
          : { id: 'shape', status: 'warn', label: 'Shape', message: 'The page is a different shape from the print area. A person will check how it fits.' },
      );
    }
    add({ id: 'pdf', status: 'pass', label: 'Quality', message: 'PDF received. A person checks fonts and image quality before anything prints.' });
  } else if (facts.widthPx && facts.heightPx) {
    dpi = Math.round(effectiveDpi(facts.widthPx, facts.heightPx, pw, ph));
    if (dpi >= t.pass) {
      add({ id: 'resolution', status: 'pass', label: 'Sharpness', message: `Your file looks sharp at this size (${dpi} dots per inch).` });
    } else if (dpi >= t.warn) {
      add({ id: 'resolution', status: 'warn', label: 'Sharpness', message: `This will print a little soft at this size (${dpi} dots per inch). It is usable, but a larger file will look better.` });
    } else {
      add({ id: 'resolution', status: 'stop', label: 'Sharpness', message: `This will print blurry at this size (${dpi} dots per inch). Upload a larger file, or let us fix it for you.` });
    }
    const diff = aspectDifference(facts.widthPx, facts.heightPx, pw, ph);
    add(
      diff <= SHAPE_TOLERANCE
        ? { id: 'shape', status: 'pass', label: 'Shape', message: 'Your picture is the right shape for the print area.' }
        : { id: 'shape', status: 'warn', label: 'Shape', message: 'Your picture is a different shape from the print area, so the edges will be trimmed. Check the preview to see what stays.' },
    );
  } else {
    add({ id: 'read', status: 'stop', label: 'Reading the file', message: 'We could not read this file. Try saving it again as a JPG, PNG or PDF.' });
    return stopNow();
  }

  const headline =
    status === 'pass'
      ? 'Your file looks sharp. Ready to print.'
      : status === 'warn'
        ? 'Your file will print, with a note.'
        : (lines.find((l) => l.status === 'stop')?.message ?? 'There is a problem with this file.');
  return { status, dpi, lines, headline };
}

/**
 * For picture frames: the largest size this photo will print sharp at.
 * Returns null when even the smallest size is too soft.
 */
export function recommendSize(sizes: SizeOption[], widthPx: number, heightPx: number, minDpi: number): SizeOption | null {
  let best: SizeOption | null = null;
  for (const s of sizes) {
    if (effectiveDpi(widthPx, heightPx, s.w_in, s.h_in) >= minDpi) {
      if (!best || s.w_in * s.h_in > best.w_in * best.h_in) best = s;
    }
  }
  return best;
}
