import { one, query, withLock } from './db';
import { checkWithPaystack, paystackOn, refundPayment } from './payments';
import { confirmPayment } from './orders';
import { getSettings } from './settings';
import { audit, type Who } from './audit';
import { can } from './permissions';
import { appUrl, flushMessages, queueMessage } from './messages';
import { alertPaymentNotApplied } from './siteAlert';
import { naira } from './money';
import type { Role } from './types';

/*
 * Payments and refunds in the console. Money rules, in plain words:
 *  - A refund can never be bigger than what is left on the payment it comes out of.
 *  - A production lead can send a refund up to the same limit as a reprint; above it an admin must.
 *  - Every refund records why, who sent it, and which payment it came out of. Nothing is edited afterwards.
 *  - Two people pressing Refund at once cannot send it twice: the check and the send happen under one lock.
 */
export const REASONS: { key: string; label: string; needsNote: boolean }[] = [
  { key: 'duplicate', label: 'Paid twice', needsNote: false },
  { key: 'customer_request', label: 'Customer asked (changed their mind)', needsNote: false },
  { key: 'quality', label: 'Print problem', needsNote: false },
  { key: 'late', label: 'We were late', needsNote: false },
  { key: 'cannot_make', label: 'We cannot make it', needsNote: false },
  { key: 'other', label: 'Something else (say what)', needsNote: true },
];


/** How a payment's status reads on screen, with the colours the console uses. */
export const PAY_STATUS: Record<string, [string, string]> = {
  success: ['Paid', 'bg-good-tint text-good'],
  pending: ['Started, not paid', 'bg-placeholder text-ink'],
  superseded: ['Replaced by a newer try', 'bg-placeholder text-ink'],
  review: ['Needs a look: order already paid', 'bg-bad-tint text-bad'],
  amount_mismatch: ['Needs a look: wrong amount', 'bg-bad-tint text-bad'],
  refund: ['Refund', 'bg-warn-tint text-warn'],
};

export type PayFilter = 'attention' | 'paid' | 'refunds' | 'pending' | 'all';
export const PAY_FILTERS: { key: PayFilter; label: string }[] = [
  { key: 'attention', label: 'Needs a look' },
  { key: 'paid', label: 'Paid' },
  { key: 'refunds', label: 'Refunds' },
  { key: 'pending', label: 'Started, not paid' },
  { key: 'all', label: 'Everything' },
];

export type PaymentRow = {
  id: string; order_id: string; code: string; customer: string | null; provider_ref: string; method: string | null; amount_kobo: number; status: string;
  created_at: string; verified_at: string | null; refund_reason: string | null; staff_name: string | null; raw: any;
  refunded_kobo: number; order_status: string;
  /** Set when someone other than the customer paid, through a pay link. */
  payer_name?: string | null; payer_email?: string | null;
};

const FILTER_SQL: Record<PayFilter, string> = {
  attention: "p.status in ('review','amount_mismatch')",
  paid: "p.status = 'success'",
  refunds: "p.status = 'refund'",
  pending: "p.status = 'pending' and p.created_at >= now() - interval '7 days'",
  all: 'true',
};

/** What has been refunded out of one payment. Older refunds (from problem reports) carry no link, so they count against the order's first successful payment. */
const REFUNDED_SQL = `(select coalesce(-sum(r.amount_kobo), 0)::int from payments r where r.order_id = p.order_id and r.status = 'refund'
   and (r.raw->>'refund_of' = p.provider_ref or (r.raw->>'refund_of' is null and p.id = (select f.id from payments f where f.order_id = p.order_id and f.status = 'success' and f.amount_kobo > 0 order by f.created_at, f.id limit 1))))`;

