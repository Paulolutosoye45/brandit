import { beforeAll, describe, expect, it } from 'vitest';

process.env.PGLITE_DIR = 'memory';
process.env.DEMO_MODE = 'true';
delete process.env.APP_ENV;
process.env.SESSION_SECRET = 'a-long-random-secret-for-the-options-admin-1234567890';

import { CATALOGUE, materialiseOptions } from '../content/catalogue';
import { cleanOptionsV2, cleanPackages } from '../lib/optionsAdmin';
import { optionsToInput, packagesToInput } from '../lib/optionsForm';
import type { ProductOption } from '../lib/types';

let db: typeof import('../lib/db');
let oa: typeof import('../lib/optionsAdmin');
let catalog: typeof import('../lib/catalog');
const actor = { id: null, name: 'Ada (Admin)' };
const idOf = async (slug: string) => (await db.one<any>('select id from products where slug = $1', [slug]))!.id as string;

beforeAll(async () => {
  db = await import('../lib/db');
  oa = await import('../lib/optionsAdmin');
  catalog = await import('../lib/catalog');
  await db.ready();
});

const opt = (o: Partial<ProductOption> & { key: string }): ProductOption => ({ label: o.key, default: o.choices?.[0]?.value ?? '', choices: [], ...o });
const ch = (value: string, label = value) => ({ value, label });

describe('opening the editor and pressing Save changes nothing', () => {
  for (const examples of [true, false]) {
    for (const p of CATALOGUE) {
      it(`${p.slug} (${examples ? 'with example prices' : 'real prices only'})`, () => {
        const stored = JSON.parse(JSON.stringify(materialiseOptions(p, examples))) as ProductOption[];
        const back = cleanOptionsV2(optionsToInput(stored), p.mode, stored);
        expect(back).toEqual(stored);
      });
    }
  }
  it('packages round-trip too', () => {
    for (const p of CATALOGUE) expect(cleanPackages(packagesToInput(p.packages), materialiseOptions(p, true))).toEqual(p.packages);
  });
});

