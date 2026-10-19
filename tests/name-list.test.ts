import { beforeAll, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';

process.env.PGLITE_DIR = 'memory';
process.env.DEMO_MODE = 'true';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-names-${process.pid}`);
delete process.env.PAYSTACK_SECRET_KEY;

import { parseNameList, listText, namesCsv, totalOf } from '../lib/nameListCore';

let db: typeof import('../lib/db');
let O: typeof import('../lib/orders');
let N: typeof import('../lib/nameList');
let PL: typeof import('../lib/payLink');
let I: typeof import('../lib/identity');

beforeAll(async () => {
  db = await import('../lib/db');
  await db.ready();
  O = await import('../lib/orders');
  N = await import('../lib/nameList');
  PL = await import('../lib/payLink');
  I = await import('../lib/identity');
}, 60_000);

describe('reading a list of names', () => {
  it('takes one name per line, with an optional note and number of copies', () => {
    const r = parseNameList('Ada Obi\nTunde Bello, Accounts\nChioma Eze, Sales, 2\nIbrahim Musa, 3');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toEqual([
      { name: 'Ada Obi', note: '', qty: 1 },
      { name: 'Tunde Bello', note: 'Accounts', qty: 1 },
      { name: 'Chioma Eze', note: 'Sales', qty: 2 },
      { name: 'Ibrahim Musa', note: '', qty: 3 },
    ]);
    expect(r.total).toBe(7);
  });

  it('copes with what people really paste: numbering, a heading, Excel tabs, quotes, blank lines, Windows line endings', () => {
    const r = parseNameList('Name\tRole\tCopies\r\n1. Ada Obi\tAccounts\t2\r\n\r\n2) "Tunde Bello"\tSales\r\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toEqual([{ name: 'Ada Obi', note: 'Accounts', qty: 2 }, { name: 'Tunde Bello', note: 'Sales', qty: 1 }]);
    // Rows read from a spreadsheet file work the same way.
    const x = parseNameList([['Full name', 'Role'], ['Ada Obi', 'Accounts'], ['', ''], ['Tunde Bello', '']]);
    expect(x.ok && x.rows.map((a) => a.name)).toEqual(['Ada Obi', 'Tunde Bello']);
  });

  it('warns about repeats and bad copy counts, and refuses an empty list or too many names', () => {
    const r = parseNameList('Ada Obi\nada obi\nTunde, Sales, many\nChioma, , 500');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.join(' ')).toMatch(/appears 2 times/);
    expect(r.warnings.join(' ')).toMatch(/not a number/);
    expect(r.rows[3].qty).toBe(99);
    expect(parseNameList('  \n\n').ok).toBe(false);
    expect(parseNameList(Array.from({ length: 501 }, (_, i) => `Person ${i}`).join('\n')).ok).toBe(false);
    expect(parseNameList(Array.from({ length: 200 }, (_, i) => `Person ${i}, , 99`).join('\n')).ok).toBe(false); // 19,800 pieces
  });

  it('writes the list back the way it was typed, and a spreadsheet file that cannot run formulas', () => {
    const text = 'Ada Obi\nTunde Bello, Accounts\nChioma Eze, , 2';
    const r = parseNameList(text);
    expect(r.ok && listText(r.rows)).toBe(text);
    const csv = namesCsv([{ name: '=HYPERLINK("http://evil")', note: 'Sales, North', qty: 1 }, { name: 'Ada "AJ" Obi', note: '', qty: 2 }]);
    expect(csv.split('\r\n')[1]).toBe(`1,"'=HYPERLINK(""http://evil"")","Sales, North",1`);
    expect(csv.split('\r\n')[2]).toBe('2,"Ada ""AJ"" Obi",,2');
    expect(totalOf([{ name: 'a', note: '', qty: 2 }, { name: 'b', note: '', qty: 3 }])).toBe(5);
  });
});

let n = 0;
async function idCardBasket(quantity = 10) {
  n++;
  const c = (await I.signInEmail(`names${n}@example.com`)).customer;
  const d: any = await O.createDraft({ slug: 'id-cards', quantity, area: 'Yaba' });
  expect(d.id, JSON.stringify(d)).toBeTruthy();
  await db.query('update orders set customer_id = $2 where id = $1', [d.id, c.id]);
  return { c, id: d.id as string, item: (await O.getItem(d.id))! };
}

describe('a list on a line of the order', () => {
  it('sets the quantity to the number of pieces, switches on the personalised setup, and the price follows', async () => {
    const t = await idCardBasket(10);
    const before = (await O.getOrder(t.id))!.total_kobo;
    const names = Array.from({ length: 25 }, (_, i) => `Staff Member ${i + 1}, Team ${i % 3}`).join('\n');
    const r = await N.saveNames(t.id, t.item.id, names);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const item = (await O.getItem(t.id))!;
    expect(item.quantity).toBe(25);
    expect(item.config.personalised).toBe('sheet');
    expect(item.names).toHaveLength(25);
    expect((await O.getOrder(t.id))!.total_kobo).toBeGreaterThan(before);
    // The setup fee for "different details on each card" is in the price.
    const q = await db.one<any>('select line_total_kobo from order_items where id = $1', [item.id]);
    expect(q.line_total_kobo).toBeGreaterThan(0);
  });

  it('refuses a product that does not take a list, and a list that cannot be priced', async () => {
    const d: any = await O.createDraft({ slug: 'flyers', quantity: 100, area: 'Yaba' });
    const item = (await O.getItem(d.id))!;
    const r = await N.saveNames(d.id, item.id, 'Ada Obi');
    expect(r.ok).toBe(false);
    const t = await idCardBasket(10);
    // More cards than the product sells in one order.
    const tooMany = await N.saveNames(t.id, t.item.id, Array.from({ length: 200 }, (_, i) => `P${i}, , 11`).join('\n'));
    expect(tooMany.ok).toBe(false);
    expect((await O.getItem(t.id))!.names).toBeNull();
  });

  it('blocks payment and the pay link while the list and the quantity disagree', async () => {
    const t = await idCardBasket(10);
    await N.saveNames(t.id, t.item.id, 'Ada Obi\nTunde Bello\nChioma Eze');
    expect(await N.namesProblem(t.id)).toBeNull();
    // The customer changes the quantity afterwards without touching the list.
    const u = await O.updateLine(t.id, t.item.id, { quantity: 20 });
    expect('error' in u).toBe(false);
    expect(await N.namesProblem(t.id)).toMatch(/3 pieces but the order says 20/);
    expect(await PL.linkBlocker(t.id)).toBeTruthy();
    // Taking the list off lets the order go on with its quantity.
    expect(await N.clearNames(t.id, t.item.id)).toBe(true);
    expect(await N.namesProblem(t.id)).toBeNull();
  });

  it('is copied when the order is repeated', async () => {
    const t = await idCardBasket(10);
    await N.saveNames(t.id, t.item.id, 'Ada Obi\nTunde Bello');
    await db.query("update orders set status = 'delivered', delivered_at = now() where id = $1", [t.id]);
    const o = (await O.getOrder(t.id))!;
    const again = await O.reorder(o.public_token, t.c.id);
    expect('id' in again).toBe(true);
    if (!('id' in again)) return;
    const copy = (await O.getItem(again.id))!;
    expect(copy.names).toHaveLength(2);
    expect(copy.quantity).toBe(2);
  });
});