export async function listPayments(o: { filter?: PayFilter; q?: string; page?: number; size?: number } = {}) {
  const size = Math.min(Math.max(o.size ?? 40, 5), 100);
  const page = Math.max(o.page ?? 1, 1);
  const f = o.filter ?? 'attention';
  const q = (o.q ?? '').trim().slice(0, 80);
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const where = `${FILTER_SQL[f]} and ($1 = '' or o.code ilike $2 or p.provider_ref ilike $2 or c.name ilike $2 or c.email ilike $2 or c.phone like $2)`;
  const from = 'from payments p join orders o on o.id = p.order_id left join customers c on c.id = o.customer_id left join staff s on s.id = p.staff_id';
  const total = (await one<{ n: number }>(`select count(*)::int as n ${from} where ${where}`, [q, like]))?.n ?? 0;
  const rows = await query<PaymentRow>(
    `select p.id, p.order_id, o.code, c.name as customer, p.provider_ref, p.method, p.amount_kobo, p.status, p.created_at, p.verified_at, p.refund_reason, s.name as staff_name, p.raw, p.payer_name, p.payer_email,
            ${REFUNDED_SQL} as refunded_kobo, o.status as order_status
     ${from} where ${where} order by p.created_at desc, p.id limit $3 offset $4`,
    [q, like, size, (page - 1) * size],
  );
  return { rows, total, pages: Math.max(1, Math.ceil(total / size)), page };
}

export async function paymentCounts() {
  return one<{ attention: number; refunded_30d: number; paid_30d: number }>(
    `select (select count(*)::int from payments where status in ('review','amount_mismatch')) as attention,
            (select coalesce(-sum(amount_kobo),0)::int from payments where status = 'refund' and created_at >= now() - interval '30 days') as refunded_30d,
            (select coalesce(sum(amount_kobo),0)::int from payments where status = 'success' and created_at >= now() - interval '30 days') as paid_30d`,
  );
}

/** Money Paystack actually collected on a payment row, and how much of it is still refundable. */
export function collectedKobo(p: Pick<PaymentRow, 'status' | 'amount_kobo' | 'raw'>): number | null {
  if (p.status === 'success' || p.status === 'review') return p.amount_kobo;
  if (p.status === 'amount_mismatch') {
    const n = Number(p.raw?.amount ?? p.raw?.data?.amount);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  }
  return null;
}
export const refundableKobo = (p: PaymentRow) => Math.max(0, (collectedKobo(p) ?? 0) - p.refunded_kobo);

export type RefundResult = { ok: true; message: string } | { ok: false; error: string };

