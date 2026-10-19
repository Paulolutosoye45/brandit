import { query, tx } from './db';
import { clearBasketCookie, currentBasket } from './basket';
import { artworkOutstanding } from './lines';
import { getItems, getOrder, saveCheckout, setArtworkPath } from './orders';
import { linkBlocker, payLinkUrl } from './payLink';
import { appUrl, flushMessages, queueMessage } from './messages';
import { naira } from './money';

/*
 * Order from WhatsApp. A customer chats to us on WhatsApp; the team builds their order here and sends them a pay link.
 * The team builds the products with the same order builder customers use (so every choice and every price is checked
 * by the same rules), then turns that basket into the customer's order on the console page.
 */

export type LineFile = 'later' | 'design';
export type BuildInput = {
  name: string; phone: string; email?: string;
  pickup: boolean; area?: string; addressLine?: string;
  /** For each line that has no artwork yet: the customer sends the file after paying (default), or Brandit designs it. */
  files?: Record<string, LineFile>;
  /** What the designer should know, for lines Brandit designs. */
  designNote?: string;
  /** A short note the person who opens the pay link sees. */
  note?: string;
  /** Also send the link from Brandit's own WhatsApp number (needs the approved message). */
  send?: boolean;
};
export type BuildResult = { ok: true; id: string; code: string; url: string; totalKobo: number } | { ok: false; error: string; field?: string };

const EMPTY = 'There is nothing in the basket of this browser yet. Add the products first, then come back here.';

/** The basket of this browser becomes the customer's order. The basket is the team member's own, so it is cleared afterwards. */
export async function buildOrderFromBasket(staff: { id: string; name: string }, input: BuildInput): Promise<BuildResult> {
  const basket = await currentBasket();
  if (!basket) return { ok: false, error: EMPTY };
  const r = await buildOrder(basket.id, staff, input);
  if (r.ok) await clearBasketCookie();
  return r;
}

/** Turn an open draft order into the customer's order and make its pay link. */
export async function buildOrder(orderId: string, staff: { id: string; name: string }, input: BuildInput): Promise<BuildResult> {
  const basket = await getOrder(orderId);
  if (!basket || !['draft', 'awaiting_payment'].includes(basket.status) || basket.custom_request_id) return { ok: false, error: EMPTY };
  const lines = await getItems(basket.id);
  if (lines.length === 0) return { ok: false, error: EMPTY };

  // Lines whose artwork is not settled: either the customer sends the file after paying, or Brandit designs it.
  for (const l of lines) {
    if (!artworkOutstanding(l as any)) continue;
    const pick = input.files?.[l.id] ?? 'later';
    if (pick === 'design') {
      const note = (input.designNote ?? '').trim().slice(0, 600) || 'Taken from a WhatsApp chat.';
      await setArtworkPath(basket.id, 'design', { purpose: note, wording: 'The team built this order from a WhatsApp chat. Ask the customer for the exact words and any logo before you start.', via: 'whatsapp' }, l.id);
    } else {
      await query(`update order_items set artwork_path = 'upload', design_brief = $2, artwork_file_id = null, preview_approved_at = null, studio_tier = null, studio_fee_kobo = 0, studio_project_id = null where id = $1`, [l.id, JSON.stringify({ kind: 'file_later' })]);
    }
  }

  // The customer is found or made from the phone number, exactly as when a guest checks out.
  const saved = await saveCheckout(basket.id, {
    name: input.name, phone: input.phone, email: input.email ?? '', pickup: !!input.pickup, area: input.area, addressLine: input.addressLine,
  }, null, { staffBuilt: true });
  if (!saved.ok) return saved;
  await query('update orders set staff_built = true, built_by = $2, pay_link_at = now(), pay_note = $3 where id = $1', [basket.id, staff.id, (input.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || null]);
  const blocked = await linkBlocker(basket.id);
  if (blocked) return { ok: false, error: blocked };

  const o = (await getOrder(basket.id))!;
  await query("insert into events (name, props) values ('staff_order_built', $1)", [JSON.stringify({ order: o.code })]);
  const url = payLinkUrl(o.public_token);
  if (input.send) {
    const first = String(input.name).trim().split(/\s+/)[0] || 'there';
    await tx(async (q) => queueMessage(q, { orderId: o.id, template: 'pay_link', vars: { name: first, code: o.code, amount: naira(o.total_kobo), link: url } }));
    await flushMessages();
  }
  return { ok: true, id: o.id, code: o.code, url, totalKobo: o.total_kobo };
}

export { appUrl };
