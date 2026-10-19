import { one, query } from './db';
import { getItem, getOrder, isOpen, updateLine } from './orders';
import { getProductById } from './catalog';
import { parseNameList, totalOf, type NameRow } from './nameListCore';

export * from './nameListCore';

export type SaveNames = { ok: true; total: number; warnings: string[]; quantityChanged: boolean } | { ok: false; error: string };

/** Save the list on a line of an unpaid order. The quantity becomes the number of pieces, and the price follows. */
export async function saveNames(orderId: string, itemId: string, input: string | string[][]): Promise<SaveNames> {
  const o = await getOrder(orderId);
  const item = await getItem(orderId, itemId);
  if (!o || !item || !isOpen(o) || o.custom_request_id) return { ok: false, error: 'This order can no longer be changed.' };
  const product = await getProductById(item.product_id);
  if (!product || !(await personalisable(product.id))) return { ok: false, error: 'This product does not take a list of names.' };
  const parsed = parseNameList(input);
  if (!parsed.ok) return parsed;
  // Products that price "different details on each" separately switch it on, because a list is exactly that.
  const opt = product.options.find((x) => x.key === 'personalised');
  const config: Record<string, string> | undefined = opt && opt.choices.some((c) => c.value === 'sheet') && item.config?.personalised !== 'sheet' ? { ...(item.config ?? {}), personalised: 'sheet' } : undefined;
  const quantityChanged = parsed.total !== item.quantity;
  if (quantityChanged || config) {
    const r = await updateLine(orderId, itemId, { quantity: parsed.total, ...(config ? { config } : {}) });
    if ('error' in r) return { ok: false, error: `${r.error} Your list adds up to ${parsed.total.toLocaleString('en-US')} pieces.` };
  }
  await query('update order_items set names = $2 where id = $1', [itemId, JSON.stringify(parsed.rows)]);
  await query("insert into events (name, props) values ('names_saved', $1)", [JSON.stringify({ order: o.code, names: parsed.rows.length, pieces: parsed.total })]);
  return { ok: true, total: parsed.total, warnings: parsed.warnings, quantityChanged };
}

/** Take the list off a line. The quantity stays as it is. */
export async function clearNames(orderId: string, itemId: string): Promise<boolean> {
  const o = await getOrder(orderId);
  const item = await getItem(orderId, itemId);
  if (!o || !item || !isOpen(o)) return false;
  await query('update order_items set names = null where id = $1', [itemId]);
  return true;
}

export async function personalisable(productId: string): Promise<boolean> {
  const r = await one<{ personalise: boolean }>('select personalise from products where id = $1', [productId]);
  return !!r?.personalise;
}

/** Before anyone pays: does every list still match its quantity? A list that no longer adds up would print the wrong number of pieces. */
export async function namesProblem(orderId: string): Promise<string | null> {
  const rows = await query<{ name: string; quantity: number; names: NameRow[] | null }>(
    `select coalesce(i.label, p.name) as name, i.quantity, i.names from order_items i join products p on p.id = i.product_id where i.order_id = $1 and i.names is not null`, [orderId]);
  for (const r of rows) {
    const total = totalOf(r.names);
    if (total !== r.quantity) return `The list for ${r.name} has ${total.toLocaleString('en-US')} pieces but the order says ${r.quantity.toLocaleString('en-US')}. Open the list and save it again, or take the list off.`;
  }
  return null;
}

