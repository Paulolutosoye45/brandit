import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const src = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');

// Next.js bundles instrumentation.ts twice, for Node and for Edge. If the Node-only database code is reachable from
// the Edge copy, `npm run dev` fails on every page with "Module not found: Can't resolve 'fs'".
// Production builds did not show it, so only a dev run (or this test) catches it.
describe('the startup hook', () => {
  it('reaches Node-only code only inside a plain NEXT_RUNTIME === "nodejs" check', () => {
    const s = src('instrumentation.ts');
    expect(s).toMatch(/if \(process\.env\.NEXT_RUNTIME === 'nodejs'\) \{[\s\S]*import\('\.\/instrumentation-node'\)/);
    expect(s, 'a static import would be bundled into the Edge copy').not.toMatch(/^import /m);
    expect(s, 'the hook must not name lib/ directly').not.toMatch(/lib\//);
  });

  it('keeps the work, and so the database driver, in instrumentation-node.ts', () => {
    const n = src('instrumentation-node.ts');
    expect(n).toContain("from './lib/startup'");
    expect(n).toContain('phase-production-build');   // never open the database while `next build` runs
  });
});
