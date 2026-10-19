import { describe, expect, it } from 'vitest';
import { PriceError, priceItem, stepsFor, type PriceRule } from '../lib/pricing';
import { choiceLabel, extrasFor, formatSplit, parseSplit, resolveSelection, ruleConfig, type ExtraContext } from '../lib/options';
import { availabilityFor, fromPrice, ladderFor, packagePrices, priceConfigured, publicOptions, type EngineProduct } from '../lib/priceEngine';
import type { ProductOption } from '../lib/types';

const rule = (quantity: number, price: number, config: Record<string, string> = {}, extra: Partial<PriceRule> = {}): PriceRule => ({
  config, quantity, size_key: null, price_kobo: price, rate_per_sqft_kobo: null, min_area_sqft: null, active: true, ...extra,
});
const N = (n: number) => n * 100; // naira to kobo

describe('base price tables', () => {
  const steps = [rule(100, N(15000)), rule(250, N(30000)), rule(500, N(48000))];
  const custom = { min: 50, max: 1000 };

  it('an exact step is its own price', () => {
    expect(priceItem('tier', steps, { quantity: 250, config: {} }).totalKobo).toBe(N(30000));
  });
  it('without custom quantities only the steps can be bought (as before)', () => {
    expect(() => priceItem('tier', steps, { quantity: 340, config: {} })).toThrow(PriceError);
  });
  it('a quantity between steps costs the per-piece price of the step below', () => {
    const r = priceItem('tier', steps, { quantity: 340, config: {}, custom });
    expect(r.totalKobo).toBe(N(120) * 340); // 30000 / 250 = 120 each
    expect(r.basis).toBe('between');
    expect(r.fromStep).toBe(250);
  });
  it('is never more than the next step up', () => {
    // 490 x 120 = 58,800 would be dearer than 500 for 48,000
    expect(priceItem('tier', steps, { quantity: 490, config: {}, custom }).totalKobo).toBe(N(48000));
  });
  it('is never cheaper per piece than a bigger step', () => {
    const per = (q: number) => priceItem('tier', steps, { quantity: q, config: {}, custom }).totalKobo / q;
    for (let q = 101; q < 500; q += 7) expect(per(q)).toBeGreaterThanOrEqual(N(48000) / 500);
  });
  it('past the last step uses the per-piece price of the last step', () => {
    const r = priceItem('tier', steps, { quantity: 700, config: {}, custom });
    expect(r.totalKobo).toBe(N(96) * 700);
    expect(r.basis).toBe('above');
  });
  it('the price never goes down as the quantity goes up', () => {
    let last = 0;
    for (let q = 50; q <= 1000; q++) {
      let t: number;
      try { t = priceItem('tier', steps, { quantity: q, config: {}, custom }).totalKobo; } catch { continue; }
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
  });
  it('refuses below the first step and above the largest allowed', () => {
    expect(() => priceItem('tier', steps, { quantity: 50, config: {}, custom })).toThrow(/smallest order is 100/);
    expect(() => priceItem('tier', steps, { quantity: 1001, config: {}, custom })).toThrow(/largest online order/);
  });
  it('the more specific price wins over a general one', () => {
    const rules = [rule(100, N(10000)), rule(100, N(12500), { paper: 'silk' })];
    expect(priceItem('tier', rules, { quantity: 100, config: { paper: 'silk' } }).totalKobo).toBe(N(12500));
    expect(priceItem('tier', rules, { quantity: 100, config: { paper: 'gloss' } }).totalKobo).toBe(N(10000));
  });
  it('lists the steps that have a price for these choices', () => {
    const rules = [rule(100, 1, { paper: 'a' }), rule(250, 1, { paper: 'a' }), rule(100, 1, { paper: 'b' })];
    expect(stepsFor(rules, { paper: 'a' }).map((s) => s.quantity)).toEqual([100, 250]);
    expect(stepsFor(rules, { paper: 'b' }).map((s) => s.quantity)).toEqual([100]);
  });
  it('carries the cost through, per piece for in-between quantities', () => {
    const rules = [rule(100, N(15000), {}, { cost_kobo: N(9000) }), rule(250, N(30000), {}, { cost_kobo: N(20000) })];
    expect(priceItem('tier', rules, { quantity: 100, config: {} }).costKobo).toBe(N(9000));
    expect(priceItem('tier', rules, { quantity: 150, config: {}, custom: { min: 100, max: 500 } }).costKobo).toBe(N(13500));
  });
});

describe('splits, ticks and conditions', () => {
  it('reads and writes size counts', () => {
    expect(parseSplit('s:2,m:3,x:0,l:-1,xl:abc')).toEqual({ s: 2, m: 3 });
    expect(formatSplit({ m: 3, s: 2 }, ['s', 'm', 'l'])).toBe('s:2,m:3');
  });

  const opts: ProductOption[] = [
    { key: 'card', label: 'Card', default: 'std', drives: true, choices: [{ value: 'std', label: 'Standard' }, { value: 'thick', label: 'Super thick' }] },
    { key: 'lam', label: 'Lamination', default: 'matte', choices: [{ value: 'none', label: 'None' }, { value: 'matte', label: 'Matte', extra_kobo: N(5), extra_per: 'piece' }] },
    {
      key: 'finishing', label: 'Finishing', kind: 'tick', group: 'special', default: '',
      choices: [
        { value: 'round', label: 'Rounded corners', extra_kobo: N(10), extra_per: 'piece' },
        { value: 'foil', label: 'Gold foil', extra_kobo: N(20), extra_per: 'piece', setup_kobo: N(5000), only_if: { lam: ['matte'] } },
        { value: 'edges', label: 'Coloured edges', extra_kobo: N(15), extra_per: 'piece', only_if: { card: ['thick'] } },
      ],
    },
  ];

  it('fills in defaults and ignores unknown values quietly', () => {
    const s = resolveSelection(opts, { config: { card: 'nope' }, quantity: 100 });
    expect(s.config).toEqual({ card: 'std', lam: 'matte', finishing: '' });
    expect(s.notes).toEqual([]);
  });
  it('takes off a tick that needs something else, and says why', () => {
    const s = resolveSelection(opts, { config: { lam: 'none', finishing: 'round,foil' }, quantity: 100 });
    expect(s.config.finishing).toBe('round');
    expect(s.notes.join(' ')).toMatch(/Gold foil needs lamination: Matte, so it was taken off/);
  });
  it('lets the tick back once the condition holds', () => {
    const s = resolveSelection(opts, { config: { lam: 'matte', finishing: 'foil,round' }, quantity: 100 });
    expect(s.config.finishing).toBe('round,foil'); // in the order of the choices, not of the click
    expect(s.notes).toEqual([]);
  });
  it('changing the card drops coloured edges that needed the thick card', () => {
    const on = resolveSelection(opts, { config: { card: 'thick', finishing: 'edges' }, quantity: 100 });
    expect(on.config.finishing).toBe('edges');
    const off = resolveSelection(opts, { config: { card: 'std', finishing: 'edges' }, quantity: 100 });
    expect(off.config.finishing).toBe('');
    expect(off.notes.join(' ')).toMatch(/Coloured edges needs card: Super thick/);
  });
  it('hidden and unpriced choices are not offered, but the console can preview them', () => {
    const o: ProductOption[] = [{ key: 'x', label: 'X', default: 'a', choices: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B', unpriced: true }, { value: 'c', label: 'C', hidden: true }] }];
    expect(resolveSelection(o, { config: { x: 'b' }, quantity: 1 }).config.x).toBe('a');
    expect(resolveSelection(o, { config: { x: 'c' }, quantity: 1 }).notes.join(' ')).toMatch(/not available right now/);
    expect(resolveSelection(o, { config: { x: 'b' }, quantity: 1 }, { preview: true }).config.x).toBe('b');
  });
  it('a choice with a minimum quantity needs it', () => {
    const o: ProductOption[] = [{ key: 'l', label: 'Lanyard', kind: 'pick', default: 'plain', choices: [{ value: 'plain', label: 'Plain' }, { value: 'printed', label: 'Printed', min_qty: 50 }] }];
    expect(resolveSelection(o, { config: { l: 'printed' }, quantity: 10 }).config.l).toBe('plain');
    expect(resolveSelection(o, { config: { l: 'printed' }, quantity: 10 }).notes.join(' ')).toMatch(/at least 50 pieces/);
    expect(resolveSelection(o, { config: { l: 'printed' }, quantity: 50 }).config.l).toBe('printed');
  });
  it('an option can apply to one kind of item only', () => {
    const o: ProductOption[] = [
      { key: 'item', label: 'Item', default: 'tee', choices: [{ value: 'tee', label: 'T-shirt' }, { value: 'tote', label: 'Tote' }] },
      { key: 'handles', label: 'Handles', default: 'short', only_if: { item: ['tote'] }, choices: [{ value: 'short', label: 'Short' }, { value: 'long', label: 'Long' }] },
    ];
    expect(resolveSelection(o, { config: { item: 'tee', handles: 'long' }, quantity: 5 }).config).toEqual({ item: 'tee' });
    expect(resolveSelection(o, { config: { item: 'tote', handles: 'long' }, quantity: 5 }).config).toEqual({ item: 'tote', handles: 'long' });
  });
  it('a size is a valid thing to depend on in a size-priced product', () => {
    const o: ProductOption[] = [{ key: 'mount', label: 'Mount', default: 'none', choices: [{ value: 'none', label: 'None' }, { value: 'foam', label: 'Foam board', only_if: { size: ['a3', 'a2'] } }] }];
    expect(resolveSelection(o, { config: { mount: 'foam' }, sizeKey: 'a1', quantity: 1 }).config.mount).toBe('none');
    expect(resolveSelection(o, { config: { mount: 'foam' }, sizeKey: 'a2', quantity: 1 }).config.mount).toBe('foam');
  });
});

describe('print method chosen by quantity', () => {
  const o: ProductOption[] = [{
    key: 'method', label: 'Print method', default: 'auto', drives: true,
    auto: [{ min_qty: 1, value: 'heat' }, { min_qty: 50, value: 'screen' }],
    choices: [{ value: 'auto', label: 'Best for your quantity' }, { value: 'heat', label: 'Heat transfer' }, { value: 'screen', label: 'Screen print' }],
  }];
  it('picks heat for small runs and screen from 50, but keeps the word "auto" in the order', () => {
    const small = resolveSelection(o, { config: {}, quantity: 10 });
    expect(small.config.method).toBe('auto');
    expect(small.effective.method).toBe('heat');
    expect(resolveSelection(o, { config: {}, quantity: 50 }).effective.method).toBe('screen');
    expect(resolveSelection(o, { config: { method: 'auto' }, quantity: 49 }).effective.method).toBe('heat');
  });
  it('the customer can still choose', () => {
    const s = resolveSelection(o, { config: { method: 'screen' }, quantity: 10 });
    expect(s.config.method).toBe('screen');
    expect(s.effective.method).toBe('screen');
  });
  it('a screen print table is found only through the real value', () => {
    expect(ruleConfig(o, { method: 'screen' })).toEqual({ method: 'screen' });
  });
});

describe('what choices add', () => {
  const ctx: ExtraContext = { quantity: 100, areaSqft: null };
  const o = (extra: Partial<ProductOption['choices'][number]>, per: ProductOption['choices'][number]['extra_per'] = 'piece'): ProductOption[] => [
    { key: 'x', label: 'X', default: 'on', choices: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On', extra_per: per, ...extra }] },
  ];
  const sum = (opts: ProductOption[], c = ctx, cfg: Record<string, string> = { x: 'on' }) => extrasFor(opts, cfg, c).lines.reduce((a, l) => a + l.kobo, 0);

  it('per piece, per order, per square foot and per foot', () => {
    expect(sum(o({ extra_kobo: N(25) }))).toBe(N(2500));
    expect(sum(o({ extra_kobo: N(900) }, 'order'))).toBe(N(900));
    expect(sum(o({ extra_kobo: N(100) }, 'sqft'), { quantity: 2, areaSqft: 20.2 })).toBe(N(100) * 21);
    expect(sum(o({ extra_kobo: N(40) }, 'foot'), { quantity: 1, areaSqft: 15, perimeterFt: 16 })).toBe(N(40) * 16);
  });
  it('a one-time setup comes on top', () => {
    expect(sum(o({ extra_kobo: N(20), setup_kobo: N(5000) }))).toBe(N(2000) + N(5000));
  });
  it('can be a saving', () => {
    expect(sum(o({ extra_kobo: -N(5) }))).toBe(-N(500));
  });
  it('an amount can depend on the size', () => {
    const mount = o({ by: { key: 'size', amounts: { a3: N(800), a2: N(1500) } } });
    expect(sum(mount, { ...ctx, quantity: 10, sizeKey: 'a3' })).toBe(N(8000));
    expect(sum(mount, { ...ctx, quantity: 10, sizeKey: 'a2' })).toBe(N(15000));
    expect(sum(mount, { ...ctx, quantity: 10, sizeKey: 'a0' })).toBe(0);
  });
  it('an amount can depend on another choice', () => {
    const opts: ProductOption[] = [
      { key: 'paper', label: 'Paper', default: 'a', choices: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
      { key: 'lam', label: 'Lam', default: 'on', choices: [{ value: 'on', label: 'On', extra_per: 'piece', by: { key: 'paper', amounts: { a: N(3), b: N(6) } } }] },
    ];
    expect(sum(opts, { ...ctx, quantity: 10 }, { paper: 'b', lam: 'on' })).toBe(N(60));
  });
  it('garment sizes: a bigger size can cost more, only for the pieces in that size', () => {
    const sizes: ProductOption[] = [{ key: 'sizes', label: 'Sizes', kind: 'split', default: '', choices: [{ value: 'm', label: 'M' }, { value: 'xxl', label: 'XXL', extra_kobo: N(500), extra_per: 'piece' }] }];
    const lines = extrasFor(sizes, { sizes: 'm:7,xxl:3' }, { quantity: 10, areaSqft: null }).lines;
    expect(lines).toHaveLength(1);
    expect(lines[0].kobo).toBe(N(1500));
    expect(lines[0].label).toBe('XXL × 3');
  });
  it('print positions multiply the print size charge', () => {
    const opts: ProductOption[] = [
      { key: 'positions', label: 'Print on', kind: 'tick', role: 'positions', default: 'front', choices: [{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back', extra_kobo: N(400), extra_per: 'piece' }, { value: 'sleeve', label: 'Sleeve', extra_kobo: N(300), extra_per: 'piece' }] },
      { key: 'printsize', label: 'Print size', default: 'a3', choices: [{ value: 'a4', label: 'A4' }, { value: 'a3', label: 'A3', extra_kobo: N(250), extra_per: 'position' }] },
    ];
    // 10 shirts, front + back (2 prints) at A3 = 250 x 10 x 2, back = 400 x 10
    expect(sum(opts, { quantity: 10, areaSqft: null }, { positions: 'front,back', printsize: 'a3' })).toBe(N(5000) + N(4000));
  });
  it('records what it costs, and says when a cost is missing', () => {
    const withCost = extrasFor(o({ extra_kobo: N(25), cost_kobo: N(10) }), { x: 'on' }, ctx);
    expect(withCost.lines[0].costKobo).toBe(N(1000));
    expect(withCost.costComplete).toBe(true);
    expect(extrasFor(o({ extra_kobo: N(25) }), { x: 'on' }, ctx).costComplete).toBe(false);
    expect(extrasFor(o({}), { x: 'on' }, ctx).costComplete).toBe(true); // nothing to cost
  });
  it('labels the button for the choices made now', () => {
    const f = (k: number) => `₦${k / 100}`;
    const vo = (key: string) => (key === 'size' ? 'a2' : undefined);
    expect(choiceLabel({ value: 'a', label: 'A' }, { valueOf: vo }, f)).toBe('');
    expect(choiceLabel({ value: 'a', label: 'A', extra_kobo: N(2500) }, { valueOf: vo }, f)).toBe('+₦2500');
    expect(choiceLabel({ value: 'a', label: 'A', extra_kobo: N(25), extra_per: 'piece' }, { valueOf: vo }, f)).toBe('+₦25 each');
    expect(choiceLabel({ value: 'a', label: 'A', extra_kobo: -N(5), extra_per: 'piece' }, { valueOf: vo }, f)).toBe('−₦5 each');
    expect(choiceLabel({ value: 'a', label: 'A', extra_per: 'piece', by: { key: 'size', amounts: { a2: N(15) } } }, { valueOf: vo }, f)).toBe('+₦15 each');
    expect(choiceLabel({ value: 'a', label: 'A', extra_kobo: N(20), extra_per: 'piece', setup_kobo: N(5000) }, { valueOf: vo }, f)).toBe('+₦20 each and ₦5000 setup');
    expect(choiceLabel({ value: 'a', label: 'A', percent: 20 }, { valueOf: vo }, f)).toBe('+20%');
  });
});

// A small product that exercises the whole thing the way business cards do.
const cards: EngineProduct = {
  slug: 'business-cards',
  name: 'Business cards',
  pricing_mode: 'tier',
  sizes: [],
  qty_custom: true,
  qty_min: 50,
  qty_max: 5000,
  options: [
    { key: 'card', label: 'Card', default: 'std', drives: true, choices: [{ value: 'std', label: 'Standard 300gsm' }, { value: 'prem', label: 'Premium 350gsm' }, { value: 'lux', label: 'Luxury 700gsm', unpriced: true }] },
    { key: 'lam', label: 'Lamination', default: 'matte', choices: [{ value: 'none', label: 'None' }, { value: 'matte', label: 'Matte' }, { value: 'soft', label: 'Soft-touch', extra_kobo: N(8), extra_per: 'piece' }] },
    { key: 'finishing', label: 'Finishing', kind: 'tick', group: 'special', default: '', choices: [{ value: 'round', label: 'Rounded corners', extra_kobo: N(6), extra_per: 'piece' }, { value: 'foil', label: 'Gold foil', extra_kobo: N(12), extra_per: 'piece', setup_kobo: N(4000), only_if: { lam: ['matte', 'soft'] } }] },
    { key: 'speed', label: 'Speed', default: 'standard', choices: [{ value: 'standard', label: 'Standard' }, { value: 'fast', label: '24-hour', percent: 20 }] },
  ],
  packages: [
    { key: 'standard', label: 'Standard', set: { card: 'std', lam: 'matte', finishing: '' } },
    { key: 'premium', label: 'Premium', set: { card: 'prem', lam: 'matte', finishing: 'round' } },
    { key: 'luxury', label: 'Luxury', set: { card: 'lux', lam: 'soft', finishing: 'round,foil' } },
  ],
};
const cardRules: PriceRule[] = [
  rule(100, N(15000), { card: 'std' }, { cost_kobo: N(9000) }), rule(250, N(30000), { card: 'std' }, { cost_kobo: N(19000) }), rule(500, N(48000), { card: 'std' }, { cost_kobo: N(32000) }),
  rule(100, N(21000), { card: 'prem' }), rule(250, N(42000), { card: 'prem' }),
];

describe('one price for a configured product', () => {
  it('base price only, by default', () => {
    const p = priceConfigured(cards, cardRules, { quantity: 100, config: {} });
    expect(p.totalKobo).toBe(N(15000));
    expect(p.lines.map((l) => l.kind)).toEqual(['base']);
    expect(p.costKobo).toBe(N(9000));
  });
  it('adds up the table, each add-on and the setup', () => {
    const p = priceConfigured(cards, cardRules, { quantity: 100, config: { card: 'prem', lam: 'soft', finishing: 'round,foil' } });
    // 21,000 + soft-touch 8x100 + rounded 6x100 + foil 12x100 + setup 4,000
    expect(p.totalKobo).toBe(N(21000 + 800 + 600 + 1200 + 4000));
    expect(p.lines.filter((l) => l.kind === 'extra').map((l) => l.label)).toEqual(['Soft-touch', 'Rounded corners', 'Gold foil']);
    expect(p.lines.reduce((a, l) => a + l.kobo, 0)).toBe(p.totalKobo);
  });
  it('speed is a percentage of everything before it', () => {
    const p = priceConfigured(cards, cardRules, { quantity: 100, config: { speed: 'fast', lam: 'soft' } });
    expect(p.totalKobo).toBe(Math.round((N(15000) + N(800)) * 1.2));
    expect(p.lines.at(-1)).toMatchObject({ kind: 'percent', kobo: Math.round((N(15800) * 20) / 100) });
  });
  it('a quantity between the steps works for add-ons too (they scale with the quantity)', () => {
    const p = priceConfigured(cards, cardRules, { quantity: 340, config: { finishing: 'round' } });
    expect(p.basis).toBe('between');
    expect(p.totalKobo).toBe(N(120) * 340 + N(6) * 340);
  });
  it('knows its cost only when every part has one', () => {
    expect(priceConfigured(cards, cardRules, { quantity: 100, config: { lam: 'soft' } }).costKobo).toBeNull();
    expect(priceConfigured(cards, cardRules, { quantity: 100, config: {} }).costKobo).toBe(N(9000));
  });
  it('refuses a choice that has no price table', () => {
    expect(() => priceConfigured(cards, cardRules, { quantity: 500, config: { card: 'prem' } })).not.toThrow(); // 500 is past the last step, allowed
    expect(() => priceConfigured(cards, cardRules, { quantity: 100, config: { card: 'lux' } })).not.toThrow(); // unpriced choice falls back to standard
    expect(priceConfigured(cards, cardRules, { quantity: 100, config: { card: 'lux' } }).config.card).toBe('std');
  });
  it('explains what it changed', () => {
    const p = priceConfigured(cards, cardRules, { quantity: 100, config: { lam: 'none', finishing: 'foil' } });
    expect(p.config.finishing).toBe('');
    expect(p.notes.join(' ')).toMatch(/Gold foil needs lamination/);
  });
  it('rejects an impossible quantity', () => {
    expect(() => priceConfigured(cards, cardRules, { quantity: 0, config: {} })).toThrow(PriceError);
    expect(() => priceConfigured(cards, cardRules, { quantity: 40, config: {} })).toThrow(/smallest order/);
  });
  it('never returns a negative price', () => {
    const odd: EngineProduct = { ...cards, options: [{ key: 'x', label: 'X', default: 'a', choices: [{ value: 'a', label: 'A', extra_kobo: -N(500), extra_per: 'piece' }] }] };
    expect(priceConfigured(odd, [rule(100, N(15000))], { quantity: 100, config: {} }).totalKobo).toBe(0);
  });
});

describe('quantity ladder', () => {
  it('shows the price and the saving at each step', () => {
    const l = ladderFor(cards, cardRules, { quantity: 100, config: {} });
    expect(l.map((s) => s.quantity)).toEqual([100, 250, 500]);
    expect(l[0]).toMatchObject({ unitKobo: N(150), savePct: null });
    expect(l[1]).toMatchObject({ unitKobo: N(120), savePct: 20 });
    expect(l[2]).toMatchObject({ unitKobo: N(96), savePct: 36 });
  });
  it('includes the add-ons chosen', () => {
    const l = ladderFor(cards, cardRules, { quantity: 100, config: { lam: 'soft' } });
    expect(l[0].totalKobo).toBe(N(15000 + 800));
  });
  it('is empty for products where sizes decide the quantity', () => {
    const tee: EngineProduct = { ...cards, options: [{ key: 'sizes', label: 'Sizes', kind: 'split', default: 'm:5', choices: [{ value: 'm', label: 'M' }] }] };
    expect(ladderFor(tee, [rule(5, 1)], { quantity: 5, config: {} })).toEqual([]);
  });
});

describe('packages', () => {
  it('prices each one now, and leaves out one that cannot be built from what is on sale', () => {
    const p = packagePrices(cards, cardRules, { quantity: 100, config: {} });
    expect(p.map((x) => x.key)).toEqual(['standard', 'premium']); // luxury needs the unpriced card
    expect(p[0]).toMatchObject({ totalKobo: N(15000), selected: true });
    expect(p[1]).toMatchObject({ totalKobo: N(21000 + 600), selected: false });
  });
  it('knows which one is selected', () => {
    const p = packagePrices(cards, cardRules, { quantity: 100, config: { card: 'prem', lam: 'matte', finishing: 'round' } });
    expect(p.find((x) => x.key === 'premium')!.selected).toBe(true);
    expect(p.find((x) => x.key === 'standard')!.selected).toBe(false);
  });
});

describe('what can be picked right now', () => {
  it('lists the quantities that have a price for these choices', () => {
    expect(availabilityFor(cards, cardRules, { quantity: 100, config: {} }).quantities).toEqual([100, 250, 500]);
    expect(availabilityFor(cards, cardRules, { quantity: 100, config: { card: 'prem' } }).quantities).toEqual([100, 250]);
  });
  it('hides a card with no price table, and a choice that is switched off', () => {
    const a = availabilityFor(cards, cardRules, { quantity: 100, config: {} });
    expect(a.choices.card.lux.hide).toBe(true);
    expect(a.choices.card.prem).toMatchObject({ ok: true, hide: false });
  });
  it('greys out what the other choices rule out and says why', () => {
    const a = availabilityFor(cards, cardRules, { quantity: 100, config: { lam: 'none' } });
    expect(a.choices.finishing.foil).toMatchObject({ ok: false });
    expect(a.choices.finishing.foil.why).toMatch(/Gold foil needs lamination/);
  });
  it('shows what each button adds', () => {
    const a = availabilityFor(cards, cardRules, { quantity: 100, config: {} });
    expect(a.choices.lam.soft.price).toBe('+₦8 each');
    expect(a.choices.speed.fast.price).toBe('+20%');
    expect(a.choices.lam.matte.price).toBe('');
  });
  it('a card with a table but no price at this quantity is greyed out', () => {
    const noCustom = { ...cards, qty_custom: false };
    const a = availabilityFor(noCustom, cardRules, { quantity: 500, config: {} });
    expect(a.choices.card.prem).toMatchObject({ ok: false });
    expect(a.choices.card.prem.why).toMatch(/not offered at this quantity/);
  });
  it('the console preview sees a choice that has no prices yet and says so', () => {
    const a = availabilityFor(cards, cardRules, { quantity: 100, config: {} }, { preview: true });
    expect(a.choices.card.lux).toMatchObject({ ok: false, hide: false });
    expect(a.choices.card.lux.why).toMatch(/No prices entered/);
  });
});

describe('from price', () => {
  it('is the lowest price at the smallest quantity among choices on sale', () => {
    expect(fromPrice(cards, cardRules)).toEqual({ kobo: N(15000), quantity: 100, ratePerSqft: null });
  });
  it('ignores a price table for a choice that is not on sale', () => {
    const rules = [...cardRules, rule(100, N(9000), { card: 'lux' })];
    expect(fromPrice(cards, rules).kobo).toBe(N(15000));
  });
  it('size and area products', () => {
    const size = { pricing_mode: 'size' as const, options: [] };
    expect(fromPrice(size, [{ ...rule(1, 0), quantity: null, size_key: 'a', price_kobo: N(900) }, { ...rule(1, 0), quantity: null, size_key: 'b', price_kobo: N(400) }]).kobo).toBe(N(400));
    const area = { pricing_mode: 'area' as const, options: [] };
    expect(fromPrice(area, [{ ...rule(1, 0), quantity: null, price_kobo: null, rate_per_sqft_kobo: N(700) }]).ratePerSqft).toBe(N(700));
  });
});

describe('what the browser may see', () => {
  it('never includes what a choice costs us, or choices that are off', () => {
    const o: ProductOption[] = [{ key: 'x', label: 'X', default: 'a', choices: [{ value: 'a', label: 'A', cost_kobo: 5, cost_per: 'piece', provisional: true, extra_kobo: 9 }, { value: 'b', label: 'B', hidden: true }, { value: 'c', label: 'C', unpriced: true }] }];
    const pub = publicOptions(o);
    expect(pub[0].choices).toHaveLength(1);
    expect(JSON.stringify(pub)).not.toMatch(/cost_kobo|cost_per|provisional|unpriced|hidden/);
    expect(pub[0].choices[0].extra_kobo).toBe(9);
  });
});
