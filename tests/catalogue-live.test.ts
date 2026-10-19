import { beforeAll, describe, expect, it } from 'vitest';

// The real site: only the prices the shop really has. Nothing invented may reach a customer.
process.env.PGLITE_DIR = 'memory';
process.env.DEMO_MODE = 'false';
delete process.env.APP_ENV;
process.env.SESSION_SECRET = 'a-long-random-secret-for-the-catalogue-test-1234567890';
process.env.ADMIN_EMAIL = 'owner@brandit.ng';
process.env.ADMIN_PIN = '481926';

let db: typeof import('../lib/db');
let catalog: typeof import('../lib/catalog');
let engine: typeof import('../lib/priceEngine');
let install: typeof import('../lib/catalogueInstall');
let pricing: typeof import('../lib/pricing');

const load = async (slug: string) => {
  const product = (await catalog.getProduct(slug))!;
  const rules = (await catalog.getRules(product.id)).price;
  return { product, rules };
};
const naira = (k: number) => k / 100;

beforeAll(async () => {
  db = await import('../lib/db');
  catalog = await import('../lib/catalog');
  engine = await import('../lib/priceEngine');
  install = await import('../lib/catalogueInstall');
  pricing = await import('../lib/pricing');
  await db.ready();
});

describe('a new real site', () => {
  it('has all nine products, and Tees and Totes is one of them', async () => {
    const all = await catalog.listProducts(true);
    expect(all.filter((p) => !p.sample).map((p) => p.slug)).toEqual(['business-cards', 'flyers', 'posters', 'roll-up-banners', 'flex-banners', 'stickers', 'tees-and-totes', 'id-cards', 'picture-frames']);
    // The sample pack is there too, but off and with no price until the owner sets one: it cannot be sold by accident.
    const sample = all.find((p) => p.sample)!;
    expect(sample.slug).toBe('sample-pack');
    expect(sample.active).toBe(false);
    expect(await db.query('select 1 from price_rules where product_id = $1', [sample.id])).toHaveLength(0);
    expect((await catalog.listProducts()).map((p) => p.slug)).not.toContain('sample-pack');
  });

  it('holds only the prices the shop really has', async () => {
    const rows = await db.query<any>('select p.slug, r.quantity, r.size_key, r.price_kobo, r.rate_per_sqft_kobo, r.config, r.provisional from price_rules r join products p on p.id = r.product_id order by p.slug');
    expect(rows.every((r) => r.provisional === false)).toBe(true);
    const by = Object.fromEntries(rows.map((r) => [`${r.slug}:${r.quantity ?? ''}:${r.size_key ?? ''}`, r]));
    expect(naira(by['business-cards:100:'].price_kobo)).toBe(15000);
    expect(naira(by['flyers:100:'].price_kobo)).toBe(25500);
    expect(naira(by['posters:100:'].price_kobo)).toBe(58000);
    expect(naira(by['stickers:100:'].price_kobo)).toBe(17000);
    expect(naira(by['roll-up-banners::85x200'].price_kobo)).toBe(68500);
    expect(naira(by['flex-banners::'].rate_per_sqft_kobo)).toBe(700);
    expect(naira(by['tees-and-totes:1:'].price_kobo)).toBe(7000);
    expect(naira(by['id-cards:1:'].price_kobo)).toBe(4500);
    expect(['8x10', '12x16', '16x20', '20x24', '24x36'].map((k) => naira(by[`picture-frames::${k}`].price_kobo))).toEqual([11000, 16000, 22000, 38000, 56000]);
    expect(rows.length).toBe(1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 5);
  });

  it('keeps every add-on that has no real price off the shop', async () => {
    for (const p of await catalog.listProducts(true)) {
      for (const o of p.options) for (const c of o.choices) {
        if (c.extra_kobo || c.setup_kobo || c.percent || Object.keys(c.by?.amounts ?? {}).length) throw new Error(`${p.slug} ${o.key}:${c.value} carries a price on the real site`);
      }
      const shown = engine.publicOptions(p.options);
      for (const o of shown) for (const c of o.choices) expect((c as any).unpriced, `${p.slug} ${o.key}:${c.value}`).toBeFalsy();
    }
    const cards = (await load('business-cards')).product;
    const shown = engine.publicOptions(cards.options);
    expect(shown.find((o) => o.key === 'finishing')?.choices ?? []).toEqual([]);
    expect(shown.find((o) => o.key === 'sides')?.choices.map((c) => c.value)).toEqual(['both']);
  });

  it('prices each product at its real price', async () => {
    const cards = await load('business-cards');
    expect(naira(engine.priceConfigured(cards.product, cards.rules, { quantity: 100 }).totalKobo)).toBe(15000);
    const fly = await load('flyers');
    expect(naira(engine.priceConfigured(fly.product, fly.rules, { quantity: 100 }).totalKobo)).toBe(25500);
    const posters = await load('posters');
    expect(naira(engine.priceConfigured(posters.product, posters.rules, { quantity: 100 }).totalKobo)).toBe(58000);
    const stick = await load('stickers');
    expect(naira(engine.priceConfigured(stick.product, stick.rules, { quantity: 100 }).totalKobo)).toBe(17000);
    const roll = await load('roll-up-banners');
    expect(naira(engine.priceConfigured(roll.product, roll.rules, { quantity: 1 }).totalKobo)).toBe(68500);
    const flex = await load('flex-banners');
    expect(naira(engine.priceConfigured(flex.product, flex.rules, { quantity: 1, widthFt: 6, heightFt: 3 }).totalKobo)).toBe(18 * 700);
    expect(naira(engine.priceConfigured(flex.product, flex.rules, { quantity: 1, widthFt: 2, heightFt: 2 }).totalKobo)).toBe(10 * 700); // the 10 sq ft minimum
    const id = await load('id-cards');
    expect(naira(engine.priceConfigured(id.product, id.rules, { quantity: 1 }).totalKobo)).toBe(4500);
    const fr = await load('picture-frames');
    expect(naira(engine.priceConfigured(fr.product, fr.rules, { quantity: 1, sizeKey: '16x20' }).totalKobo)).toBe(22000);
  });

  it('sells a pack of 100 cards as a pack, not as any quantity at an unconfirmed price', async () => {
    const { product, rules } = await load('business-cards');
    for (const q of [50, 99, 101, 500, 5000]) {
      expect(() => engine.priceConfigured(product, rules, { quantity: q }), `qty ${q}`).toThrow(pricing.PriceError);
    }
    const av = engine.availabilityFor(product, rules, { quantity: 100 });
    expect(av.quantities).toEqual([100]);
  });

  it('prices tees and ID cards by the piece at the confirmed price, in any quantity', async () => {
    const tees = await load('tees-and-totes');
    // Sizes not given: the usual mix is scaled to the quantity.
    const ten = engine.priceConfigured(tees.product, tees.rules, { quantity: 10 });
    expect(ten.quantity).toBe(10);
    expect(naira(ten.totalKobo)).toBe(70000);
    // "Best for your quantity" would choose screen print from 50, but there is no screen price, so heat transfer stands.
    const sixty = engine.priceConfigured(tees.product, tees.rules, { quantity: 60 });
    expect(sixty.effective.method).toBe('heat');
    expect(naira(sixty.totalKobo)).toBe(420000);
    const id = await load('id-cards');
    expect(naira(engine.priceConfigured(id.product, id.rules, { quantity: 25 }).totalKobo)).toBe(112500);
  });

  it('does not offer a tote bag or a V-neck, which have no real price', async () => {
    const tees = await load('tees-and-totes');
    const av = engine.availabilityFor(tees.product, tees.rules, { quantity: 10 });
    expect(av.choices.item?.tote?.hide).toBe(true);
    expect(av.choices.style?.vneck?.hide).toBe(true);
    // Asking for one anyway (an old link, a script) gets the tee, with a plain sentence saying so.
    const tote = engine.priceConfigured(tees.product, tees.rules, { quantity: 10, config: { item: 'tote' } });
    expect(tote.effective.item).toBe('tee');
    expect(tote.notes.join(' ')).toMatch(/Tote bag is not available right now/);
    expect(naira(tote.totalKobo)).toBe(70000);
  });

  it('shows a real "from" price for every product', async () => {
    const from = async (slug: string) => {
      const { product, rules } = await load(slug);
      return engine.fromPrice(product, rules);
    };
    expect(naira((await from('business-cards')).kobo!)).toBe(15000);
    expect((await from('flex-banners')).ratePerSqft).toBe(70000);
    expect(naira((await from('picture-frames')).kobo!)).toBe(11000);
  });

  it('cannot load example prices on the real site', async () => {
    await expect(install.loadExamples({ query: db.query, tx: db.tx })).rejects.toThrow(/private test site/);
    await expect(install.clearExamples({ query: db.query, tx: db.tx })).rejects.toThrow(/private test site/);
  });

  it('loads and clears example prices on the private test site, leaving the real prices alone', async () => {
    const staging = { ...process.env, APP_ENV: 'staging' } as NodeJS.ProcessEnv;
    const before = await db.query<any>("select count(*)::int as n from price_rules where not provisional");
    const added = await install.loadExamples({ query: db.query, tx: db.tx }, staging);
    expect(added.cells).toBeGreaterThan(100);
    expect(added.choices).toBeGreaterThan(40);
    expect((await db.query<any>('select count(*)::int as n from price_rules where not provisional'))[0].n).toBe(before[0].n);

    // Now the tote bag, the V-neck and screen printing can be priced.
    const tees = await load('tees-and-totes');
    const screen = engine.priceConfigured(tees.product, tees.rules, { quantity: 60 });
    expect(screen.effective.method).toBe('screen');
    const tote = engine.priceConfigured(tees.product, tees.rules, { quantity: 10, config: { item: 'tote' } });
    expect(tote.effective.item).toBe('tote');
    expect(tote.notes).toEqual([]);
    // Real prices are still real: a plain tee at one piece is ₦7,000.
    expect(naira(engine.priceConfigured(tees.product, tees.rules, { quantity: 1 }).totalKobo)).toBe(7000);

    // Loading twice changes nothing.
    const again = await install.loadExamples({ query: db.query, tx: db.tx }, staging);
    expect(again).toEqual({ cells: 0, choices: 0 });

    const cleared = await install.clearExamples({ query: db.query, tx: db.tx }, staging);
    expect(cleared.cells).toBe(added.cells);
    expect(cleared.choices).toBe(added.choices);
    expect((await db.query<any>('select count(*)::int as n from price_rules where provisional'))[0].n).toBe(0);
    expect(await install.exampleCounts(db)).toEqual({ cells: 0, choices: 0 });
    const back = await load('tees-and-totes');
    expect(naira(engine.priceConfigured(back.product, back.rules, { quantity: 60 }).totalKobo)).toBe(420000);
  });
});

