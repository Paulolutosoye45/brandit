import { beforeAll, describe, expect, it } from 'vitest';
import { crc32, deflateRawSync } from 'node:zlib';

process.env.PGLITE_DIR = 'memory';
process.env.DEMO_MODE = 'true';
delete process.env.APP_ENV;
process.env.SESSION_SECRET = 'a-long-random-secret-for-the-price-sheet-1234567890';

let db: typeof import('../lib/db');
let sheet: typeof import('../lib/priceSheet');
let admin: typeof import('../lib/priceAdmin');
let catalog: typeof import('../lib/catalog');

const actor = { id: null, name: 'Ada (Admin)' };
const idOf = async (slug: string) => (await db.one<any>('select id from products where slug = $1', [slug]))!.id as string;

beforeAll(async () => {
  db = await import('../lib/db');
  sheet = await import('../lib/priceSheet');
  admin = await import('../lib/priceAdmin');
  catalog = await import('../lib/catalog');
  await db.ready();
});

/** Edit a downloaded sheet the way a person would in Excel, and hand it back as CSV text. */
async function edited(slug: string | undefined, edit: (rows: string[][], col: Record<string, number>) => void) {
  const { csv } = await sheet.buildSheet(slug);
  const rows = sheet.parseCsv(csv);
  const head = rows[0].map((h) => h.toLowerCase());
  const col = { part: head.indexOf('part'), what: head.indexOf('what'), size: head.indexOf('quantity or size'), price: head.findIndex((h) => h.startsWith('price')), cost: head.findIndex((h) => h.startsWith('cost')), real: head.findIndex((h) => h.startsWith('real')), slug: head.findIndex((h) => h.startsWith('product key')), a: head.findIndex((h) => h.startsWith('row key')), b: head.findIndex((h) => h.startsWith('column key')) };
  edit(rows, col);
  return sheet.toCsv(rows);
}