describe('the editor refuses what would break the shop, in plain words', () => {
  const two = [ch('a', 'A'), ch('b', 'B')];
  const input = (extra: any = {}) => [{ label: 'Finish', choices: two.map((c) => ({ ...c })), ...extra }];
  it('needs a name and two choices', () => {
    expect(() => cleanOptionsV2([{ label: '', choices: two }], 'tier')).toThrow(/needs a name/);
    expect(() => cleanOptionsV2([{ label: 'Finish', choices: [ch('a')] }], 'tier')).toThrow(/at least two choices/);
    expect(cleanOptionsV2([{ label: 'Extras', kind: 'tick', choices: [ch('a')] }], 'tier')[0].kind).toBe('tick');
  });
  it('reads amounts in naira, including a saving', () => {
    const o = cleanOptionsV2(input({ choices: [{ label: 'A' }, { label: 'B', amount: '₦1,500', per: 'piece' }, { label: 'C', amount: '-500', per: 'order' }] }), 'tier')[0];
    expect(o.choices[1]).toMatchObject({ extra_kobo: 150000, extra_per: 'piece' });
    expect(o.choices[2]).toMatchObject({ extra_kobo: -50000 });
    expect(() => cleanOptionsV2(input({ choices: [{ label: 'A' }, { label: 'B', amount: 'lots' }] }), 'tier')).toThrow(/extra price for "B" in "Finish"/);
    expect(() => cleanOptionsV2(input({ choices: [{ label: 'A' }, { label: 'B', amount: '99999999999' }] }), 'tier')).toThrow(/typo/);
  });
  it('allows per-square-foot charges only on banners, and print positions only where there are positions', () => {
    const bad = input({ choices: [{ label: 'A' }, { label: 'B', amount: '100', per: 'sqft' }] });
    expect(() => cleanOptionsV2(bad, 'tier')).toThrow(/square foot/);
    expect(cleanOptionsV2(bad, 'area')[0].choices[1].extra_per).toBe('sqft');
    expect(() => cleanOptionsV2(input({ choices: [{ label: 'A' }, { label: 'B', amount: '100', per: 'position' }] }), 'tier')).toThrow(/print positions/);
  });
  it('rejects options that wait for each other', () => {
    const a = { key: 'a', label: 'A', only_if: { b: ['y'] }, choices: [ch('x'), ch('y')] };
    const b = { key: 'b', label: 'B', only_if: { a: ['x'] }, choices: [ch('x'), ch('y')] };
    expect(() => cleanOptionsV2([a, b], 'tier')).toThrow(/wait for each other/);
    expect(() => cleanOptionsV2([{ ...a, only_if: { a: ['x'] } }], 'tier')).toThrow(/cannot depend on itself/);
    expect(() => cleanOptionsV2([{ ...a, only_if: { ghost: ['x'] } }], 'tier')).toThrow(/no longer exists/);
  });
  it('keeps the price grid a size a person can fill in', () => {
    const many = (k: string) => ({ key: k, label: k, drives: true, choices: Array.from({ length: 8 }, (_, i) => ({ value: `v${i}`, label: `${k}${i}` })) });
    expect(() => cleanOptionsV2([many('a'), many('b'), many('c')], 'tier')).toThrow(/rows/);
    expect(() => cleanOptionsV2([many('a'), many('b'), many('c'), many('d'), many('e')], 'tier')).toThrow(/Up to 4 options/);
    expect(() => cleanOptionsV2([{ key: 't', label: 'T', kind: 'tick', drives: true, choices: two }], 'tier')).toThrow(/cannot pick the price table/);
  });
  it('checks "best for the quantity" and shared price tables', () => {
    const auto = { key: 'm', label: 'Method', choices: [{ value: 'auto', label: 'Best' }, ch('heat'), ch('screen')], auto: [{ min_qty: '1', value: 'heat' }, { min_qty: '50', value: 'screen' }] };
    expect(cleanOptionsV2([auto], 'tier')[0].auto).toEqual([{ min_qty: 1, value: 'heat' }, { min_qty: 50, value: 'screen' }]);
    expect(() => cleanOptionsV2([{ ...auto, auto: [{ min_qty: '50', value: 'gone' }] }], 'tier')).toThrow(/does not exist/);
    expect(() => cleanOptionsV2([{ ...auto, choices: [ch('heat'), ch('screen')] }], 'tier')).toThrow(/Best for your quantity/);
    const like = { key: 'p', label: 'Paper', drives: true, choices: [ch('g'), { ...ch('m'), price_like: 'g' }] };
    expect(cleanOptionsV2([like], 'tier')[0].choices[1].price_like).toBe('g');
    expect(() => cleanOptionsV2([{ ...like, drives: false }], 'tier')).toThrow(/price table/);
    expect(() => cleanOptionsV2([{ ...like, choices: [{ ...ch('g'), price_like: 'm' }, { ...ch('m'), price_like: 'g' }] }], 'tier')).toThrow(/own/);
  });
  it('only keeps a "waiting for a price" or "placeholder" flag that is true', () => {
    const was = [opt({ key: 'f', default: 'a', choices: [ch('a'), { value: 'b', label: 'B', unpriced: true }, { value: 'c', label: 'C', extra_kobo: 100, extra_per: 'order', provisional: true }] })];
    const same = cleanOptionsV2(optionsToInput(was), 'tier', was)[0];
    expect(same.choices[1].unpriced).toBe(true);
    expect(same.choices[2].provisional).toBe(true);
    // Giving B a price takes it off the waiting list; changing C's price makes it real.
    const edited = optionsToInput(was);
    edited[0].choices[1].amount = '250';
    edited[0].choices[2].amount = '2';
    const now = cleanOptionsV2(edited, 'tier', was)[0];
    expect(now.choices[1].unpriced).toBeUndefined();
    expect(now.choices[2].provisional).toBeUndefined();
    // Nobody can invent a placeholder from the browser.
    const forged = optionsToInput([opt({ key: 'f', default: 'a', choices: [ch('a'), ch('b')] })]);
    forged[0].choices[1].provisional = true;
    expect(cleanOptionsV2(forged, 'tier', [])[0].choices[1].provisional).toBeUndefined();
  });
  it('checks packages', () => {
    const o = [opt({ key: 'card', default: 'a', choices: [ch('a'), ch('b')] }), opt({ key: 'fin', kind: 'tick', default: '', choices: [ch('x'), ch('y')] })];
    expect(cleanPackages([{ label: 'Standard', set: { card: 'a', fin: '' } }, { label: 'Fancy', tagline: 'All the extras', badge: 'Best', set: { card: 'b', fin: 'y,x' } }], o)).toEqual([
      { key: 'standard', label: 'Standard', set: { card: 'a', fin: '' } },
      { key: 'fancy', label: 'Fancy', tagline: 'All the extras', badge: 'Best', set: { card: 'b', fin: 'x,y' } },
    ]);
    expect(() => cleanPackages([{ label: 'X', set: { card: 'zzz' } }], o)).toThrow(/does not exist/);
    expect(() => cleanPackages([{ label: 'X', set: {} }], o)).toThrow(/does not set anything/);
    expect(() => cleanPackages([{ label: '', set: { card: 'a' } }], o)).toThrow(/needs a name/);
    expect(() => cleanPackages(Array.from({ length: 5 }, (_, i) => ({ label: `P${i}`, set: { card: 'a' } })), o)).toThrow(/up to 4/);
  });
});

