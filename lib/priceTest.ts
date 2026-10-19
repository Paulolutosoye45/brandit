import { MAX_QUANTITY, PriceError, allowsCustom, stepsFor, type PriceRule } from './pricing';
import { availabilityFor, fromPrice, ladderFor, packagePrices, priceConfigured, type EngineInput, type EngineProduct, type Priced } from './priceEngine';
import { kindOf, resolveSelection, ruleConfig, sellable } from './options';
import type { Product } from './types';

/*
 * The price test: ask the site for the price of everything a customer could pick, the way a customer would, and check the
 * answers hang together. It never touches the database, so the same test runs in the console ("Test this product"), on
 * the command line before a release, and in the automatic tests.
 *
 * What it can tell you: a choice that is on sale but cannot be priced; a price that goes down when a customer adds something;
 * a bigger order that costs more per piece; lines that do not add up to the total; a package that is not on offer;
 * combinations that have no price; add-ons still waiting for a price; and prices below your target margin or below cost.
 * What it cannot tell you: whether the prices are the right ones. That is yours to decide.
 */

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info';
export type Check = { id: string; label: string; status: CheckStatus; detail: string; examples: string[] };
export type PriceTestReport = {
  slug: string;
  name: string;
  checks: Check[];
  scenarios: number;
  pass: number;
  warn: number;
  fail: number;
  /** No failures. Warnings are things to look at, not reasons to stop. */
  ok: boolean;
};

export type PriceTestInput = {
  product: Pick<Product, 'slug' | 'name' | 'pricing_mode' | 'options' | 'sizes' | 'packages' | 'qty_custom' | 'qty_min' | 'qty_max'>;
  rules: PriceRule[];
  /** Margin below this percentage is flagged. */
  targetMarginPct?: number;
};

