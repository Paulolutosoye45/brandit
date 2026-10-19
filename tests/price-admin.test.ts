import { beforeAll, describe, expect, it } from 'vitest';

process.env.PGLITE_DIR = 'memory';
process.env.DEMO_MODE = 'true';
delete process.env.APP_ENV;
process.env.SESSION_SECRET = 'a-long-random-secret-for-the-price-admin-1234567890';

let db: typeof import('../lib/db');
let admin: typeof import('../lib/priceAdmin');
let grid: typeof import('../lib/priceGrid');
let catalog: typeof import('../lib/catalog');
let engine: typeof import('../lib/priceEngine');
let orders: typeof import('../lib/orders');

const actor = { id: null, name: 'Ada (Admin)' };
const idOf = async (slug: string) => (await db.one<any>('select id from products where slug = $1', [slug]))!.id as string;
const cellsOf = (g: Awaited<ReturnType<typeof admin.loadGrid>>) => {
  const out: import('../lib/priceAdmin').SaveCellIn[] = [];
  for (const r of g.rows) for (const c of g.cols) {
    const x = g.cells[`${r.id}|${c.id}`];
    out.push({ row: r.id, col: c.id, price: x?.price != null ? String(x.price / 100) : '', cost: x?.cost != null ? String(x.cost / 100) : '' });
  }
  return out;
};
const quantitiesOf = (g: Awaited<ReturnType<typeof admin.loadGrid>>) => g.cols.map((c) => c.quantity!);

beforeAll(async () => {
  db = await import('../lib/db');
  admin = await import('../lib/priceAdmin');
  grid = await import('../lib/priceGrid');
  catalog = await import('../lib/catalog');
  engine = await import('../lib/priceEngine');
  orders = await import('../lib/orders');
  await db.ready();
});

describe('typing and pasting prices', () => {
  it('reads what people type', () => {
    expect(grid.parseNaira('15000')).toBe(1500000);
    expect(grid.parseNaira('₦15,000')).toBe(1500000);
    expect(grid.parseNaira(' N 15,000.50 '.replace(' ', ''))).toBe(1500050);
    expect(grid.parseNaira('')).toBeNull();
    expect(grid.parseNaira('—')).toBeNull();
    expect(grid.parseNaira('abc')).toBeUndefined();
    expect(grid.parseNaira('12.345')).toBeUndefined();
    expect(grid.parseNaira('-5')).toBeUndefined();
  });
  it('cuts pasted Excel text into rows and cells', () => {
    expect(grid.parsePaste('1,000\t2,000\r\n3,000\t4,000\r\n')).toEqual([['1,000', '2,000'], ['3,000', '4,000']]);
    expect(grid.parsePaste('"15,000"\t\t9000')).toEqual([['15,000', '', '9000']]);
  });
  it('applies a bulk rise or fall and rounds it', () => {
    expect(grid.applyBulk(1500000, { mode: 'percent', value: 10, round: '500' })).toBe(1650000);
    expect(grid.applyBulk(1234500, { mode: 'percent', value: 10, round: '500' })).toBe(1358000 - 8000 + 0 || 0);
    expect(grid.applyBulk(1500000, { mode: 'amount', value: -2000, round: 'none' })).toBe(1300000);
    expect(grid.applyBulk(null, { mode: 'percent', value: 10, round: '100' })).toBeNull();
    expect(grid.applyBulk(500, { mode: 'amount', value: -9999, round: 'none' })).toBe(100); // never below ₦1
  });
  it('works out margins and a price for a target', () => {
    expect(grid.marginOf(10000, 6000, 40)).toEqual({ pct: 40, level: 'ok' });
    expect(grid.marginOf(10000, 7000, 40)).toEqual({ pct: 30, level: 'thin' });
    expect(grid.marginOf(10000, 12000, 40)?.level).toBe('loss');
    expect(grid.marginOf(10000, null, 40)).toBeNull();
    expect(grid.priceForMargin(600000, 40)).toBe(1000000);
  });
});

