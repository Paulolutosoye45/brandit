import { beforeAll, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';

process.env.PGLITE_DIR = 'memory';
process.env.DEMO_MODE = 'true';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-search-${process.pid}`);

let db: typeof import('../lib/db');
let Cat: typeof import('../lib/catalog');
let S: typeof import('../lib/searchTerms');
let Schema: typeof import('../lib/schema');

beforeAll(async () => {
  db = await import('../lib/db');
  await db.ready();
  Cat = await import('../lib/catalog');
  S = await import('../lib/searchTerms');
  Schema = await import('../lib/schema');
}, 120_000);

describe('product groups', () => {
  it('a fresh shop has the six groups, in the usual order, and the sample pack is in none of them', async () => {
    const cards = await Cat.listCatalog(false, true);
    const cats = Cat.categoriesOf(cards.filter((c) => !c.product.sample));
    expect(cats).toEqual(['Cards and stationery', 'Marketing prints', 'Banners and signs', 'Tees and Totes', 'Frames and gifts', 'IDs and events']);
    const sample = cards.find((c) => c.product.sample)!;
    expect(sample.product.category).toBe('');
  });

  it('a group the team adds comes after the usual ones', () => {
    const mk = (category: string) => ({ product: { category } as any });
    expect(Cat.categoriesOf([mk('Zebra gifts'), mk('IDs and events'), mk('Cards and stationery')])).toEqual(['Cards and stationery', 'IDs and events', 'Zebra gifts']);
  });

  it('migration 013 renames only the names the catalogue itself gave', async () => {
    const m = Schema.MIGRATIONS.find((x) => x.id === '013_categories')!;
    expect(m).toBeTruthy();
    await db.query("update products set category = 'Stickers and merch' where slug in ('stickers', 'tees-and-totes')");
    await db.query("update products set category = 'Flyers and posters' where slug in ('flyers')");
    await db.query("update products set category = 'Cards' where slug in ('business-cards', 'id-cards')");
    await db.query("update products set category = 'Frames and photos' where slug = 'picture-frames'");
    await db.query("update products set category = 'Our own name' where slug = 'posters'");
    for (const stmt of m.sql.split('\n').filter((l) => !l.startsWith('--')).join('\n').split(';').map((x) => x.trim()).filter(Boolean)) await db.query(stmt);
    const rows = await db.query<{ slug: string; category: string }>('select slug, category from products where slug in (\'stickers\',\'tees-and-totes\',\'flyers\',\'posters\',\'business-cards\',\'id-cards\',\'picture-frames\')');
    const by = Object.fromEntries(rows.map((r) => [r.slug, r.category]));
    expect(by).toMatchObject({ stickers: 'Marketing prints', 'tees-and-totes': 'Tees and Totes', flyers: 'Marketing prints', 'business-cards': 'Cards and stationery', 'id-cards': 'IDs and events', 'picture-frames': 'Frames and gifts' });
    expect(by.posters).toBe('Our own name'); // a name the team typed is left alone
  });
});

describe('search', () => {
  const find = (q: string) => Object.keys(WORDS_PRODUCTS).filter((slug) => S.matches(S.haystack(WORDS_PRODUCTS[slug]), q));
  const WORDS_PRODUCTS: Record<string, { slug: string; name: string; blurb: string; category: string }> = {
    'business-cards': { slug: 'business-cards', name: 'Business cards', blurb: 'Thick cards', category: 'Cards and stationery' },
    flyers: { slug: 'flyers', name: 'Flyers', blurb: 'A5 flyers', category: 'Marketing prints' },
    'flex-banners': { slug: 'flex-banners', name: 'Flex banners', blurb: 'Outdoor banners', category: 'Banners and signs' },
    'roll-up-banners': { slug: 'roll-up-banners', name: 'Roll-up banners', blurb: 'Stand', category: 'Banners and signs' },
    'id-cards': { slug: 'id-cards', name: 'ID cards', blurb: 'PVC cards', category: 'IDs and events' },
    'tees-and-totes': { slug: 'tees-and-totes', name: 'Tees and totes', blurb: 'Printed', category: 'Tees and Totes' },
  };

  it('finds things the way people ask for them', () => {
    expect(find('church programme')).toContain('flyers');
    expect(find('church banner')).toEqual(['flex-banners']);
    expect(find('name tag')).toEqual(['id-cards']);
    expect(find('staff badge')).toEqual(['id-cards']);
    expect(find('t-shirt')).toEqual(['tees-and-totes']);
    expect(find('visiting card')).toContain('business-cards');
  });

  it('a plural or capital letters make no difference, and an empty search matches everything', () => {
    expect(find('FLYER')).toEqual(find('flyers'));
    expect(find('banners').sort()).toEqual(['flex-banners', 'roll-up-banners']);
    expect(find('')).toHaveLength(Object.keys(WORDS_PRODUCTS).length);
  });

  it('every typed word has to match, so a wrong word finds nothing instead of everything', () => {
    expect(find('flyers submarine')).toEqual([]);
  });
});
