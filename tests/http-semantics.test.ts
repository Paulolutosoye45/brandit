import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
function find(dir: string, name: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) find(p, name, out);
    else if (e.name === name) out.push(path.relative(root, p));
  }
  return out;
}

// Next.js cannot send a redirect or a 404 status once a loading screen has started streaming. It sends 200
// and redirects in the browser instead. Pages that sign people out, turn away the wrong staff role or say
// "not found" must answer with the real HTTP status, so crawlers, uptime monitors and security checks see the truth.
describe('pages that redirect or 404 keep their real HTTP status', () => {
  it('has no loading.tsx anywhere in the customer site, the sign-in screens or the console', () => {
    const found = ['app/(site)', 'app/(auth)', 'app/(console)'].flatMap((d) => find(path.join(root, d), 'loading.tsx'));
    expect(found, 'a loading.tsx turns redirects and 404s into HTTP 200').toEqual([]);
  });
});