describe('the grid', () => {
  it('has one row for each combination that picks a price table', async () => {
    const flyers = await catalog.getProduct('flyers');
    const rows = grid.gridRows(flyers!.options);
    expect(rows.length).toBe(4 * 5); // 150gsm matte shares the gloss table
    expect(rows[0].label).toBe('A6 · 115gsm gloss (budget)');
    const tees = await catalog.getProduct('tees-and-totes');
    const t = grid.gridRows(tees!.options);
    expect(t.length).toBe(3 * 2 + 3 * 2);
    expect(t.some((r) => r.config.item === 'tote' && r.config.style !== undefined)).toBe(false);
    expect(t.some((r) => r.config.item === 'tee' && r.config.material !== undefined)).toBe(false);
    const cards = await catalog.getProduct('business-cards');
    expect(grid.gridRows(cards!.options).length).toBe(6);
    const flex = await catalog.getProduct('flex-banners');
    expect(grid.gridRows(flex!.options).length).toBe(4);
    const frames = await catalog.getProduct('picture-frames');
    expect(grid.gridRows(frames!.options).length).toBe(2);
  });

  it('loads cells, marks the placeholders, and keeps the real prices real', async () => {
    const g = await admin.loadGrid(await idOf('business-cards'));
    expect(g.rows.length).toBe(6);
    expect(quantitiesOf(g)).toEqual([50, 100, 200, 250, 500, 1000]);
    const std = g.rows.find((r) => r.config.card === 'std300')!;
    const real = g.cells[`${std.id}|q:100`];
    expect(real.price).toBe(1500000);
    expect(real.placeholder).toBe(false);
    expect(g.cells[`${std.id}|q:500`].placeholder).toBe(true);
    expect(g.orphans).toEqual([]);
  });

  it('saves a change that customers see at once, keeps a history, and confirms the placeholder', async () => {
    const id = await idOf('business-cards');
    const g = await admin.loadGrid(id);
    const std = g.rows.find((r) => r.config.card === 'std300')!;
    const cells = cellsOf(g);
    const target = cells.find((c) => c.row === std.id && c.col === 'q:500')!;
    const before = target.price;
    target.price = '65,000';
    const report = await admin.saveGrid(id, { quantities: quantitiesOf(g), cells }, actor);
    expect(report.changed).toBe(1);
    expect(report.summary).toMatch(/1 price changed/);
    const p = (await catalog.getProductById(id))!;
    const rules = (await catalog.getRules(id)).price;
    expect(engine.priceConfigured(p, rules, { quantity: 500 }).totalKobo).toBe(6500000);
    const after = await admin.loadGrid(id);
    expect(after.cells[`${std.id}|q:500`].placeholder).toBe(false);
    const hist = await admin.priceHistory({ productId: id });
    expect(hist[0].actor).toBe('Ada (Admin)');
    expect(hist[0].detail.cells[0]).toMatchObject({ was: `₦${Number(before).toLocaleString('en-US')}`, now: '₦65,000' });
    // Saving the same thing again changes nothing and says so without adding a history line.
    const again = await admin.saveGrid(id, { quantities: quantitiesOf(after), cells: cellsOf(after) }, actor);
    expect(again.changed + again.added + again.removed).toBe(0);
    expect((await admin.priceHistory({ productId: id })).length).toBe(hist.length);
  });

  it('confirming a placeholder at the same price counts as a confirmation, not a change', async () => {
    const id = await idOf('business-cards');
    const g = await admin.loadGrid(id);
    const lin = g.rows.find((r) => r.config.card === 'linen')!;
    expect(g.cells[`${lin.id}|q:100`].placeholder).toBe(true);
    // Saving the cell without saying it is real leaves the placeholder alone...
    const quiet = await admin.saveGrid(id, { quantities: quantitiesOf(g), cells: cellsOf(g) }, actor);
    expect(quiet.changed + quiet.confirmed + quiet.added + quiet.removed).toBe(0);
    expect((await admin.loadGrid(id)).cells[`${lin.id}|q:100`].placeholder).toBe(true);
    // ...and typing in it (even the same number) makes it real.
    const r = await admin.saveGrid(id, { quantities: quantitiesOf(g), cells: cellsOf(g).filter((c) => c.row === lin.id && c.col === 'q:100').map((c) => ({ ...c, confirm: true })) }, actor);
    expect(r).toMatchObject({ changed: 0, confirmed: 1 });
    expect(r.summary).toMatch(/1 placeholder confirmed/);
    expect((await admin.loadGrid(id)).cells[`${lin.id}|q:100`].placeholder).toBe(false);
  });

  it('refuses a typo and saves nothing at all', async () => {
    const id = await idOf('flyers');
    const g = await admin.loadGrid(id);
    const cells = cellsOf(g);
    cells[0].price = '15,000';
    cells[1].price = '1o,000';
    const was = await db.query<any>('select price_kobo from price_rules where product_id = $1 order by id', [id]);
    await expect(admin.saveGrid(id, { quantities: quantitiesOf(g), cells }, actor)).rejects.toThrow(/"1o,000" is not a price/);
    const now = await db.query<any>('select price_kobo from price_rules where product_id = $1 order by id', [id]);
    expect(now).toEqual(was);
    cells[1].price = '99999999999';
    await expect(admin.saveGrid(id, { quantities: quantitiesOf(g), cells }, actor)).rejects.toThrow(/looks like a typo/);
  });

  it('removes a price when the box is emptied, and a column when it is taken away', async () => {
    const id = await idOf('stickers');
    const g = await admin.loadGrid(id);
    const cells = cellsOf(g);
    const emptied = cells.find((c) => c.col === 'q:100')!;
    emptied.price = '';
    const keep = quantitiesOf(g).filter((q) => q !== 5000);
    const r = await admin.saveGrid(id, { quantities: keep, cells: cells.filter((c) => c.col !== 'q:5000') }, actor);
    expect(r.removed).toBeGreaterThan(1);
    const after = await admin.loadGrid(id);
    expect(quantitiesOf(after)).not.toContain(5000);
    expect(after.cells[`${emptied.row}|q:100`]).toBeUndefined();
  });

  it('adds a new quantity column', async () => {
    const id = await idOf('id-cards');
    const g = await admin.loadGrid(id);
    const row = g.rows[0];
    const cells = cellsOf(g);
    cells.push({ row: row.id, col: 'q:750', price: '1,500,000', cost: '' });
    const r = await admin.saveGrid(id, { quantities: [...quantitiesOf(g), 750], cells }, actor);
    expect(r.added).toBe(1);
    expect(quantitiesOf(await admin.loadGrid(id))).toContain(750);
    await expect(admin.saveGrid(id, { quantities: [10, 10], cells: [] }, actor)).rejects.toThrow(/appears twice/);
    await expect(admin.saveGrid(id, { quantities: [0], cells: [] }, actor)).rejects.toThrow(/between 1 and 10,000/);
  });

  it('keeps a cost that is entered before the price, off the shop', async () => {
    const id = await idOf('posters');
    const g = await admin.loadGrid(id);
    const a0 = g.rows.find((r) => r.config.size === 'a0')!;
    const cells = cellsOf(g).map((c) => (c.row === a0.id && c.col === 'q:5' ? { ...c, price: '', cost: '90,000' } : c));
    const r = await admin.saveGrid(id, { quantities: quantitiesOf(g), cells }, actor);
    expect(r.changed).toBe(1); // the example price was taken away; the cost stays
    const rule = await db.one<any>("select price_kobo, cost_kobo, active from price_rules where product_id = $1 and quantity = 5 and config = $2", [id, JSON.stringify({ size: 'a0' })]);
    expect(rule).toMatchObject({ price_kobo: null, cost_kobo: 9000000, active: false });
    const p = (await catalog.getProductById(id))!;
    const rules = (await catalog.getRules(id)).price;
    expect(engine.availabilityFor(p, rules, { quantity: 1 }).quantities).toBeTruthy();
    expect(() => engine.priceConfigured(p, rules, { quantity: 5, config: { size: 'a0' } })).not.toThrow(); // other steps still price (5 is between 1 and 10)
  });

  it('warns about a price below its cost, and works out margins from the cost', async () => {
    const id = await idOf('flyers');
    const g = await admin.loadGrid(id);
    const row = g.rows.find((r) => r.config.size === 'a5' && r.config.paper === 'g150')!;
    const cells = cellsOf(g).map((c) => (c.row === row.id && c.col === 'q:100' ? { ...c, cost: '30,000' } : c));
    const r = await admin.saveGrid(id, { quantities: quantitiesOf(g), cells }, actor);
    expect(r.belowCost.length).toBe(1);
    const t = await admin.tryPrice(id, { quantity: 100 });
    expect(t.ok && t.priced.costKobo).toBe(3000000);
    expect(t.ok && t.margin?.level).toBe('loss');
    expect(t.ok && t.suggested).toBeGreaterThan(3000000);
  });

  it('confirms placeholders and lists the stray prices', async () => {
    const id = await idOf('roll-up-banners');
    expect((await db.one<any>('select count(*)::int as n from price_rules where product_id = $1 and provisional', [id]))!.n).toBeGreaterThan(0);
    const n = await admin.confirmPlaceholders(id, actor);
    expect(n).toBeGreaterThan(0);
    expect((await db.one<any>('select count(*)::int as n from price_rules where product_id = $1 and provisional', [id]))!.n).toBe(0);
    const p = (await catalog.getProductById(id))!;
    expect(p.options.every((o) => o.choices.every((c) => !c.provisional))).toBe(true);

    // A price whose choice no longer exists.
    await db.query("insert into price_rules (product_id, config, size_key, price_kobo, provisional) values ($1, $2, '85x200', 1000, false)", [id, JSON.stringify({ stand: 'gone' })]);
    const g = await admin.loadGrid(id);
    expect(g.orphans.length).toBe(1);
    expect(g.orphans[0].label).toBe('stand=gone');
    expect(await admin.removeStray(id, g.orphans.map((o) => o.id), actor)).toBe(1);
    expect((await admin.loadGrid(id)).orphans).toEqual([]);
  });

  it('saves a flex banner rate with its minimum and cost per square foot', async () => {
    const id = await idOf('flex-banners');
    const g = await admin.loadGrid(id);
    expect(g.area).not.toBeNull();
    const row = g.rows.find((r) => r.config.material === 'standard')!;
    const r = await admin.saveGrid(id, { cells: [{ row: row.id, col: 'a', price: '750', cost: '400', min: '8' }] }, actor);
    expect(r.changed).toBe(1);
    const a = (await admin.loadGrid(id)).area![row.id];
    expect(a).toMatchObject({ rate: 75000, cost: 40000, minArea: 8, placeholder: false });
    const p = (await catalog.getProductById(id))!;
    const rules = (await catalog.getRules(id)).price;
    expect(engine.priceConfigured(p, rules, { quantity: 1, widthFt: 2, heightFt: 2 }).totalKobo).toBe(8 * 75000);
    await expect(admin.saveGrid(id, { cells: [{ row: row.id, col: 'a', price: '750', cost: '', min: '-3' }] }, actor)).rejects.toThrow(/smallest area/);
  });
});