describe('saving options, packages and the quantity rule', () => {
  it('saves options, writes history, and shows stray prices when a choice is removed', async () => {
    const id = await idOf('stickers');
    const p = (await catalog.getProductById(id))!;
    const input = optionsToInput(p.options);
    const material = input.find((o) => o.key === 'material')!;
    material.choices = material.choices.filter((c) => c.value !== 'clear'); // a price table loses its choice
    const r = await oa.saveOptionsV2(id, input, actor);
    expect(r.stray).toBeGreaterThan(0);
    const after = (await catalog.getProductById(id))!;
    expect(after.options.find((o) => o.key === 'material')!.choices.map((c) => c.value)).not.toContain('clear');
    const hist = await db.query<any>("select summary from price_history where product_id = $1 and kind = 'options'", [id]);
    expect(hist.length).toBe(1);
  });

  it('will not remove a choice that a package depends on', async () => {
    const id = await idOf('flyers');
    const p = (await catalog.getProductById(id))!;
    const input = optionsToInput(p.options);
    const paper = input.find((o) => o.key === 'paper')!;
    paper.choices = paper.choices.filter((c) => c.value !== 's170');
    await expect(oa.saveOptionsV2(id, input, actor)).rejects.toThrow(/"Premium" package/);
  });

  it('saves packages and the quantity rule', async () => {
    const id = await idOf('business-cards');
    await oa.savePackages(id, [{ label: 'Plain', set: { card: 'std300' } }], actor);
    expect((await catalog.getProductById(id))!.packages).toEqual([{ key: 'plain', label: 'Plain', set: { card: 'std300' } }]);
    await oa.saveQuantityRule(id, { custom: true, min: '100', max: '2000' }, actor);
    const p = (await catalog.getProductById(id))!;
    expect([p.qty_custom, p.qty_min, p.qty_max]).toEqual([true, 100, 2000]);
    await expect(oa.saveQuantityRule(id, { custom: true, min: '500', max: '100' }, actor)).rejects.toThrow(/smallest order cannot be bigger/);
    await expect(oa.saveQuantityRule(id, { custom: true, min: '0', max: '' }, actor)).rejects.toThrow(/between 1 and 10,000/);
    await expect(oa.saveQuantityRule(await idOf('picture-frames'), { custom: true, min: '', max: '' }, actor)).rejects.toThrow(/priced by quantity/);
  });
});