const naira = (k: number) => `₦${(k / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const MAX_EXAMPLES = 6;

class Collector {
  checks: Check[] = [];
  scenarios = 0;
  add(id: string, label: string, bad: string[], opts: { passText: string; failText?: string; status?: 'fail' | 'warn' | 'info' }) {
    if (!bad.length) this.checks.push({ id, label, status: 'pass', detail: opts.passText, examples: [] });
    else this.checks.push({ id, label, status: opts.status ?? 'fail', detail: opts.failText ?? `${bad.length} found`, examples: bad.slice(0, MAX_EXAMPLES) });
  }
}

/** The price of one scenario, or the reason it could not be priced. */
function tryPrice(product: EngineProduct, rules: PriceRule[], input: EngineInput): { p: Priced } | { err: string } {
  try {
    return { p: priceConfigured(product, rules, input) };
  } catch (e) {
    if (e instanceof PriceError) return { err: e.message };
    throw e;
  }
}

const describe = (input: EngineInput) =>
  [input.sizeKey, ...Object.entries(input.config ?? {}).map(([k, v]) => `${k}=${v}`)].filter(Boolean).join(', ') || 'default choices';

/** Sum of the lines in a priced result; the total can only differ when the shop's own discount clamped it at zero. */
const linesAdd = (p: Priced) => p.lines.reduce((a, l) => a + l.kobo, 0) === p.totalKobo || p.totalKobo === 0;

export function runPriceTest(input: PriceTestInput): PriceTestReport {
  const { product, rules } = input;
  const target = input.targetMarginPct ?? 40;
  const out = new Collector();
  const tier = product.pricing_mode === 'tier';
  const live = rules.filter((r) => r.active);

  const base = (qty: number, extra: Partial<EngineInput> = {}): EngineInput => ({
    quantity: qty,
    config: {},
    widthFt: product.pricing_mode === 'area' ? 6 : undefined,
    heightFt: product.pricing_mode === 'area' ? 3 : undefined,
    ...extra,
  });

  // ---- Is there anything for sale? ----
  const sizeKeys = product.pricing_mode === 'size' ? product.sizes.map((s) => s.key) : [null];
  const defSel = resolveSelection(product.options, { config: {}, sizeKey: sizeKeys[0], quantity: 1 });
  const defTable = ruleConfig(defSel.active, defSel.effective);
  const steps = tier ? stepsFor(live, defTable) : [];
  const startQty = tier ? (steps[0]?.quantity ?? 1) : 1;

  const hasPrice = live.some((r) => r.price_kobo != null || r.rate_per_sqft_kobo != null);
  out.add('for-sale', 'Something is for sale', hasPrice ? [] : ['There is not a single price for this product yet.'], { passText: `${live.length} price${live.length === 1 ? '' : 's'} entered.`, failText: 'Customers would see "Ask for a price".' });
  if (!hasPrice) return finish(product, out);

  // ---- 1. The default choices, at every size and every quantity step ----
  const defaultBad: string[] = [];
  const results: { name: string; input: EngineInput; p: Priced }[] = [];
  for (const sk of sizeKeys) {
    const sel = resolveSelection(product.options, { config: {}, sizeKey: sk, quantity: 1 });
    const stepsHere = tier ? stepsFor(live, ruleConfig(sel.active, sel.effective)) : [];
    const qtys = tier ? (stepsHere.length ? stepsHere.map((s) => s.quantity) : [1]) : [1];
    for (const q of qtys) {
      const inp = base(q, { sizeKey: sk });
      out.scenarios++;
      const r = tryPrice(product, rules, inp);
      if ('err' in r) {
        // A size with no price is allowed to be unpriced in size mode; it is reported under coverage instead.
        if (product.pricing_mode === 'size') continue;
        defaultBad.push(`${q} pieces: ${r.err}`);
      } else {
        results.push({ name: `${describe(inp)} × ${q}`, input: inp, p: r.p });
        if (!(r.p.totalKobo > 0)) defaultBad.push(`${q} pieces cost nothing`);
      }
    }
  }
  out.add('default', 'The default choices have a price', defaultBad, { passText: tier ? `Every quantity step prices (${steps.map((s) => s.quantity).join(', ')}).` : 'Priced.', failText: 'The first thing a customer sees cannot be priced.' });

  // ---- 2. Steps get cheaper per piece and never dearer in total ----
  if (tier && steps.length > 1) {
    const bad: string[] = [];
    const ladder = ladderFor(product, rules, base(startQty));
    for (let i = 1; i < ladder.length; i++) {
      const a = ladder[i - 1];
      const b = ladder[i];
      if (b.totalKobo < a.totalKobo) bad.push(`${b.quantity} costs ${naira(b.totalKobo)}, less than ${a.quantity} at ${naira(a.totalKobo)}`);
      else if (b.unitKobo > a.unitKobo) bad.push(`${b.quantity} is ${naira(b.unitKobo)} each, dearer per piece than ${a.quantity} at ${naira(a.unitKobo)}`);
    }
    out.add('ladder', 'A bigger order is never dearer per piece', bad, { passText: 'The quantity ladder only goes down.', failText: 'The quantity steps do not make sense together.', status: 'warn' });
    if (ladder.some((s, i) => i > 0 && s.totalKobo < ladder[i - 1].totalKobo)) {
      out.checks[out.checks.length - 1].status = 'fail';
    }
  }

  // ---- 3. A quantity between the steps, and past the last one ----
  if (tier && product.qty_custom && allowsCustom(steps)) {
    const bad: string[] = [];
    const probes: number[] = [];
    for (let i = 0; i + 1 < steps.length; i++) {
      const mid = Math.floor((steps[i].quantity + steps[i + 1].quantity) / 2);
      if (mid > steps[i].quantity && mid < steps[i + 1].quantity) probes.push(mid);
    }
    const last = steps[steps.length - 1].quantity;
    const max = Math.min(product.qty_max ?? MAX_QUANTITY, MAX_QUANTITY);
    if (max > last) probes.push(Math.min(max, last + Math.max(1, Math.round(last / 2))));
    for (const q of probes) {
      out.scenarios++;
      const r = tryPrice(product, rules, base(q));
      if ('err' in r) { bad.push(`${q}: ${r.err}`); continue; }
      // The table can change with the quantity ("Best for your quantity" moves to screen print), so compare with the one in force at q.
      const here = resolveSelection(product.options, { config: {}, sizeKey: null, quantity: q });
      const table = stepsFor(live, ruleConfig(here.active, here.effective));
      const below = [...table].reverse().find((s) => s.quantity < q);
      const above = table.find((s) => s.quantity > q);
      if (below && r.p.totalKobo < (below.rule.price_kobo ?? 0)) bad.push(`${q} costs less than the ${below.quantity} step`);
      if (above && r.p.totalKobo > (above.rule.price_kobo ?? Infinity)) bad.push(`${q} costs more than the ${above.quantity} step`);
    }
    out.add('between', 'Quantities between the steps price sensibly', bad, { passText: probes.length ? `Checked ${probes.join(', ')}.` : 'No gaps to check.', failText: 'A custom quantity gives a surprising price.' });
  }

  // ---- 4. Every choice on sale, changed one at a time from the default ----
  const choiceBad: string[] = [];
  const downBad: string[] = [];
  const sumBad: string[] = [];
  const greyBad: string[] = [];
  for (const sk of sizeKeys.slice(0, 1)) {
    const probe = base(startQty, { sizeKey: sk });
    const baseResult = tryPrice(product, rules, probe);
    if ('err' in baseResult) continue;
    const av = availabilityFor(product, rules, probe);
    const sel = resolveSelection(product.options, { config: {}, sizeKey: sk, quantity: startQty });
    for (const o of sel.active) {
      if (kindOf(o) === 'split') continue;
      for (const c of o.choices) {
        const st = av.choices[o.key]?.[c.value];
        if (!st || st.hide || !sellable(c)) continue;
        if (!st.ok) { if (!st.why) greyBad.push(`${o.label}: ${c.label} is greyed out with no reason`); continue; }
        if (c.value === 'auto') continue;
        const current = baseResult.p.config[o.key];
        const asked = kindOf(o) === 'tick' ? ((current ?? '').split(',').includes(c.value) ? '' : c.value) : c.value;
        if (kindOf(o) === 'pick' && current === c.value) continue;
        const inp = base(startQty, { sizeKey: sk, config: { [o.key]: asked } });
        out.scenarios++;
        const r = tryPrice(product, rules, inp);
        if ('err' in r) { choiceBad.push(`${o.label}: ${c.label}: ${r.err}`); continue; }
        if (!linesAdd(r.p)) sumBad.push(`${o.label}: ${c.label}`);
        if (r.p.notes.length) { choiceBad.push(`${o.label}: ${c.label}: changed other choices (${r.p.notes[0]})`); continue; }
        const raises = (c.extra_kobo ?? 0) > 0 || (c.setup_kobo ?? 0) > 0 || (c.percent ?? 0) > 0;
        if (raises && r.p.totalKobo < baseResult.p.totalKobo && kindOf(o) !== 'pick') downBad.push(`${o.label}: ${c.label} makes it cheaper (${naira(r.p.totalKobo)} against ${naira(baseResult.p.totalKobo)})`);
        results.push({ name: `${o.label}: ${c.label}`, input: inp, p: r.p });
      }
    }
  }
  out.add('choices', 'Every choice on sale can be priced', choiceBad, { passText: 'Each one was added to the default and priced.', failText: 'A customer could pick these and not get a price.' });
  out.add('lines', 'The lines add up to the total', sumBad, { passText: 'Every breakdown adds up.', failText: 'The "what makes up this price" panel would not match the total.' });
  out.add('add-ons', 'Adding something never makes it cheaper', downBad, { passText: 'Add-ons only add.', failText: 'An add-on with a price lowers the total.', status: 'warn' });
  out.add('greyed', 'Every greyed-out choice says why', greyBad, { passText: 'Greyed-out choices all carry a reason.', failText: 'A choice is greyed out and the customer is not told why.' });

  // ---- 5. Packages ----
  if ((product.packages ?? []).length) {
    const offered = packagePrices(product, rules, base(startQty));
    const missing = product.packages.filter((p) => !offered.some((o) => o.key === p.key)).map((p) => `${p.label} is not offered right now (it needs a choice that is off, unpriced or not allowed together)`);
    const bad: string[] = [];
    for (const o of offered) if (!(o.totalKobo > 0)) bad.push(`${o.label} costs nothing`);
    for (let i = 1; i < offered.length; i++) if (offered[i].totalKobo < offered[i - 1].totalKobo) bad.push(`${offered[i].label} is cheaper than ${offered[i - 1].label}`);
    out.add('packages', 'Packages are offered and rise in price', bad, { passText: `${offered.map((o) => o.label).join(', ') || 'None'} on offer.`, failText: 'The packages do not make sense side by side.', status: 'warn' });
    out.checks.push(
      missing.length
        ? { id: 'packages-missing', label: 'Packages not on offer', status: 'info', detail: `${missing.length} waiting`, examples: missing.slice(0, MAX_EXAMPLES) }
        : { id: 'packages-missing', label: 'Packages not on offer', status: 'pass', detail: 'All packages are on offer.', examples: [] },
    );
  }

  // ---- 6. Coverage: combinations a customer can reach that have no price ----
  const drivers = product.options.filter((o) => o.drives && kindOf(o) === 'pick');
  if (drivers.length && tier) {
    const holes: string[] = [];
    let combos: Record<string, string>[] = [{}];
    for (const o of drivers) combos = combos.flatMap((c) => o.choices.filter((x) => sellable(x) && x.value !== 'auto').map((x) => ({ ...c, [o.key]: x.value })));
    combos = combos.slice(0, 600);
    const seen = new Set<string>();
    for (const cfg of combos) {
      const sel = resolveSelection(product.options, { config: cfg, sizeKey: null, quantity: startQty });
      if (sel.notes.length) continue; // not a combination the shop allows
      const tableCfg = ruleConfig(sel.active, sel.effective);
      const key = JSON.stringify(Object.entries(tableCfg).filter(([k]) => drivers.some((d) => d.key === k)).sort());
      if (seen.has(key)) continue;
      seen.add(key);
      out.scenarios++;
      if (!stepsFor(live, tableCfg).length) holes.push(drivers.filter((d) => cfg[d.key] !== undefined).map((d) => d.choices.find((c) => c.value === cfg[d.key])?.label ?? cfg[d.key]).join(' + '));
    }
    out.add('coverage', 'Every combination has a price table', holes, { passText: `${seen.size} combinations checked.`, failText: `${holes.length} of ${seen.size} combinations have no prices (customers are told they are not offered)`, status: 'info' });
  }

  // ---- 7. Add-ons still waiting for a price ----
  const waiting: string[] = [];
  for (const o of product.options) for (const c of o.choices) if (c.unpriced) waiting.push(`${o.label}: ${c.label}`);
  out.add('waiting', 'No add-on is waiting for a price', waiting, { passText: 'Every add-on has a price or is switched off on purpose.', failText: `${waiting.length} add-on${waiting.length === 1 ? ' is' : 's are'} off the shop until you set a price`, status: 'info' });

  // ---- 8. Margins ----
  const withCost = results.filter((r) => r.p.costKobo != null);
  if (withCost.length) {
    const loss = withCost.filter((r) => r.p.totalKobo < (r.p.costKobo as number)).map((r) => `${r.name}: sells for ${naira(r.p.totalKobo)}, costs ${naira(r.p.costKobo as number)}`);
    out.add('loss', 'Nothing sells below cost', loss, { passText: `${withCost.length} scenarios with a cost checked.`, failText: 'These would lose money on every order.' });
    const thin = withCost.filter((r) => r.p.totalKobo >= (r.p.costKobo as number) && ((r.p.totalKobo - (r.p.costKobo as number)) / r.p.totalKobo) * 100 < target).map((r) => `${r.name}: ${Math.round(((r.p.totalKobo - (r.p.costKobo as number)) / r.p.totalKobo) * 100)}% margin`);
    out.add('margin', `Margins reach ${target}%`, thin, { passText: `All ${withCost.length} are at or above ${target}%.`, failText: `${thin.length} below ${target}%`, status: 'warn' });
  } else {
    out.checks.push({ id: 'margin', label: 'Margins', status: 'info', detail: 'No costs entered yet, so margins cannot be checked.', examples: [] });
  }

  // ---- 9. Whole kobo, and the "From" price ----
  const frac = results.filter((r) => !Number.isInteger(r.p.totalKobo)).map((r) => r.name);
  out.add('whole', 'Prices are whole amounts', frac, { passText: 'No fractions of a kobo.', failText: 'A total has a fraction of a kobo.' });

  const from = fromPrice(product as Pick<Product, 'pricing_mode' | 'options'>, rules);
  const fromBad: string[] = [];
  if (product.pricing_mode === 'area') {
    if (from.ratePerSqft == null) fromBad.push('No "from" rate');
  } else {
    if (from.kobo == null) fromBad.push('No "from" price');
    else {
      const cheapest = Math.min(...results.filter((r) => !r.name.includes(':')).map((r) => r.p.totalKobo));
      if (Number.isFinite(cheapest) && from.kobo > cheapest) fromBad.push(`"From ${naira(from.kobo)}" is more than the default price of ${naira(cheapest)}`);
    }
  }
  out.add('from', 'The "From" price is honest', fromBad, { passText: product.pricing_mode === 'area' ? `From ${naira(from.ratePerSqft ?? 0)} per sq ft.` : `From ${naira(from.kobo ?? 0)}.`, failText: 'The catalogue would promise a price nobody can buy at.' });

  return finish(product, out);
}

function finish(product: { slug: string; name: string }, out: Collector): PriceTestReport {
  const count = (s: CheckStatus) => out.checks.filter((c) => c.status === s).length;
  return { slug: product.slug, name: product.name, checks: out.checks, scenarios: out.scenarios, pass: count('pass'), warn: count('warn'), fail: count('fail'), ok: count('fail') === 0 };
}
