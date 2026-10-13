import { startPurchase } from '@/lib/studio/purchases';
import { PaymentsNotConfiguredError } from '@/lib/payments';
import { SKUS, type Sku } from '@/lib/studio/config';
import { bad, customerOr401, good, jsonBody } from '@/lib/studio/route';

export const dynamic = 'force-dynamic';

/** Start a payment for a Studio item. The price is decided here on the server, never taken from the browser. */
export async function POST(req: Request) {
  const who = await customerOr401(req, 'buy', 20);
  if ('res' in who) return who.res;
  const b = await jsonBody(req);
  if (!b) return bad('Something went wrong. Try again.');
  const sku = String(b.sku ?? '') as Sku;
  if (!SKUS.includes(sku)) return bad('That cannot be bought.');
  try {
    const r = await startPurchase(who.c, { sku, projectId: b.projectId ? String(b.projectId) : undefined, versionId: b.versionId ? String(b.versionId) : undefined });
    if (!r.ok) return bad(r.error, r.code === 'busy' ? 503 : 422, { code: r.code });
    if ('done' in r) return good({ done: true, projectId: r.projectId });
    return good({ url: r.url });
  } catch (e) {
    if (e instanceof PaymentsNotConfiguredError) return bad('Online payment is not available right now. Message us on WhatsApp and we will help.', 503);
    console.error('[studio] payment could not start', e);
    return bad('We could not start your payment. Try again in a moment.', 502);
  }
}