describe('csv', () => {
  it('writes and reads boxes with commas, quotes and new lines', () => {
    const rows = [['a', 'b,c', 'say "hi"', 'two\nlines', ' pad '], ['', '₦15,000', '', '', '']];
    const text = sheet.toCsv(rows);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(sheet.parseCsv(text)).toEqual(rows);
  });
  it('reads semicolons and tabs, as Excel writes them in some countries', () => {
    expect(sheet.parseCsv('a;b;c\r\n1;2;3\r\n')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
    expect(sheet.parseCsv('a\tb\r\n1\t"2\t3"')).toEqual([['a', 'b'], ['1', '2\t3']]);
  });
  it('skips blank lines and copes with a missing final new line', () => {
    expect(sheet.parseCsv('a,b\n\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('the price sheet', () => {
  it('has one line for every price box and every priced add-on, with keys that find them again', async () => {
    const { csv, lines, products } = await sheet.buildSheet();
    const rows = sheet.parseCsv(csv);
    expect(rows[0]).toEqual([...sheet.HEAD]);
    expect(rows.length - 1).toBe(lines);
    expect(products).toBeGreaterThanOrEqual(9);
    for (const slug of ['business-cards', 'flyers', 'posters', 'tees-and-totes']) expect(rows.some((r) => r[8] === slug)).toBe(true);
    const bc = await admin.loadGrid(await idOf('business-cards'));
    const table = rows.filter((r) => r[8] === 'business-cards' && r[1] === 'Price table');
    expect(table.length).toBe(bc.rows.length * bc.cols.length);
    for (const r of table) expect(bc.rows.some((x) => x.id === r[9])).toBe(true);
  });

  it('can be limited to one product', async () => {
    const { csv } = await sheet.buildSheet('flyers');
    const rows = sheet.parseCsv(csv).slice(1);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r[8] === 'flyers')).toBe(true);
  });

  it('changes nothing when handed back untouched', async () => {
    const { csv } = await sheet.buildSheet();
    const r = await sheet.applySheet(csv, actor, { dryRun: true });
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.products).toEqual([]);
    expect(r.unchanged).toBeGreaterThan(20);
  });

  it('previews without saving, then saves what the preview said', async () => {
    const id = await idOf('flyers');
    const before = await admin.loadGrid(id);
    const first = before.cols[0];
    const row = before.rows[0];
    const old = before.cells[`${row.id}|${first.id}`];
    const text = await edited('flyers', (rows, c) => {
      const line = rows.find((r) => r[c.slug] === 'flyers' && r[c.a] === row.id && r[c.b] === first.id)!;
      line[c.price] = '₦91,250';
      line[c.cost] = '30,000';
    });
    const preview = await sheet.applySheet(text, actor, { dryRun: true });
    expect(preview.problems).toEqual([]);
    expect(preview.applied).toBe(false);
    expect(preview.products).toHaveLength(1);
    expect(preview.products[0].grid?.changed).toBe(1);
    // Nothing was saved by the preview.
    const unchanged = await admin.loadGrid(id);
    expect(unchanged.cells[`${row.id}|${first.id}`].price).toBe(old.price);
    expect((await admin.priceHistory({ productId: id })).length).toBe(0);

    const applied = await sheet.applySheet(text, actor, { dryRun: false });
    expect(applied.applied).toBe(true);
    const after = await admin.loadGrid(id);
    const cell = after.cells[`${row.id}|${first.id}`];
    expect(cell.price).toBe(9125000);
    expect(cell.cost).toBe(3000000);
    expect(cell.placeholder).toBe(false);
    expect((await admin.priceHistory({ productId: id }))[0].actor).toBe('Ada (Admin)');
    // Handing the same sheet back again changes nothing.
    const again = await sheet.applySheet(text, actor, { dryRun: true });
    expect(again.products).toEqual([]);
  });

  it('treats an empty box as "leave it", and a cost on its own as just a cost', async () => {
    const id = await idOf('posters');
    const before = await admin.loadGrid(id);
    const row = before.rows[0];
    const col = before.cols[1];
    const old = before.cells[`${row.id}|${col.id}`];
    const text = await edited('posters', (rows, c) => {
      const line = rows.find((r) => r[c.slug] === 'posters' && r[c.a] === row.id && r[c.b] === col.id)!;
      line[c.price] = '';
      line[c.cost] = '1200';
    });
    const r = await sheet.applySheet(text, actor, { dryRun: false });
    expect(r.products[0].grid?.costsOnly).toBe(1);
    const after = (await admin.loadGrid(id)).cells[`${row.id}|${col.id}`];
    expect(after.price).toBe(old.price);
    expect(after.cost).toBe(120000);
  });

  it('keeps an example price an example until the sheet says it is real', async () => {
    const id = await idOf('stickers');
    const g = await admin.loadGrid(id);
    const spot = g.rows.flatMap((r) => g.cols.map((c) => ({ r, c }))).find(({ r, c }) => g.cells[`${r.id}|${c.id}`]?.placeholder)!;
    expect(spot).toBeTruthy();
    const key = `${spot.r.id}|${spot.c.id}`;
    const sameButNo = await edited('stickers', (rows, c) => {
      const line = rows.find((x) => x[c.slug] === 'stickers' && x[c.a] === spot.r.id && x[c.b] === spot.c.id)!;
      expect(line[c.real]).toBe('no');
      line[c.cost] = '500';
    });
    await sheet.applySheet(sameButNo, actor, { dryRun: false });
    expect((await admin.loadGrid(id)).cells[key].placeholder).toBe(true);
    const yes = await edited('stickers', (rows, c) => {
      const line = rows.find((x) => x[c.slug] === 'stickers' && x[c.a] === spot.r.id && x[c.b] === spot.c.id)!;
      line[c.real] = 'yes';
    });
    const r = await sheet.applySheet(yes, actor, { dryRun: false });
    expect(r.products[0].grid?.confirmed).toBe(1);
    expect((await admin.loadGrid(id)).cells[key].placeholder).toBe(false);
  });

  it('saves nothing at all when any line is wrong', async () => {
    const id = await idOf('business-cards');
    const flyersId = await idOf('flyers');
    const before = JSON.stringify([(await admin.loadGrid(id)).cells, (await admin.loadGrid(flyersId)).cells]);
    const bad = await edited(undefined, (rows, c) => {
      const a = rows.find((r) => r[c.slug] === 'flyers' && r[c.part] === 'Price table')!;
      a[c.price] = '99999';
      const b = rows.find((r) => r[c.slug] === 'business-cards' && r[c.part] === 'Price table')!;
      b[c.price] = 'about fifteen thousand';
    });
    const r = await sheet.applySheet(bad, actor, { dryRun: false });
    expect(r.ok).toBe(false);
    expect(r.applied).toBe(false);
    expect(r.problems[0]).toMatch(/not a price/);
    expect(JSON.stringify([(await admin.loadGrid(id)).cells, (await admin.loadGrid(flyersId)).cells])).toBe(before);
  });

  it('rolls everything back when a later product fails the real save', async () => {
    // A zero price is read fine but refused by the grid; the earlier product in the file must not be saved either.
    const flyersId = await idOf('flyers');
    const before = JSON.stringify((await admin.loadGrid(flyersId)).cells);
    const bad = await edited(undefined, (rows, c) => {
      const a = rows.find((r) => r[c.slug] === 'flyers' && r[c.part] === 'Price table')!;
      a[c.price] = '88888';
      const b = rows.filter((r) => r[c.slug] === 'posters' && r[c.part] === 'Price table')[0];
      b[c.price] = '0';
    });
    const r = await sheet.applySheet(bad, actor, { dryRun: false });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/more than zero/);
    expect(JSON.stringify((await admin.loadGrid(flyersId)).cells)).toBe(before);
  });

  it('refuses a stale sheet whose rows or columns no longer exist', async () => {
    const text = await edited('flyers', (rows, c) => {
      const a = rows.find((r) => r[c.slug] === 'flyers' && r[c.part] === 'Price table')!;
      a[c.a] = '[["paper","gone"]]';
      a[c.price] = '1000';
    });
    const r = await sheet.applySheet(text, actor, { dryRun: true });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/no longer in the grid/);
  });

  it('refuses a file that is not a price sheet, and a product that is not ours', async () => {
    await expect(sheet.applySheet('name,price\nx,1\n', actor, { dryRun: true })).rejects.toThrow(/does not look like a Brandit price sheet/);
    const text = await edited('flyers', (rows, c) => { rows[1][c.slug] = 'no-such-product'; rows[1][c.price] = '5'; });
    const r = await sheet.applySheet(text, actor, { dryRun: true });
    expect(r.problems.join(' ')).toMatch(/not a product in this shop/);
  });

  it('sets the price of an add-on and takes it off the waiting list', async () => {
    const id = await idOf('posters');
    // Make one add-on wait for a price, as it does on the live site.
    const p = (await catalog.getProductById(id))!;
    const o = p.options.find((x) => !x.drives && x.choices.some((c) => (c.extra_kobo ?? 0) > 0 && !c.by && !c.percent && !c.setup_kobo))!;
    const c = o.choices.find((x) => (x.extra_kobo ?? 0) > 0 && !x.by && !x.percent && !x.setup_kobo)!;
    const patched = p.options.map((x) => (x.key !== o.key ? x : { ...x, choices: x.choices.map((y) => (y.value !== c.value ? y : (() => { const { extra_kobo, extra_per, provisional, ...rest } = y as any; return { ...rest, unpriced: true }; })())) }));
    await db.query('update products set options = $2 where id = $1', [id, JSON.stringify(patched)]);
    const text = await edited('posters', (rows, col) => {
      const line = rows.find((r) => r[col.slug] === 'posters' && r[col.part] === 'Add-on' && r[col.a] === o.key && r[col.b] === c.value)!;
      expect(line[col.price]).toBe('');
      expect(line[7]).toMatch(/Waiting for a price/);
      line[col.price] = '2,500';
      line[col.cost] = '900';
      line[col.real] = 'yes';
    });
    const r = await sheet.applySheet(text, actor, { dryRun: false });
    expect(r.products[0].addons).toBe(1);
    const after = (await catalog.getProductById(id))!.options.find((x) => x.key === o.key)!.choices.find((x) => x.value === c.value)!;
    expect(after.extra_kobo).toBe(250000);
    expect(after.cost_kobo).toBe(90000);
    expect(after.unpriced).toBeFalsy();
    expect(after.provisional).toBeFalsy();
  });

  it('lets an add-on be a saving', async () => {
    const id = await idOf('flyers');
    const p = (await catalog.getProductById(id))!;
    const o = p.options.find((x) => !x.drives && x.choices.some((c) => (c.extra_kobo ?? 0) !== 0 && !c.by && !c.percent && !c.setup_kobo));
    if (!o) return;
    const c = o.choices.find((x) => (x.extra_kobo ?? 0) !== 0 && !x.by && !x.percent && !x.setup_kobo)!;
    const text = await edited('flyers', (rows, col) => {
      const line = rows.find((r) => r[col.slug] === 'flyers' && r[col.part] === 'Add-on' && r[col.a] === o.key && r[col.b] === c.value)!;
      line[col.price] = '-500';
      line[col.real] = 'yes';
    });
    await sheet.applySheet(text, actor, { dryRun: false });
    const after = (await catalog.getProductById(id))!.options.find((x) => x.key === o.key)!.choices.find((x) => x.value === c.value)!;
    expect(after.extra_kobo).toBe(-50000);
  });

  it('warns about a price below its cost', async () => {
    const id = await idOf('business-cards');
    const g = await admin.loadGrid(id);
    const row = g.rows[0], col = g.cols[0];
    const text = await edited('business-cards', (rows, c) => {
      const line = rows.find((r) => r[c.slug] === 'business-cards' && r[c.a] === row.id && r[c.b] === col.id)!;
      line[c.price] = '10000';
      line[c.cost] = '12000';
    });
    const r = await sheet.applySheet(text, actor, { dryRun: true });
    expect(r.belowCost.length).toBe(1);
    expect(r.belowCost[0]).toMatch(/Business cards/);
  });
});