describe('upgrading a site that is on the old catalogue', () => {
  it('keeps the team’s prices and words, drops invented prices, renames the tees, and runs only once', async () => {
    // Put the database back the way version 1 left it, with the team's own edits.
    const id = async (slug: string) => (await db.one<any>('select id from products where slug = $1', [slug]))!.id as string;
    const cards = await id('business-cards');
    await db.query("update products set name = 'Cards by Kalu', packages = '[]', qty_custom = false, qty_min = null, qty_max = null, options = $2 where id = $1", [cards, JSON.stringify([{ key: 'finish', label: 'Finish', default: 'matte', choices: [{ value: 'matte', label: 'Matte' }, { value: 'gloss', label: 'Gloss' }] }])]);
    await db.query('delete from price_rules where product_id = $1', [cards]);
    await db.query("insert into price_rules (product_id, quantity, price_kobo, provisional, active) values ($1, 100, 1600000, false, true), ($1, 250, 3750000, true, false)", [cards]);

    const tees = await id('tees-and-totes');
    await db.query("update products set slug = 'branded-t-shirts', name = 'Branded T-shirts', pricing_mode = 'size', sizes = $2, options = '[]', packages = '[]', qty_custom = false, description = 'old words' where id = $1", [tees, JSON.stringify([{ key: 'each', label: 'Front print, A4', w_in: 8.3, h_in: 11.7 }])]);
    await db.query('delete from price_rules where product_id = $1', [tees]);
    await db.query("insert into price_rules (product_id, size_key, price_kobo, provisional, active) values ($1, 'each', 750000, false, true)", [tees]);

    const ids = await id('id-cards');
    await db.query("update products set pricing_mode = 'size', sizes = $2, options = '[]', qty_custom = false where id = $1", [ids, JSON.stringify([{ key: 'each', label: 'PVC card, landscape', w_in: 3.37, h_in: 2.13 }])]);
    await db.query('delete from price_rules where product_id = $1', [ids]);
    await db.query("insert into price_rules (product_id, size_key, price_kobo, provisional, active) values ($1, 'each', 450000, false, true)", [ids]);

    const flex = await id('flex-banners');
    await db.query("update price_rules set rate_per_sqft_kobo = 80000, config = '{}' where product_id = $1", [flex]);
    await db.query("delete from settings where key = 'catalogue_version'");

    await install.upgradeCatalogue({ query: db.query, tx: db.tx });

    // The team's price and name stay; the invented 250 price is gone.
    const c = await load('business-cards');
    expect(c.product.name).toBe('Cards by Kalu');
    expect(c.product.options.map((o) => o.key)).toEqual(['card', 'sides', 'lamination', 'finishing']);
    expect(c.product.packages.length).toBe(3);
    expect(c.rules.map((r) => [r.quantity, r.price_kobo, r.config])).toEqual([[100, 1600000, { card: 'std300' }]]);

    // Tees: same product, new name and slug, the old ₦7,500 price kept as the one-piece price.
    const t = await load('tees-and-totes');
    expect(t.product.id).toBe(tees);
    expect(t.product.name).toBe('Tees and Totes');
    expect(t.product.pricing_mode).toBe('tier');
    expect(t.product.description).not.toBe('old words');
    expect(t.rules.map((r) => [r.quantity, r.price_kobo, r.config])).toEqual([[1, 750000, { item: 'tee', style: 'round', method: 'heat' }]]);
    expect(await catalog.getProduct('branded-t-shirts')).toBeNull();

    // ID cards changed from "size" to "tier" and kept their price.
    const i = await load('id-cards');
    expect(i.product.pricing_mode).toBe('tier');
    expect(i.rules.map((r) => [r.quantity, r.price_kobo])).toEqual([[1, 450000]]);

    // The flex rate the team changed stays, and a rule still carries the 10 sq ft minimum.
    const f = await load('flex-banners');
    expect(f.rules.map((r) => [r.rate_per_sqft_kobo, r.config])).toEqual([[80000, { material: 'standard' }]]);

    const hist = await db.query<any>("select summary, detail from price_history where kind = 'catalogue'");
    expect(hist.length).toBe(1);
    expect(hist[0].detail['business-cards']).toMatchObject({ kept: 1, dropped: 1 });

    // A second start does nothing.
    const before = (await db.query<any>('select count(*)::int as n from price_rules'))[0].n;
    await install.upgradeCatalogue({ query: db.query, tx: db.tx });
    expect((await db.query<any>('select count(*)::int as n from price_rules'))[0].n).toBe(before);
    expect((await db.query<any>("select count(*)::int as n from price_history where kind = 'catalogue'"))[0].n).toBe(1);
  });

  it('adds a product that an old site never had', async () => {
    await db.query("delete from settings where key = 'catalogue_version'");
    const tees = (await db.one<any>("select id from products where slug = 'tees-and-totes'"))!.id;
    await db.query('delete from templates where product_id = $1', [tees]);
    await db.query('delete from promise_rules where product_id = $1', [tees]);
    await db.query('delete from price_rules where product_id = $1', [tees]);
    await db.query('delete from products where id = $1', [tees]);
    await install.upgradeCatalogue({ query: db.query, tx: db.tx });
    const t = await load('tees-and-totes');
    expect(t.rules.length).toBe(1);
    expect(naira(t.rules[0].price_kobo!)).toBe(7000);
  });
});
