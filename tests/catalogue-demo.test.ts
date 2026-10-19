import { beforeAll, describe, expect, it } from 'vitest';

// The demo and the private test site: every product has example prices, so the whole catalogue can be tried.
process.env.PGLITE_DIR = 'memory';
process.env.DEMO_MODE = 'true';
delete process.env.APP_ENV;
process.env.SESSION_SECRET = 'a-long-random-secret-for-the-demo-catalogue-1234567890';

let db: typeof import('../lib/db');
let catalog: typeof import('../lib/catalog');
let engine: typeof import('../lib/priceEngine');
let ptest: typeof import('../lib/priceTest');

const load = async (slug: string) => {
  const product = (await catalog.getProduct(slug))!;
  const rules = (await catalog.getRules(product.id)).price;
  return { product, rules };
};

beforeAll(async () => {
  db = await import('../lib/db');
  catalog = await import('../lib/catalog');
  engine = await import('../lib/priceEngine');
  ptest = await import('../lib/priceTest');
  await db.ready();
});

describe('the example catalogue', () => {
  it('passes the price test for every product', async () => {
    const lines: string[] = [];
    // The sample pack is a one-price box with nothing to choose, so it has no price table to test.
    for (const p of (await catalog.listProducts(true)).filter((x) => !x.sample)) {
      const rules = (await catalog.getRules(p.id)).price;
      const r = ptest.runPriceTest({ product: p, rules });
      for (const c of r.checks) if (c.status === 'fail') lines.push(`${p.slug} — ${c.label}: ${c.detail} ${c.examples.join(' | ')}`);
      expect(r.scenarios, p.slug).toBeGreaterThan(5);
    }
    expect(lines).toEqual([]);
  });

  it('prices every package of every product, and the packages rise in price', async () => {
    for (const slug of ['business-cards', 'flyers', 'posters', 'tees-and-totes']) {
      const { product, rules } = await load(slug);
      const offered = engine.packagePrices(product, rules, { quantity: slug === 'posters' ? 10 : 100 });
      expect(offered.map((o) => o.key), slug).toEqual(product.packages.map((p) => p.key));
      for (let i = 1; i < offered.length; i++) expect(offered[i].totalKobo, `${slug} ${offered[i].key}`).toBeGreaterThanOrEqual(offered[i - 1].totalKobo);
    }
  });

  it('shows the ladder with savings for business cards', async () => {
    const { product, rules } = await load('business-cards');
    const ladder = engine.ladderFor(product, rules, { quantity: 100 });
    expect(ladder.map((s) => s.quantity)).toEqual([50, 100, 200, 250, 500, 1000]);
    expect(ladder[0].savePct).toBeNull();
    expect(ladder[ladder.length - 1].savePct).toBeGreaterThan(30);
    // Each step costs less per piece than the one before.
    for (let i = 1; i < ladder.length; i++) expect(ladder[i].unitKobo).toBeLessThanOrEqual(ladder[i - 1].unitKobo);
  });

  it('works out a price between two steps and never dearer than the next step', async () => {
    const { product, rules } = await load('business-cards');
    const at = (q: number) => engine.priceConfigured(product, rules, { quantity: q });
    const low = at(500).totalKobo;
    const high = at(1000).totalKobo;
    const mid = at(750);
    expect(mid.basis).toBe('between');
    expect(mid.fromStep).toBe(500);
    expect(mid.totalKobo).toBeGreaterThan(low);
    expect(mid.totalKobo).toBeLessThanOrEqual(high);
    expect(at(2000).basis).toBe('above');
    expect(() => at(10)).toThrow();
  });

  it('applies the rules that stop impossible combinations, and says so', async () => {
    const { product, rules } = await load('business-cards');
    // Gold foil needs lamination; with none picked the foil is taken off and the customer is told.
    const p = engine.priceConfigured(product, rules, { quantity: 100, config: { card: 'prem350', lamination: 'none', finishing: 'foil_gold' } });
    expect(p.config.finishing).toBe('');
    expect(p.notes.join(' ')).toMatch(/Gold foil/);
    // Texture cards cannot be laminated.
    const linen = engine.priceConfigured(product, rules, { quantity: 100, config: { card: 'linen', lamination: 'gloss' } });
    expect(linen.config.lamination).toBeUndefined();
  });

  it('charges an add-on once per order, per piece, and per position', async () => {
    const { product, rules } = await load('business-cards');
    const plain = engine.priceConfigured(product, rules, { quantity: 100, config: { card: 'std300' } });
    const spot = engine.priceConfigured(product, rules, { quantity: 100, config: { card: 'std300', lamination: 'matte', finishing: 'spotuv' } });
    // ₦14 each for 100 cards, plus an ₦8,000 setup, plus the matte lamination that spot UV needs.
    expect(spot.extrasKobo - plain.extrasKobo).toBeGreaterThanOrEqual(100 * 1400 + 800000);
    const { product: tees, rules: trules } = await load('tees-and-totes');
    const front = engine.priceConfigured(tees, trules, { quantity: 10, config: { positions: 'front' } });
    const both = engine.priceConfigured(tees, trules, { quantity: 10, config: { positions: 'front,back' } });
    expect(both.totalKobo - front.totalKobo).toBe(10 * 90000); // ₦900 per tee for the back print
  });

  it('lets a tee customer choose how many of each size and prices the total', async () => {
    const { product, rules } = await load('tees-and-totes');
    const p = engine.priceConfigured(product, rules, { quantity: 1, config: { tee_sizes: 'm:10,l:10,xxl:5', style: 'round', colour: 'white' } });
    expect(p.quantity).toBe(25);
    // XXL costs ₦500 more each.
    const flat = engine.priceConfigured(product, rules, { quantity: 1, config: { tee_sizes: 'm:10,l:10,s:5', style: 'round', colour: 'white' } });
    expect(p.totalKobo - flat.totalKobo).toBe(5 * 50000);
    expect(() => engine.priceConfigured(product, rules, { quantity: 1, config: { tee_sizes: '' } })).toThrow(/each size/);
  });

  it('picks screen print from 50 pieces unless the customer chooses heat transfer', async () => {
    const { product, rules } = await load('tees-and-totes');
    expect(engine.priceConfigured(product, rules, { quantity: 49 }).effective.method).toBe('heat');
    expect(engine.priceConfigured(product, rules, { quantity: 50 }).effective.method).toBe('screen');
    const forced = engine.priceConfigured(product, rules, { quantity: 50, config: { method: 'heat' } });
    expect(forced.effective.method).toBe('heat');
    // Screen print is cheaper per piece at 50.
    const screen = engine.priceConfigured(product, rules, { quantity: 50 });
    expect(screen.totalKobo).toBeLessThan(forced.totalKobo);
  });

  it('switches from tee to tote, with its own sizes, colours and prices', async () => {
    const { product, rules } = await load('tees-and-totes');
    const tote = engine.priceConfigured(product, rules, { quantity: 20, config: { item: 'tote', material: 'cotton' } });
    expect(tote.config.item).toBe('tote');
    expect(tote.config.colour).toBeUndefined();
    expect(tote.config.tote_colour).toBe('natural');
    expect(tote.quantity).toBe(20);
    const tee = engine.priceConfigured(product, rules, { quantity: 20 });
    expect(tote.totalKobo).toBeLessThan(tee.totalKobo);
  });

  it('prices roll-up banners by size and stand, and frames by size, glass and gold', async () => {
    const roll = await load('roll-up-banners');
    const big = engine.priceConfigured(roll.product, roll.rules, { quantity: 1, sizeKey: '150x200', config: { stand: 'double' } });
    const small = engine.priceConfigured(roll.product, roll.rules, { quantity: 1, sizeKey: '85x200', config: { stand: 'economy' } });
    expect(big.totalKobo).toBeGreaterThan(small.totalKobo);
    const fr = await load('picture-frames');
    const plain = engine.priceConfigured(fr.product, fr.rules, { quantity: 1, sizeKey: '12x16' });
    const gold = engine.priceConfigured(fr.product, fr.rules, { quantity: 1, sizeKey: '12x16', config: { frame: 'gold' } });
    const goldBig = engine.priceConfigured(fr.product, fr.rules, { quantity: 1, sizeKey: '24x36', config: { frame: 'gold' } });
    const plainBig = engine.priceConfigured(fr.product, fr.rules, { quantity: 1, sizeKey: '24x36' });
    expect(gold.totalKobo - plain.totalKobo).toBe(250000);
    expect(goldBig.totalKobo - plainBig.totalKobo).toBe(800000);
  });

  it('prices flex banners by the square foot with finishing by the foot', async () => {
    const { product, rules } = await load('flex-banners');
    const plain = engine.priceConfigured(product, rules, { quantity: 1, widthFt: 10, heightFt: 4 });
    const welded = engine.priceConfigured(product, rules, { quantity: 1, widthFt: 10, heightFt: 4, config: { finishing: 'welded' } });
    // Perimeter 28 ft at ₦60 a foot.
    expect(welded.totalKobo - plain.totalKobo).toBe(28 * 6000);
    const backlit = engine.priceConfigured(product, rules, { quantity: 1, widthFt: 10, heightFt: 4, config: { material: 'backlit' } });
    expect(backlit.totalKobo).toBe(40 * 130000);
  });
});

