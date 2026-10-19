import { listProducts, getRules } from './catalog';
import { getSettings } from './settings';
import { runPriceTest, type PriceTestReport } from './priceTest';

/** Run the price test on the live products (all of them, or one by its web name). Reads the database; changes nothing. */
export async function runPriceTests(slug?: string): Promise<PriceTestReport[]> {
  const products = (await listProducts(true)).filter((p) => !p.sample && (!slug || p.slug === slug));
  const target = Number((await getSettings()).target_margin_pct) || 40;
  const out: PriceTestReport[] = [];
  for (const p of products) {
    const { price } = await getRules(p.id);
    out.push(runPriceTest({ product: p, rules: price, targetMarginPct: target }));
  }
  return out;
}

const ICON = { pass: '✓', warn: '!', fail: '✗', info: 'i' } as const;

/** Plain text for the command line. */
export function formatPriceTests(reports: PriceTestReport[], opts: { quiet?: boolean } = {}): string {
  const lines: string[] = [];
  for (const r of reports) {
    lines.push(`${r.ok ? '✓' : '✗'} ${r.name}  (${r.scenarios} prices tried: ${r.pass} passed, ${r.warn} to look at, ${r.fail} failed)`);
    for (const c of r.checks) {
      if (opts.quiet && (c.status === 'pass' || c.status === 'info')) continue;
      lines.push(`    ${ICON[c.status]} ${c.label}${c.status === 'pass' ? '' : `: ${c.detail}`}`);
      for (const e of c.examples) lines.push(`        - ${e}`);
    }
  }
  const failed = reports.filter((r) => !r.ok).length;
  lines.push('', failed ? `${failed} of ${reports.length} products failed the price test.` : `All ${reports.length} products passed the price test.`);
  return lines.join('\n');
}
