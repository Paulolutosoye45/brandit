import { one, query } from './db';
import { audit, type Who } from './audit';
import type { ProductOption } from './types';

/*
 * Stock, honestly: Brandit does not count shirts. What the team controls is whether a colour, a size or a paper can be
 * chosen. Switching one off hides it from customers straight away (it stays in the price table, so switching it back on
 * needs no re-pricing). A choice that is still waiting for a price stays hidden whatever this says.
 */
const STOCKY = /colou?r|size|garment|fabric|material|paper|stock|bag|frame|finish/i;

export type StockOption = { key: string; label: string; choices: { value: string; label: string; inStock: boolean; waitingForPrice: boolean }[] };
export type StockProduct = { id: string; name: string; slug: string; options: StockOption[]; outCount: number };

export async function stockList(): Promise<StockProduct[]> {
  const rows = await query<{ id: string; name: string; slug: string; options: ProductOption[] }>('select id, name, slug, options from products where active order by sort, name');
  const out: StockProduct[] = [];
  for (const p of rows) {
    const options = (p.options ?? [])
      .filter((o) => (STOCKY.test(o.key) || STOCKY.test(o.label)) && o.choices.length > 1)
      .map((o) => ({ key: o.key, label: o.label, choices: o.choices.map((c) => ({ value: c.value, label: c.label, inStock: !c.hidden, waitingForPrice: !!c.unpriced })) }));
    if (options.length) out.push({ id: p.id, name: p.name, slug: p.slug, options, outCount: options.reduce((a, o) => a + o.choices.filter((c) => !c.inStock).length, 0) });
  }
  return out;
}

export async function setChoiceStock(who: Who, productId: string, optionKey: string, value: string, inStock: boolean): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const p = await one<{ id: string; name: string; options: ProductOption[] }>('select id, name, options from products where id = $1', [productId]);
  if (!p) return { ok: false, error: 'That product was not found.' };
  const opts = structuredClone(p.options ?? []);
  const o = opts.find((x) => x.key === optionKey);
  const c = o?.choices.find((x) => x.value === value);
  if (!o || !c) return { ok: false, error: 'That choice was not found. Reload the page.' };
  if (!inStock) {
    // Never switch off the last choice customers can pick: the product would have nothing to order.
    const left = o.choices.filter((x) => x !== c && !x.hidden && !x.unpriced).length;
    if (left === 0) return { ok: false, error: `${o.label} needs at least one choice customers can pick. Switch another one on first.` };
  }
  if (inStock) delete c.hidden; else c.hidden = true;
  // If the standard choice was switched off, the next one that can be chosen becomes the standard, so the builder never opens on a missing item.
  if (!inStock && o.default === c.value) o.default = o.choices.find((x) => !x.hidden && !x.unpriced)?.value ?? o.default;
  await query('update products set options = $2 where id = $1', [productId, JSON.stringify(opts)]);
  await audit(who, { area: 'catalogue', action: inStock ? 'stock_on' : 'stock_off', target: p.name, summary: `${inStock ? 'Switched on' : 'Switched off'} ${o.label}: ${c.label} on ${p.name}`, detail: { productId, optionKey, value } });
  return { ok: true, message: inStock ? `${c.label} is back on sale.` : `${c.label} is off. Customers no longer see it.` };
}
