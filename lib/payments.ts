import { createHmac, timingSafeEqual } from 'node:crypto';
import { query, one, isDemo } from './db';
import { appUrl } from './messages';
import { token } from './password';

export const paystackOn = () => !!process.env.PAYSTACK_SECRET_KEY;
/** The pretend payment page exists only in demo mode with no Paystack key. A live site can never mark an order paid without Paystack. */
export const demoPayments = () => isDemo() && !paystackOn();

export class PaymentsNotConfiguredError extends Error {
  constructor() { super('Payments are not set up yet.'); }
}

/** Paystack signs every webhook body with HMAC SHA-512 of the raw body and your secret key. */
export function verifyPaystackSignature(rawBody: string, signature: string | null, secret = process.env.PAYSTACK_SECRET_KEY ?? ''): boolean {
  if (!signature || !secret) return false;
  const want = createHmac('sha512', secret).update(rawBody).digest();
  let got: Buffer;
  try {
    got = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Start a payment: record it as pending, then send the customer to Paystack (or the demo page). */
export async function initPayment(order: Record<string, any>, email: string): Promise<{ reference: string; url: string }> {
  if (!paystackOn() && !demoPayments()) throw new PaymentsNotConfiguredError();
  const reference = `${order.code}-${token(8)}`;
  await query("insert into payments (order_id, provider_ref, amount_kobo, status) values ($1,$2,$3,'pending')", [order.id, reference, order.total_kobo]);
  if (!paystackOn()) return { reference, url: `/pay/${order.id}?ref=${encodeURIComponent(reference)}` }; // demo only, guarded above
  const res = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      amount: order.total_kobo,
      reference,
      currency: 'NGN',
      callback_url: `${appUrl()}/pay/return`,
      channels: ['card', 'bank_transfer', 'ussd'],
      metadata: { order_code: order.code },
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json?.data?.authorization_url) throw new Error(`Paystack could not start the payment: ${json?.message ?? res.status}`);
  return { reference, url: json.data.authorization_url as string };
}

export type PaystackCheck =
  | { kind: 'paid'; amountKobo: number; method?: string; raw: unknown }
  | { kind: 'unpaid' }
  /** Paystack could not be asked, or answered with something unexpected. Not the same as "not paid". */
  | { kind: 'error'; message: string };

/** Ask Paystack directly whether a reference was paid (used when the customer returns, in case the webhook is late), telling "not paid yet" apart from "could not find out". */
export async function checkWithPaystack(reference: string, env: NodeJS.ProcessEnv = process.env, doFetch: typeof fetch = fetch): Promise<PaystackCheck> {
  if (!env.PAYSTACK_SECRET_KEY) return { kind: 'error', message: 'Payments are not set up.' };
  let res: Response;
  try {
    res = await doFetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` } });
  } catch (e) {
    return { kind: 'error', message: `Could not reach Paystack: ${(e as Error).message}` };
  }
  const json: any = await res.json().catch(() => null);
  // 404 means Paystack has no payment under this reference yet (the customer has not started paying). That is not a fault.
  if (res.status === 404) return { kind: 'unpaid' };
  if (!res.ok || !json?.data) return { kind: 'error', message: `Paystack answered ${res.status}${json?.message ? `: ${String(json.message).slice(0, 120)}` : ''}` };
  if (json.data.status === 'success') return { kind: 'paid', amountKobo: json.data.amount, method: json.data.channel, raw: json.data };
  return { kind: 'unpaid' };
}

/**
 * Refund part or all of an order. Demo mode records it without calling anyone.
 * By default the refund comes out of the order's first successful payment. The console can name a payment (a duplicate, say).
 * Every refund is a negative row in payments that says which payment it came out of, why, and who sent it.
 */
export async function refundPayment(orderId: string, amountKobo: number, key: string, opts: { providerRef?: string; reason?: string; staffId?: string | null; allowStatuses?: string[] } = {}): Promise<{ ok: boolean; error?: string }> {
  const statuses = opts.allowStatuses ?? ['success'];
  const paid = opts.providerRef
    ? await one<{ provider_ref: string }>('select provider_ref from payments where order_id = $1 and provider_ref = $2 and status = any($3::text[]) and amount_kobo > 0', [orderId, opts.providerRef, statuses])
    : await one<{ provider_ref: string }>("select provider_ref from payments where order_id = $1 and status = 'success' and amount_kobo > 0 order by created_at limit 1", [orderId]);
  if (!paid) return { ok: false, error: 'No successful payment to refund.' };
  // A live site must never record a refund it did not send.
  if (!paystackOn() && !isDemo()) return { ok: false, error: 'Payments are not set up, so this refund cannot be sent.' };
  if (paystackOn()) {
    const res = await fetch('https://api.paystack.co/refund', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction: paid.provider_ref, amount: amountKobo }),
    });
    if (!res.ok) {
      const j: any = await res.json().catch(() => null);
      const why = typeof j?.message === 'string' ? `: ${j.message.slice(0, 140)}` : '';
      return { ok: false, error: `Paystack refused the refund (${res.status})${why}` };
    }
  }
  await query(
    "insert into payments (order_id, provider_ref, method, amount_kobo, status, verified_at, raw, refund_reason, staff_id) values ($1,$2,'refund',$3,'refund', now(), $4, $5, $6) on conflict (provider_ref) do nothing",
    [orderId, `refund-${key}`, -amountKobo, JSON.stringify({ refund_of: paid.provider_ref }), opts.reason ?? null, opts.staffId ?? null],
  );
  return { ok: true };
}
