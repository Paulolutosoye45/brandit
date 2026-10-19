import { one, query } from './db';
import type { PaymentRow } from './paymentsAdmin';

/** Everything the console shows about one order, found by its code (BR-1042) or its id. */
export type OrderDetail = {
  o: Record<string, any>;
  customer: { id: string; name: string | null; phone: string | null; whatsapp_phone: string | null; email: string | null } | null;
  lines: { id: string; name: string; quantity: number; line_total_kobo: number; artwork_path: string | null; job_id: string | null; stage: string | null; paused: boolean | null }[];
  payments: PaymentRow[];
  messages: { id: number; template: string; body: string; status: string; channel: string; created_at: string; error: string | null }[];
  claims: { id: string; kind: string; status: string; resolution: string | null; description: string | null; created_at: string }[];
  events: { at: string; to_stage: string; note: string | null; staff: string | null; product: string }[];
};

export async function orderDetail(ref: string): Promise<OrderDetail | null> {
  const isId = /^[0-9a-f-]{36}$/.test(ref);
  const o = await one<Record<string, any>>(`select * from orders where ${isId ? 'id' : 'upper(code)'} = $1`, [isId ? ref : ref.toUpperCase()]);
  if (!o) return null;
  const [customer, lines, payments, messages, claims, events] = await Promise.all([
    o.customer_id ? one<OrderDetail['customer'] & object>('select id, name, phone, whatsapp_phone, email from customers where id = $1', [o.customer_id]) : Promise.resolve(null),
    query<OrderDetail['lines'][number]>(
      `select i.id, coalesce(i.label, p.name) as name, i.quantity, i.line_total_kobo, i.artwork_path, j.id as job_id, j.stage, j.clock_paused as paused
       from order_items i join products p on p.id = i.product_id left join jobs j on j.order_item_id = i.id where i.order_id = $1 order by i.position, i.id`, [o.id]),
    query<PaymentRow>(
      `select p.id, p.order_id, $2::text as code, null::text as customer, p.provider_ref, p.method, p.amount_kobo, p.status, p.created_at, p.verified_at, p.refund_reason, s.name as staff_name, p.payer_name, p.payer_email, p.raw, 0 as refunded_kobo, $3::text as order_status
       from payments p left join staff s on s.id = p.staff_id where p.order_id = $1 and p.status <> 'superseded' order by p.created_at, p.id`, [o.id, o.code, o.status]),
    query<OrderDetail['messages'][number]>('select id, template, body, status, channel, created_at, error from messages where order_id = $1 order by id desc limit 20', [o.id]),
    query<OrderDetail['claims'][number]>('select id, kind, status, resolution, description, created_at from claims where order_id = $1 order by created_at desc', [o.id]),
    query<OrderDetail['events'][number]>(
      `select e.created_at as at, e.to_stage, e.note, s.name as staff, coalesce(i.label, p.name) as product
       from job_events e join jobs j on j.id = e.job_id join order_items i on i.id = j.order_item_id join products p on p.id = i.product_id left join staff s on s.id = e.staff_id
       where j.order_id = $1 order by e.created_at, e.id`, [o.id]),
  ]);
  // How much of each payment has been refunded: refunds name the payment they came out of, older ones count against the first paid one.
  const firstPaid = payments.find((p) => p.status === 'success' && p.amount_kobo > 0)?.id;
  for (const p of payments) {
    if (p.status === 'refund') continue;
    p.refunded_kobo = payments.filter((r) => r.status === 'refund' && ((r.raw?.refund_of ?? null) === p.provider_ref || (!r.raw?.refund_of && p.id === firstPaid))).reduce((a, r) => a - r.amount_kobo, 0);
  }
  return { o, customer, lines, payments, messages, claims, events };
}
