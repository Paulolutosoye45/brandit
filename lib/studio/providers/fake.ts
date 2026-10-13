import sharp from 'sharp';
import type { GenIn, Raw } from './types';

/*
 * A stand-in picture maker for demos and tests. It draws patterned backgrounds in the chosen colours so the whole
 * Studio flow can be tried with no vendor account and no cost. It exists only in demo mode (see engine.ts).
 */
const rng = (seed: number) => { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];

export async function fakeGenerate(i: GenIn, long = 1024): Promise<Raw> {
  const r = rng(i.seed * 2654435761);
  const w = i.aspect >= 1 ? long : Math.round(long * i.aspect), h = i.aspect >= 1 ? Math.round(long / i.aspect) : long;
  const pal = i.hint?.palette?.length ? i.hint.palette : ['#12307A', '#E8B931', '#FFF6DA'];
  const [c1, c2, c3] = [pal[0], pal[1] ?? pal[0], pal[2] ?? '#ffffff'];
  const style = i.hint?.style ?? 'ankara';
  const u = Math.min(w, h);
  let shapes = '';
  const circle = (x: number, y: number, rad: number, fill: string, op = 1) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad.toFixed(1)}" fill="${fill}" fill-opacity="${op}"/>`;
  if (style === 'ankara' || style === 'bold-pop' || style === 'earthy') {
    const step = u / (5 + Math.floor(r() * 3));
    for (let y = 0; y < h + step; y += step) for (let x = 0; x < w + step; x += step) {
      const ox = (Math.round(y / step) % 2) * step / 2;
      const cx = x + ox, rad = step * 0.42;
      shapes += circle(cx, y, rad, c2, 0.9) + circle(cx, y, rad * 0.7, c1, 0.95) + circle(cx, y, rad * 0.36, c3, 0.95) + circle(cx, y, rad * 0.14, c2, 1);
    }
  } else if (style === 'aso-oke') {
    const bands = 14; const bh = h / bands;
    for (let b = 0; b < bands; b++) shapes += `<rect x="0" y="${(b * bh).toFixed(1)}" width="${w}" height="${(bh * (0.2 + r() * 0.5)).toFixed(1)}" fill="${pick(r, [c2, c3, c1])}" fill-opacity="0.75"/>`;
  } else if (style === 'adire') {
    for (let k = 0; k < 70; k++) shapes += `<circle cx="${(r() * w).toFixed(0)}" cy="${(r() * h).toFixed(0)}" r="${(u * (0.01 + r() * 0.05)).toFixed(0)}" fill="none" stroke="${c3}" stroke-width="${(u * 0.006).toFixed(1)}" stroke-opacity="0.75"/>`;
  } else if (style === 'floral') {
    for (let k = 0; k < 18; k++) {
      const x = r() * w, y = r() * h, s = u * (0.05 + r() * 0.09);
      for (let p = 0; p < 6; p++) { const a = (p / 6) * Math.PI * 2; shapes += circle(x + Math.cos(a) * s, y + Math.sin(a) * s, s * 0.7, p % 2 ? c2 : c3, 0.55); }
      shapes += circle(x, y, s * 0.5, c1, 0.9);
    }
  } else if (style === 'lagos-skyline') {
    for (let k = 0; k < 14; k++) { const bw = w / 14, bh = h * (0.12 + r() * 0.3); shapes += `<rect x="${(k * bw).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(bw * 0.9).toFixed(1)}" height="${bh.toFixed(1)}" fill="${c1}" fill-opacity="0.85"/>`; }
    shapes += circle(w * 0.7, h * 0.3, u * 0.14, c2, 0.9);
  } else {
    for (let k = 0; k < 24; k++) shapes += circle(r() * w, r() * h, u * (0.03 + r() * 0.13), pick(r, [c2, c3, c1]), 0.2 + r() * 0.3);
  }
  const ang = Math.floor(r() * 360);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" gradientTransform="rotate(${ang} .5 .5)"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${shapes}</svg>`;
  return { image: await sharp(Buffer.from(svg)).png().toBuffer(), mime: 'image/png' };
}

/** A made-up SVG of the art, for the vector add-on in demos. */
export function fakeVector(w: number, h: number, palette: string[]): string {
  const [a, b, c] = [palette[0] ?? '#12307A', palette[1] ?? '#E8B931', palette[2] ?? '#FFF6DA'];
  let s = '';
  for (let k = 0; k < 12; k++) s += `<circle cx="${(w * ((k * 37) % 100)) / 100}" cy="${(h * ((k * 53) % 100)) / 100}" r="${Math.min(w, h) * (0.04 + (k % 4) * 0.02)}" fill="${k % 2 ? b : c}" fill-opacity="0.8"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${a}"/>${s}</svg>`;
}
