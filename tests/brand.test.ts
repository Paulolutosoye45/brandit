import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');

/** Width and height of a PNG, read from its header. */
function pngSize(file: string): { w: number; h: number; alpha: boolean } {
  const b = fs.readFileSync(path.join(root, file));
  expect(b.subarray(0, 8).toString('hex'), `${file} is a PNG`).toBe('89504e470d0a1a0a');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), alpha: b[25] === 6 || b[25] === 4 };
}

describe('approved logo files', () => {
  const sets = ['logo', 'logo-horizontal', 'mark', 'wordmark'];
  it('ships every variant, on light and on dark, with a transparent background', () => {
    for (const n of sets) {
      for (const f of [`public/brand/${n}.png`, `public/brand/${n}-on-dark.png`]) {
        const s = pngSize(f);
        expect(s.alpha, `${f} keeps its transparency`).toBe(true);
        expect(s.w, f).toBeGreaterThan(300);
      }
    }
  });
  it('keeps the master, and the sizes the Logo component promises', () => {
    expect(pngSize('public/brand/logo-original.png')).toMatchObject({ w: 1775, h: 1538 });
    const src = fs.readFileSync(path.join(root, 'components/Logo.tsx'), 'utf8');
    for (const [name, key] of [['logo-horizontal', 'full'], ['logo', 'stacked'], ['mark', 'mark'], ['wordmark', 'wordmark']] as const) {
      const s = pngSize(`public/brand/${name}.png`);
      expect(src, `${key} declares ${s.w}x${s.h}`).toContain(`${key}: { name: '${name}', w: ${s.w}, h: ${s.h} }`);
    }
  });
  it('ships every icon the web app manifest and the browser look for', () => {
    for (const f of ['public/icons/icon-192.png', 'public/icons/icon-512.png', 'public/icons/maskable-512.png', 'app/apple-icon.png', 'app/icon.png', 'app/favicon.ico', 'app/opengraph-image.png', 'app/twitter-image.png']) {
      expect(fs.existsSync(path.join(root, f)), f).toBe(true);
    }
    expect(pngSize('public/icons/icon-512.png')).toMatchObject({ w: 512, h: 512 });
    expect(pngSize('app/opengraph-image.png')).toMatchObject({ w: 1200, h: 630 });
  });
  it('leaves no old, redrawn logo behind', () => {
    for (const f of ['lib/brandGeometry.ts', 'app/icon.svg', 'public/brand/logo.svg', 'public/brand/mark.svg', 'public/brand/wordmark.svg']) {
      expect(fs.existsSync(path.join(root, f)), `${f} should be gone`).toBe(false);
    }
  });
  it('uses the approved tagline', () => {
    const files = ['components/SiteChrome.tsx', 'lib/email.ts', 'app/(auth)/layout.tsx', 'app/opengraph-image.alt.txt'];
    for (const f of files) {
      const t = fs.readFileSync(path.join(root, f), 'utf8');
      expect(t, f).not.toContain('Printed right. Right on time.');
      expect(t, f).toContain('Printing without the hassle.');
    }
  });
});