// ---------- Excel workbooks ----------
/** A real .xlsx file (a zip of XML), written by hand so the reader is tested against the format and not against itself. */
function makeXlsx(rows: (string | number | null)[][], opts: { shared?: boolean; sheet?: string; extraFirst?: boolean } = {}): Buffer {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colName = (i: number) => { let n = i + 1, s = ''; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const strings: string[] = [];
  const cellXml = (v: string | number | null, r: number, c: number) => {
    const ref = `${colName(c)}${r + 1}`;
    if (v === null || v === '') return '';
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    if (opts.shared) { let i = strings.indexOf(v); if (i < 0) { strings.push(v); i = strings.length - 1; } return `<c r="${ref}" t="s"><v>${i}</v></c>`; }
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  };
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cellXml(v, r, c)).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const name = opts.sheet ?? 'Price sheet';
  const files: Record<string, string> = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${opts.extraFirst ? '<sheet name="Read me" sheetId="2" r:id="rId2"/>' : ''}<sheet name="${esc(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': sheetXml,
    'xl/worksheets/sheet2.xml': `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Read me first</t></is></c></row></sheetData></worksheet>`,
  };
  if (opts.shared) files['xl/sharedStrings.xml'] = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((t) => `<si><t xml:space="preserve">${esc(t)}</t></si>`).join('')}</sst>`;
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [fname, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const comp = deflateRawSync(data);
    const nameBuf = Buffer.from(fname);
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, comp);
    central.push(cen, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

describe('Excel workbooks', () => {
  let x: typeof import('../lib/xlsxRead');
  beforeAll(async () => { x = await import('../lib/xlsxRead'); });

  it('reads text, numbers and special characters, with strings inline or shared', () => {
    const rows = [['Product', 'Price (₦)', 'Note'], ['Flyers & "more" <A5>', 25500, 'two\nlines'], ['', 0.1 + 0.2, '₦ é']];
    for (const shared of [false, true]) {
      const got = x.readXlsx(makeXlsx(rows, { shared }));
      expect(got[0]).toEqual(['Product', 'Price (₦)', 'Note']);
      expect(got[1]).toEqual(['Flyers & "more" <A5>', '25500', 'two\nlines']);
      expect(got[2]).toEqual(['', '0.3', '₦ é']); // no floating-point dust
    }
  });

  it('prefers the sheet called "Price sheet", even when it is not the first', () => {
    const got = x.readXlsx(makeXlsx([['a', 'b']], { extraFirst: true }));
    expect(got).toEqual([['a', 'b']]);
    const first = x.readXlsx(makeXlsx([['only']], { sheet: 'Whatever' }));
    expect(first).toEqual([['only']]);
  });

  it('refuses something that is not a workbook or is damaged', () => {
    expect(() => x.readXlsx(Buffer.from('PK\x03\x04 not really a zip, just text'))).toThrow(x.XlsxError);
    const good = makeXlsx([['a']]);
    expect(() => x.readXlsx(good.subarray(0, good.length - 30))).toThrow(x.XlsxError);
    expect(x.looksLikeXlsx(good)).toBe(true);
    expect(x.looksLikeXlsx(Buffer.from('a,b\n1,2'))).toBe(false);
  });

  it('loads a workbook edited in Excel exactly like the CSV', async () => {
    const id = await idOf('flyers');
    const before = await admin.loadGrid(id);
    const row = before.rows[0], col = before.cols[before.cols.length - 1];
    const { csv } = await sheet.buildSheet('flyers');
    const rows: (string | number | null)[][] = sheet.parseCsv(csv).map((r) => [...r]);
    const head = (rows[0] as string[]).map((h) => h.toLowerCase());
    const iP = head.findIndex((h) => h.startsWith('price')), iC = head.findIndex((h) => h.startsWith('cost')), iS = head.findIndex((h) => h.startsWith('product key')), iA = head.findIndex((h) => h.startsWith('row key')), iB = head.findIndex((h) => h.startsWith('column key'));
    const line = rows.find((r) => r[iS] === 'flyers' && r[iA] === row.id && r[iB] === col.id)!;
    line[iP] = 187500; // a number cell, as Excel stores it
    line[iC] = 100000;
    const book = x.readXlsx(makeXlsx(rows, { shared: true, extraFirst: true }));
    const r = await sheet.applySheet(book, actor, { dryRun: false });
    expect(r.problems).toEqual([]);
    expect(r.products[0].grid?.changed).toBe(1);
    const after = (await admin.loadGrid(id)).cells[`${row.id}|${col.id}`];
    expect(after.price).toBe(18_750_000);
    expect(after.cost).toBe(10_000_000);
  });
});

describe('steps, quantity rules and delivery on the same sheet', () => {
  const col = (rows: string[][]) => {
    const head = rows[0].map((h) => h.toLowerCase());
    return { price: head.findIndex((h) => h.startsWith('price')), cost: head.findIndex((h) => h.startsWith('cost')), real: head.findIndex((h) => h.startsWith('real')), slug: head.findIndex((h) => h.startsWith('product key')), a: head.findIndex((h) => h.startsWith('row key')), b: head.findIndex((h) => h.startsWith('column key')), what: head.indexOf('what'), size: head.indexOf('quantity or size'), part: head.indexOf('part') };
  };

  it('adds a quantity step that the product does not have yet, with its price and cost', async () => {
    const id = await idOf('flyers');
    const before = await admin.loadGrid(id);
    expect(before.cols.some((c) => c.id === 'q:3000')).toBe(false);
    const { csv } = await sheet.buildSheet('flyers');
    const rows = sheet.parseCsv(csv);
    const c = col(rows);
    const first = rows.find((r) => r[c.part] === 'Price table')!;
    rows.push([first[0], 'Price table', first[2], '3,000 pieces, price for all of them', '350000', '170000', 'yes', '', 'flyers', first[c.a], 'q:3000']);
    const text = sheet.toCsv(rows);
    const preview = await sheet.applySheet(text, actor, { dryRun: true });
    expect(preview.problems).toEqual([]);
    expect(preview.products[0].lines.join(' ')).toMatch(/Quantity steps added: 3,000/);
    expect((await admin.loadGrid(id)).cols.some((x) => x.id === 'q:3000')).toBe(false); // a preview saves nothing
    const done = await sheet.applySheet(text, actor, { dryRun: false });
    expect(done.applied).toBe(true);
    const after = await admin.loadGrid(id);
    expect(after.cols.some((x) => x.id === 'q:3000')).toBe(true);
    expect(after.cells[`${first[c.a]}|q:3000`]).toMatchObject({ price: 35_000_000, cost: 17_000_000, placeholder: false });
    // the steps that were there are still there
    expect(after.cols.length).toBe(before.cols.length + 1);
  });

  it('refuses a step outside what the shop takes, naming the line', async () => {
    const { csv } = await sheet.buildSheet('flyers');
    const rows = sheet.parseCsv(csv);
    const c = col(rows);
    const first = rows.find((r) => r[c.part] === 'Price table')!;
    rows.push([first[0], 'Price table', first[2], '99,999 pieces', '1000', '', 'yes', '', 'flyers', first[c.a], 'q:99999']);
    const r = await sheet.applySheet(sheet.toCsv(rows), actor, { dryRun: true });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/99,999 pieces is outside what the shop takes \(1 to 10,000\)/);
  });

  it('sets the quantity rule from three lines, and says so in words', async () => {
    const text = await edited('posters', (rows, c) => {
      for (const r of rows) {
        if (r[c.part] !== 'Quantity rule') continue;
        const k = r[c.b];
        if (k === 'custom') r[c.price] = 'yes';
        if (k === 'min') r[c.price] = '50';
        if (k === 'max') r[c.price] = '10,000';
      }
    });
    const r = await sheet.applySheet(text, actor, { dryRun: false });
    expect(r.problems).toEqual([]);
    expect(r.products[0].lines.join(' ')).toMatch(/customers may type their own quantity from 50 up to 10,000/);
    const p = await db.one<any>('select qty_custom, qty_min, qty_max from products where slug = $1', ['posters']);
    expect(p).toMatchObject({ qty_custom: true, qty_min: 50, qty_max: 10000 });
    const hist = await db.one<any>("select summary from price_history where kind = 'options' and product_name = 'Posters' order by id desc limit 1");
    expect(hist.summary).toMatch(/10,000/);
  });

  it('takes a limit away with the word none, refuses nonsense, and does not touch a product that is not priced by quantity', async () => {
    const ok = await edited('posters', (rows, c) => { for (const r of rows) if (r[c.part] === 'Quantity rule' && r[c.b] === 'max') r[c.price] = 'none'; });
    expect((await sheet.applySheet(ok, actor, { dryRun: false })).problems).toEqual([]);
    expect((await db.one<any>('select qty_max from products where slug = $1', ['posters'])).qty_max).toBeNull();
    const bad = await edited('posters', (rows, c) => { for (const r of rows) if (r[c.part] === 'Quantity rule' && r[c.b] === 'min') r[c.price] = 'lots'; });
    const r = await sheet.applySheet(bad, actor, { dryRun: true });
    expect(r.problems.join(' ')).toMatch(/whole number of pieces/);
    const { csv } = await sheet.buildSheet('roll-up-banners');
    expect(sheet.parseCsv(csv).some((x) => x[1] === 'Quantity rule')).toBe(false);
  });

  it('sets delivery fees by zone name and confirms stand-in fees', async () => {
    const before = await db.query<any>('select name, fee_kobo, provisional from delivery_zones order by sort');
    expect(before.length).toBe(3);
    const text = await edited(undefined, (rows, c) => {
      for (const r of rows) {
        if (r[c.part] !== 'Delivery') continue;
        if (r[c.a].startsWith('Zone A') && r[c.b] === 'fee') r[c.price] = '2500';
        if (r[c.a].startsWith('Zone C') && r[c.b] === '24h') r[c.price] = 'yes';
      }
    });
    const preview = await sheet.applySheet(text, actor, { dryRun: true });
    expect(preview.problems).toEqual([]);
    const lines = preview.products.find((p) => p.slug === 'delivery')!.lines;
    expect(lines.some((l) => /Zone A: Mainland core: fee ₦1,500 → ₦2,500/.test(l))).toBe(true);
    expect(lines.some((l) => /Zone C: Outer Lagos: .*24-hour delivery yes/.test(l))).toBe(true);
    await sheet.applySheet(text, actor, { dryRun: false });
    const after = await db.query<any>('select name, fee_kobo, eligible_24h, provisional from delivery_zones order by sort');
    expect(after[0]).toMatchObject({ fee_kobo: 250000, provisional: false });
    expect(after[2]).toMatchObject({ eligible_24h: true, provisional: false });
    expect(after[1].provisional).toBe(true); // a zone handed back unchanged is still a stand-in until a line says "yes" 
    const hist = await db.one<any>("select summary from price_history where kind = 'delivery' order by id desc limit 1");
    expect(hist.summary).toMatch(/Delivery fees saved/);
  });

  it('refuses a delivery zone that does not exist', async () => {
    const { csv } = await sheet.buildSheet();
    const rows = sheet.parseCsv(csv);
    rows.push(['Delivery', 'Delivery', 'Zone Z', 'fee for one delivery', '1000', '', '', '', 'delivery', 'Zone Z', 'fee']);
    const r = await sheet.applySheet(sheet.toCsv(rows), actor, { dryRun: true });
    expect(r.problems.join(' ')).toMatch(/no delivery zone with this name/);
  });

  it('carries add-ons that vary with size (one line per size) and one-time setup charges', async () => {
    const { csv } = await sheet.buildSheet('posters');
    const rows = sheet.parseCsv(csv);
    const lines = rows.filter((r) => r[9] === 'paper' && r[10].startsWith('satin200@'));
    expect(lines.map((r) => r[10]).sort()).toEqual(['satin200@a0', 'satin200@a1', 'satin200@a2', 'satin200@a3']);
    const bc = sheet.parseCsv((await sheet.buildSheet('business-cards')).csv);
    expect(bc.some((r) => r[10] === 'spotuv' && r[2].includes('Spot UV'))).toBe(true);
    expect(bc.some((r) => r[10] === 'spotuv#setup' && r[4] === '8000')).toBe(true);
    const text = await edited('posters', (rs, c) => {
      const r = rs.find((x) => x[c.a] === 'paper' && x[c.b] === 'satin200@a1')!;
      r[c.price] = '650';
    });
    const res = await sheet.applySheet(text, actor, { dryRun: false });
    expect(res.problems).toEqual([]);
    expect(res.products[0].lines.join(' ')).toMatch(/200gsm satin \(A1\), ₦550 → ₦650/);
    const stored = (await db.one<any>("select options from products where slug = 'posters'"))!.options as any[];
    expect(stored.find((o) => o.key === 'paper').choices.find((c: any) => c.value === 'satin200').by.amounts).toMatchObject({ a1: 65000, a3: 15000 });

    const setup = await edited('business-cards', (rs, c) => {
      const r = rs.find((x) => x[c.a] === 'finishing' && x[c.b] === 'spotuv#setup')!;
      r[c.price] = '9500';
    });
    const res2 = await sheet.applySheet(setup, actor, { dryRun: false });
    expect(res2.problems).toEqual([]);
    expect(res2.products[0].lines.join(' ')).toMatch(/Spot UV, one side \(one-time setup\), ₦8,000 → ₦9,500/);
    const bcs = (await db.one<any>("select options from products where slug = 'business-cards'"))!.options as any[];
    const uv = bcs.find((o) => o.key === 'finishing').choices.find((c: any) => c.value === 'spotuv');
    expect(uv).toMatchObject({ setup_kobo: 950000, extra_kobo: 1400, extra_per: 'piece' });
  });

  it('will not leave a size out of a price that depends on size', async () => {
    const id = await idOf('posters');
    const before = (await db.one<any>('select options from products where id = $1', [id]))!.options as any[];
    const waiting = JSON.parse(JSON.stringify(before));
    const foam = waiting.find((o: any) => o.key === 'mounting').choices.find((c: any) => c.value === 'foam');
    foam.by = { key: 'size', amounts: {} };
    delete foam.extra_kobo; delete foam.provisional; foam.unpriced = true;
    await db.query('update products set options = $2 where id = $1', [id, JSON.stringify(waiting)]);
    try {
      const { csv } = await sheet.buildSheet('posters');
      const rs = sheet.parseCsv(csv);
      const c = col(rs);
      const mine = rs.filter((x) => x[c.a] === 'mounting' && x[c.b].startsWith('foam@'));
      expect(mine.length).toBe(4);
      for (const x of mine) x[c.price] = '';
      mine[0][c.price] = '900';
      mine[1][c.price] = '1600';
      const bad = await sheet.applySheet(sheet.toCsv(rs), actor, { dryRun: true });
      expect(bad.ok).toBe(false);
      expect(bad.problems.join(' ')).toMatch(/leaves out the price for .* A price that depends on size needs one for every size/);
      for (const x of mine) x[c.price] = '1000';
      const good = await sheet.applySheet(sheet.toCsv(rs), actor, { dryRun: false });
      expect(good.problems).toEqual([]);
      const now = (await db.one<any>('select options from products where id = $1', [id]))!.options as any[];
      const f2 = now.find((o) => o.key === 'mounting').choices.find((x: any) => x.value === 'foam');
      expect(f2.unpriced).toBeUndefined();
      expect(Object.keys(f2.by.amounts).length).toBe(4);
      expect(f2.extra_per).toBe('piece');
    } finally {
      await db.query('update products set options = $2 where id = $1', [id, JSON.stringify(before)]);
    }
  });

  it('changes what an add-on is charged on when the line says so', async () => {
    const id = await idOf('business-cards');
    const stored = (await db.one<any>('select options from products where id = $1', [id]))!.options as any[];
    const round = stored.find((o) => o.key === 'finishing').choices.find((c: any) => c.value === 'round');
    expect(round.extra_per).toBe('piece');
    const text = await edited('business-cards', (rows, c) => {
      const r = rows.find((x) => x[c.part] === 'Add-on' && x[c.a] === 'finishing' && x[c.b] === 'round')!;
      r[c.size] = 'charged once per order';
      r[c.price] = '800';
    });
    const res = await sheet.applySheet(text, actor, { dryRun: false });
    expect(res.problems).toEqual([]);
    const now = (await db.one<any>('select options from products where id = $1', [id]))!.options as any[];
    const after = now.find((o) => o.key === 'finishing').choices.find((c: any) => c.value === 'round');
    expect(after).toMatchObject({ extra_kobo: 80000 });
    expect(after.extra_per ?? 'order').toBe('order');
  });
});