export async function consoleRefund(
  who: Who & { role: Role },
  d: { paymentId: string; amountKobo: number; reason: string; note?: string },
): Promise<RefundResult> {
  const reason = REASONS.find((r) => r.key === d.reason);
  if (!reason) return { ok: false, error: 'Choose why you are refunding.' };
  const note = (d.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (reason.needsNote && note.length < 3) return { ok: false, error: 'Say what the reason is, in a few words.' };
  if (!can(who.role, 'refund')) return { ok: false, error: 'Only a production lead or an admin can send refunds.' };
  if (!Number.isInteger(d.amountKobo) || d.amountKobo <= 0) return { ok: false, error: 'Enter the amount to refund.' };
  const s = await getSettings();
  if (who.role === 'production_lead' && d.amountKobo > s.lead_reprint_limit_kobo) return { ok: false, error: `This is above ${naira(s.lead_reprint_limit_kobo)}. Ask an admin to send it.` };

  const run = await withLock(7301, async (): Promise<RefundResult> => {
    // Read inside the lock, so a second click sees the first refund.
    const rows = await query<PaymentRow>(
      `select p.id, p.order_id, o.code, null::text as customer, p.provider_ref, p.method, p.amount_kobo, p.status, p.created_at, p.verified_at, p.refund_reason, null::text as staff_name, p.raw,
              ${REFUNDED_SQL} as refunded_kobo, o.status as order_status
       from payments p join orders o on o.id = p.order_id where p.id = $1`, [d.paymentId]);
    const p = rows[0];
    if (!p) return { ok: false, error: 'That payment was not found.' };
    if (!['success', 'review', 'amount_mismatch'].includes(p.status)) return { ok: false, error: 'Only a payment that Paystack collected can be refunded.' };
    const collected = collectedKobo(p);
    if (collected == null) return { ok: false, error: 'We do not know how much Paystack collected on this one. Refund it from your Paystack dashboard.' };
    const left = collected - p.refunded_kobo;
    if (left <= 0) return { ok: false, error: 'This payment has already been refunded in full.' };
    if (d.amountKobo > left) return { ok: false, error: `Only ${naira(left)} is left to refund on this payment.` };
    const key = `${p.provider_ref}-${p.refunded_kobo}-${d.amountKobo}`;
    const text = `${reason.label}${note ? `: ${note}` : ''}`;
    const r = await refundPayment(p.order_id, d.amountKobo, key, { providerRef: p.provider_ref, reason: text, staffId: who.id ?? null, allowStatuses: ['success', 'review', 'amount_mismatch'] });
    if (!r.ok) return { ok: false, error: r.error ?? 'The refund did not go through.' };

    const order = await one<{ id: string; code: string; total_kobo: number; status: string; public_token: string }>('select id, code, total_kobo, status, public_token from orders where id = $1', [p.order_id]);
    const fullyRefunded = p.status === 'success' && p.refunded_kobo + d.amountKobo >= order!.total_kobo;
    if (fullyRefunded && ['paid', 'in_production', 'delivered'].includes(order!.status)) await query("update orders set status = 'refunded' where id = $1", [order!.id]);
    // The customer hears about it. A duplicate payment is the one case worth a message even when the order itself carries on.
    await queueMessage({ query }, { orderId: order!.id, template: 'refund_issued', vars: { amount: naira(d.amountKobo), code: order!.code } });
    await flushMessages().catch(() => {});
    await audit(who, { area: 'refund', action: 'refund', target: order!.code, summary: `Refunded ${naira(d.amountKobo)} on ${order!.code} (${text})`, detail: { paymentId: p.id, ref: p.provider_ref, amountKobo: d.amountKobo, orderStatus: fullyRefunded ? 'refunded' : order!.status } });
    return { ok: true, message: `Refunded ${naira(d.amountKobo)}.${paystackOn() ? ' Paystack sends it back to the customer, which can take a few days.' : ' (Demo: nothing was sent to a bank.)'}${fullyRefunded ? ' The order is marked refunded.' : ''}` };
  });
  return run.ran ? run.value : { ok: false, error: 'Another refund is being sent. Wait a few seconds and look again.' };
}

/** Ask Paystack about a payment that has not settled and apply it if it was paid. */
export async function reconcilePayment(who: Who, paymentId: string): Promise<RefundResult> {
  const p = await one<{ id: string; provider_ref: string; status: string; order_id: string }>('select id, provider_ref, status, order_id from payments where id = $1', [paymentId]);
  if (!p) return { ok: false, error: 'That payment was not found.' };
  if (p.status === 'success') return { ok: true, message: 'This payment is already confirmed.' };
  if (!paystackOn()) return { ok: false, error: 'Paystack is not connected, so there is nothing to ask.' };
  const c = await checkWithPaystack(p.provider_ref);
  if (c.kind === 'error') return { ok: false, error: `Could not ask Paystack: ${c.message}` };
  if (c.kind === 'unpaid') return { ok: true, message: 'Paystack says this payment was not completed. No money was taken.' };
  const r = await confirmPayment({ reference: p.provider_ref, amountKobo: c.amountKobo, method: c.method, raw: c.raw });
  await audit(who, { area: 'refund', action: 'reconcile', target: p.provider_ref, summary: r.ok ? `Confirmed payment ${p.provider_ref} with Paystack` : `Paystack took payment ${p.provider_ref} but it could not be applied (${r.reason})` });
  if (r.ok) return { ok: true, message: r.duplicate ? 'Already confirmed.' : `Paystack confirms ${naira(c.amountKobo)} was paid. The order is now paid and in the file desk queue.` };
  await alertPaymentNotApplied(p.provider_ref, r.reason).catch(() => {});
  return { ok: false, error: r.reason === 'ORDER_STATE' ? `Paystack took ${naira(c.amountKobo)}, but the order is already paid or was cancelled. Refund this payment (it is money collected twice).` : r.reason === 'AMOUNT_MISMATCH' ? `Paystack took ${naira(c.amountKobo)}, which is not the order total. Refund it, or ask the customer to pay the difference.` : 'We have no order with that reference.' };
}

export const orderLink = (token: string) => `${appUrl()}/track/${token}`;