describe('prices and orders already placed', () => {
  it('a placed order keeps its price when the price changes afterwards', async () => {
    const id = await idOf('business-cards');
    const draft: any = await orders.createDraft({ slug: 'business-cards', quantity: 100, area: 'Yaba' });
    expect(draft.error).toBeUndefined();
    const item = (await db.one<any>('select line_total_kobo from order_items where order_id = $1', [draft.id]))!;
    const g = await admin.loadGrid(id);
    const std = g.rows.find((r) => r.config.card === 'std300')!;
    const cells = cellsOf(g).map((c) => (c.row === std.id && c.col === 'q:100' ? { ...c, price: '99,000' } : c));
    await admin.saveGrid(id, { quantities: quantitiesOf(g), cells }, actor);
    const again = (await db.one<any>('select line_total_kobo from order_items where order_id = $1', [draft.id]))!;
    expect(again.line_total_kobo).toBe(item.line_total_kobo);
    const fresh: any = await orders.createDraft({ slug: 'business-cards', quantity: 100, area: 'Yaba' });
    const newItem = (await db.one<any>('select line_total_kobo from order_items where order_id = $1', [fresh.id]))!;
    expect(newItem.line_total_kobo).toBe(9900000);
  });
});

describe('try a price', () => {
  it('prices a choice that is not on sale yet, for the console only', async () => {
    const id = await idOf('tees-and-totes');
    const t = await admin.tryPrice(id, { quantity: 10, config: { positions: 'front,back' } });
    expect(t.ok).toBe(true);
    if (t.ok) {
      expect(t.priced.lines.some((l) => l.label.includes('Back'))).toBe(true);
      expect(t.packages.length).toBeGreaterThan(0);
    }
    const bad = await admin.tryPrice(await idOf('business-cards'), { quantity: 7 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/smallest order|do not have a price/);
  });
});
