/*
 * The picture makers Studio can call. Everything vendor-specific lives in this folder. The rest of Studio only knows
 * "an engine" that takes a plain-English art brief and returns pixels, plus what the call cost.
 */
export type Vendor = 'recraft' | 'bfl' | 'google' | 'openai' | 'fal' | 'local' | 'fake';
export type EngineId = 'recraft-flash' | 'recraft' | 'recraft-pro' | 'flux' | 'nano-banana' | 'gpt-image';

export type EngineDef = {
  id: EngineId;
  vendor: Vendor;
  label: string;
  /** The vendor's model name. Overridable in settings (studio_models) so a rename at the vendor is not a deploy. */
  model: string;
  /** US dollars per picture. Overridable in settings (studio_price_overrides). */
  usd: number;
  /** Sizes the vendor accepts, when it only accepts a list. */
  sizes?: [number, number][];
  /** Longest side to ask for when the vendor takes any size. */
  longSide?: number;
};

export type GenIn = {
  prompt: string;
  negative: string;
  /** width / height of the print. */
  aspect: number;
  seed: number;
  /** Only the built-in demo engine reads this, to draw something in the right colours. */
  hint?: { palette: string[]; style: string };
};
export type Raw = { image: Buffer; mime: string };

export class EngineError extends Error {
  constructor(message: string, public retryable = true, public userMessage = 'The picture maker did not answer. Please try again in a moment.') {
    super(message);
  }
}
/** The monthly vendor budget or the daily free ceiling stopped this call. */
export class PausedError extends Error {
  constructor(public reason: 'sketches' | 'all' | 'ceiling' | 'off' | 'none', message: string) {
    super(message);
  }
}

export const closestSize = (sizes: [number, number][], aspect: number): [number, number] =>
  sizes.reduce((best, s) => (Math.abs(Math.log(s[0] / s[1] / aspect)) < Math.abs(Math.log(best[0] / best[1] / aspect)) ? s : best), sizes[0]);

/** Any size with the given aspect, the long side at most `long`, both sides a multiple of `step`. */
export function sizeFor(aspect: number, long: number, step = 32, min = 256): [number, number] {
  const r = (v: number) => Math.max(min, Math.round(v / step) * step);
  return aspect >= 1 ? [r(long), r(long / aspect)] : [r(long * aspect), r(long)];
}