describe('the "What makes up this price" lines', () => {
  it('add up to the total on a busy order', async () => {
    const { product, rules } = await load('business-cards');
    const p = engine.priceConfigured(product, rules, { quantity: 250, config: { card: 'thick600', lamination: 'soft', finishing: 'round,foil_gold,edges', sides: 'one' } });
    expect(p.lines.reduce((a, l) => a + l.kobo, 0)).toBe(p.totalKobo);
    expect(p.lines.length).toBeGreaterThan(4);
    expect(p.lines[0].kind).toBe('base');
  });
});

describe('what a customer can pick on the product page', () => {
  it('keeps "Best for your quantity" on the list, and says which method it picked', async () => {
    const { product, rules } = await load('tees-and-totes');
    const a = engine.availabilityFor(product, rules, { quantity: 5 });
    expect(a.choices.method.auto.hide).toBe(false);
    expect(a.choices.method.auto.ok).toBe(true);
    const sel = engine.priceConfigured(product, rules, { quantity: 5 });
    expect(sel.effective.method).toBe('heat');
    expect(a.choices.method.screen.ok).toBe(false); // needs 50 or more
    expect(a.choices.method.screen.why).toMatch(/at least 50/);
  });

  it('lets a customer switch from a T-shirt to a tote, whose table has no neckline or fabric', async () => {
    const { product, rules } = await load('tees-and-totes');
    // Everything is a T-shirt choice at first (round neck, standard cotton). The tote must still be offered.
    const a = engine.availabilityFor(product, rules, { quantity: 10, config: { item: 'tee', style: 'round', fabric: 'standard' } });
    expect(a.choices.item.tote.ok, a.choices.item.tote.why ?? '').toBe(true);
    const tote = engine.priceConfigured(product, rules, { quantity: 10, config: { item: 'tote', style: 'round', fabric: 'standard' } });
    expect(tote.totalKobo).toBeGreaterThan(0);
  });

  it('only offers a choice at a quantity where it has a price', async () => {
    const { product, rules } = await load('business-cards');
    for (const q of [50, 100, 250, 1000]) {
      const a = engine.availabilityFor(product, rules, { quantity: q });
      expect(a.quantities).toContain(q);
    }
  });
});
