import { getProduct } from '../catalog';
import { getSettings } from '../settings';
import { printDims } from '../quote';
import { effectiveDpi } from '../accuracy';
import type { CheckClass, Product, SizeOption } from '../types';

/*
 * The print spec of a Studio design: how big the product prints, how many pixels the file needs at the pass level the
 * platform already uses (300 dpi for print products, 200 for photo products, 100 for large format), and which tier is
 * guaranteed for it. One source of truth for the brief builder, the compositor and the check gate.
 */
export type Shape = 'rect' | 'round';
export type Spec = {
  slug: string;
  productName: string;
  sizeKey: string | null;
  widthFt: number | null;
  heightFt: number | null;
  printWIn: number;
  printHIn: number;
  cls: CheckClass;
  passDpi: number;
  warnDpi: number;
  /** Pixels at the pass level. */
  w: number;
  h: number;
  mp: number;
  shape: Shape;
  /** Larger than Standard is guaranteed for. */
  needsPremium: boolean;
  label: string;
};
export type SpecError = { error: string };

/** The biggest file Studio builds. Beyond this a person should design it (a custom order). */
export const MAX_MEGAPIXELS = 64;

const inch = (n: number) => `${+n.toFixed(2)}`;

export function buildSpec(p: Product, i: { sizeKey?: string | null; widthFt?: number | null; heightFt?: number | null }, s: { check_thresholds: Record<CheckClass, { pass: number; warn: number }>; studio_standard_max_mp: number }): Spec | SpecError {
  const sizeKey = p.pricing_mode === 'size' ? (p.sizes.some((x) => x.key === i.sizeKey) ? (i.sizeKey as string) : (p.sizes[0]?.key ?? null)) : null;
  const dims = printDims(p, sizeKey, i.widthFt ?? undefined, i.heightFt ?? undefined);
  if (!dims) return { error: p.pricing_mode === 'area' ? 'Enter the width and height of your banner in feet.' : 'We could not work out the print size for this product.' };
  const t = s.check_thresholds[p.check_class];
  const w = Math.round(dims.w * t.pass);
  const h = Math.round(dims.h * t.pass);
  const mp = (w * h) / 1_000_000;
  if (mp > MAX_MEGAPIXELS) return { error: 'This size is bigger than Studio builds files for. Ask for a custom price and a Brandit designer will make it.' };
  const sizeLabel = sizeKey ? (p.sizes.find((x: SizeOption) => x.key === sizeKey)?.label ?? '') : '';
  return {
    slug: p.slug,
    productName: p.name,
    sizeKey,
    widthFt: p.pricing_mode === 'area' ? (i.widthFt ?? null) : null,
    heightFt: p.pricing_mode === 'area' ? (i.heightFt ?? null) : null,
    printWIn: dims.w,
    printHIn: dims.h,
    cls: p.check_class,
    passDpi: t.pass,
    warnDpi: t.warn,
    w, h, mp,
    shape: p.slug === 'stickers' ? 'round' : 'rect',
    needsPremium: mp > s.studio_standard_max_mp,
    label: `${p.name}, ${sizeLabel && p.sizes.length > 1 ? sizeLabel : `${inch(dims.w)} × ${inch(dims.h)} in`}`,
  };
}

export async function specFor(i: { slug: string; sizeKey?: string | null; widthFt?: number | null; heightFt?: number | null }): Promise<Spec | SpecError> {
  const p = await getProduct(i.slug);
  if (!p || !p.active) return { error: 'We could not find that product.' };
  const s = await getSettings();
  return buildSpec(p, i, s);
}
export const isSpecError = (x: Spec | SpecError): x is SpecError => 'error' in x;

/** The shape of the print, for choosing a layout. */
export type Preset = 'poster' | 'wide' | 'tall' | 'square' | 'round' | 'card' | 'id' | 'frame' | 'shirt';
export function presetFor(spec: Pick<Spec, 'slug' | 'printWIn' | 'printHIn' | 'shape'>): Preset {
  if (spec.slug === 'id-cards') return 'id';
  if (spec.slug === 'business-cards') return 'card';
  if (spec.slug === 'picture-frames') return 'frame';
  if (spec.slug === 'tees-and-totes' || spec.slug === 'branded-t-shirts') return 'shirt';
  if (spec.shape === 'round') return 'round';
  const r = spec.printWIn / spec.printHIn;
  if (r >= 1.25) return 'wide';
  if (r <= 0.55) return 'tall';
  if (r >= 0.85 && r <= 1.18) return 'square';
  return 'poster';
}

/** Sizes of this product that a source picture of this many pixels can fill at the pass level. */
export function sizesThatPass(p: Product, srcW: number, srcH: number, passDpi: number): SizeOption[] {
  return p.sizes.filter((s) => effectiveDpi(srcW, srcH, s.w_in, s.h_in) >= passDpi);
}

/** The shape name used in the picture maker's instructions. */
export const orientationOf = (w: number, h: number): 'portrait' | 'landscape' | 'square' => (Math.abs(w - h) / Math.max(w, h) < 0.08 ? 'square' : w > h ? 'landscape' : 'portrait');
