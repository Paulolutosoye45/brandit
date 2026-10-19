import { describe, expect, it } from 'vitest';
import { runPriceTest } from '../lib/priceTest';
import type { PriceRule } from '../lib/pricing';
import type { Product } from '../lib/types';

const N = (n: number) => n * 100;
const rule = (o: Partial<PriceRule>): PriceRule => ({ config: {}, quantity: null, size_key: null, price_kobo: null, rate_per_sqft_kobo: null, min_area_sqft: null, active: true, ...o });
const product = (o: Partial<Product> = {}): Product => ({
  id: 'p', slug: 'things', name: 'Things', blurb: '', pricing_mode: 'tier', options: [], sizes: [], print_w_in: null, print_h_in: null, check_class: 'print', active: true, sort: 0,
  description: '', highlights: [], category: '', allow_custom: true, packages: [], qty_custom: true, qty_min: null, qty_max: null, ...o,
} as Product);
const check = (r: ReturnType<typeof runPriceTest>, id: string) => r.checks.find((c) => c.id === id)!;

describe('the price test notices real problems', () => {
  it('passes a sound table', () => {
    const r = runPriceTest({ product: product(), rules: [rule({ quantity: 100, price_kobo: N(10000) }), rule({ quantity: 500, price_kobo: N(40000) })] });
    expect(r.ok).toBe(true);
    expect(check(r, 'ladder').status).toBe('pass');
    expect(check(r, 'between').status).toBe('pass');
  });

  it('fails when a product has no price at all', () => {
    const r = runPriceTest({ product: product(), rules: [] });
    expect(r.ok).toBe(false);
    expect(check(r, 'for-sale').status).toBe('fail');
  });

  it('fails when a bigger order costs less in total than a smaller one', () => {
    const r = runPriceTest({ product: product(), rules: [rule({ quantity: 100, price_kobo: N(10000) }), rule({ quantity: 500, price_kobo: N(5000) })] });
    expect(r.ok).toBe(false);
    expect(check(r, 'ladder').status).toBe('fail');
    expect(check(r, 'ladder').examples[0]).toMatch(/500 costs ₦5,000, less than 100/);
  });

  it('warns when a bigger order costs more per piece', () => {
    const r = runPriceTest({ product: product(), rules: [rule({ quantity: 100, price_kobo: N(10000) }), rule({ quantity: 500, price_kobo: N(60000) })] });
    expect(r.ok).toBe(true);
    expect(check(r, 'ladder').status).toBe('warn');
  });

  it('fails a price below cost and warns on a thin margin', () => {
    const loss = runPriceTest({ product: product(), rules: [rule({ quantity: 100, price_kobo: N(10000), cost_kobo: N(12000) })] });
    expect(check(loss, 'loss').status).toBe('fail');
    expect(loss.ok).toBe(false);
    const thin = runPriceTest({ product: product(), rules: [rule({ quantity: 100, price_kobo: N(10000), cost_kobo: N(8000) })], targetMarginPct: 40 });
    expect(check(thin, 'loss').status).toBe('pass');
    expect(check(thin, 'margin').status).toBe('warn');
    expect(check(thin, 'margin').examples[0]).toMatch(/20% margin/);
    const healthy = runPriceTest({ product: product(), rules: [rule({ quantity: 100, price_kobo: N(10000), cost_kobo: N(5000) })], targetMarginPct: 40 });
    expect(check(healthy, 'margin').status).toBe('pass');
  });

  it('says when costs are missing instead of pretending the margins are fine', () => {
    const r = runPriceTest({ product: product(), rules: [rule({ quantity: 100, price_kobo: N(10000) })] });
    expect(check(r, 'margin').status).toBe('info');
  });

  it('lists add-ons that wait for a price, and packages that cannot be offered because of them', () => {
    const p = product({
      options: [{ key: 'finish', label: 'Finish', default: 'plain', choices: [{ value: 'plain', label: 'Plain' }, { value: 'foil', label: 'Foil', unpriced: true }] }],
      packages: [{ key: 'lux', label: 'Luxury', set: { finish: 'foil' } }],
    });
    const r = runPriceTest({ product: p, rules: [rule({ quantity: 100, price_kobo: N(10000) })] });
    expect(check(r, 'waiting').status).toBe('info');
    expect(check(r, 'waiting').examples).toEqual(['Finish: Foil']);
    expect(check(r, 'packages-missing').status).toBe('info');
    expect(check(r, 'packages-missing').examples[0]).toMatch(/Luxury is not offered/);
  });

  it('reports combinations that have no price table', () => {
    const p = product({
      options: [
        { key: 'size', label: 'Size', default: 'a5', drives: true, choices: [{ value: 'a5', label: 'A5' }, { value: 'a4', label: 'A4' }] },
        { key: 'paper', label: 'Paper', default: 'g', drives: true, choices: [{ value: 'g', label: 'Gloss' }, { value: 'c', label: 'Card' }] },
      ],
    });
    const rules = [
      rule({ quantity: 100, price_kobo: N(1000), config: { size: 'a5', paper: 'g' } }),
      rule({ quantity: 100, price_kobo: N(2000), config: { size: 'a5', paper: 'c' } }),
      rule({ quantity: 100, price_kobo: N(1800), config: { size: 'a4', paper: 'g' } }),
    ];
    const r = runPriceTest({ product: p, rules });
    const c = check(r, 'coverage');
    expect(c.status).toBe('info');
    expect(c.examples).toEqual(['A4 + Card']);
    expect(r.ok).toBe(true);
  });

  it('a product sold by area and one sold by size are tested too', () => {
    const area = runPriceTest({ product: product({ pricing_mode: 'area', qty_custom: false }), rules: [rule({ rate_per_sqft_kobo: N(700), min_area_sqft: 10 })] });
    expect(area.ok).toBe(true);
    const size = runPriceTest({ product: product({ pricing_mode: 'size', qty_custom: false, sizes: [{ key: 'a', label: 'A', w_in: 1, h_in: 1 }, { key: 'b', label: 'B', w_in: 2, h_in: 2 }] }), rules: [rule({ size_key: 'a', price_kobo: N(100) })] });
    expect(size.ok).toBe(true);
  });
});
