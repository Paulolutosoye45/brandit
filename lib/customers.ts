import { one, query } from './db';
import { audit, type Who } from './audit';
import { normalizePhone } from './phone';

/*
 * The customer side of the console: who has ordered, what they spent, and the notes the team keeps. Reads only, plus notes.
 * A "customer" here is an account. Someone who ordered as a guest before sign-in was required is one too.
 */
export type CustomerFilter = 'all' | 'repeat' | 'business' | 'new' | 'agreed';
export const FILTERS: { key: CustomerFilter; label: string }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'repeat', label: 'Ordered 2+ times' },
  { key: 'business', label: 'Businesses' },
  { key: 'new', label: 'New this month' },
  { key: 'agreed', label: 'Agreed to offers' },
];

export type CustomerRow = {
  id: string; name: string | null; email: string | null; phone: string | null; whatsapp_phone: string | null; account_type: string; company: string | null;
  marketing_opt_in: boolean; created_at: string; last_sign_in_at: string | null; orders: number; spent_kobo: number; last_order_at: string | null;
};

const PAID = "('paid','in_production','delivered')";
const LIST_SQL = `
  select c.id, c.name, c.email, c.phone, c.whatsapp_phone, c.account_type, b.name as company, c.marketing_opt_in, c.created_at, c.last_sign_in_at,
         coalesce(o.orders, 0)::int as orders, coalesce(o.spent, 0)::int as spent_kobo, o.last_order_at
  from customers c
  left join businesses b on b.id = c.business_id
  left join lateral (select count(*) as orders, sum(total_kobo) as spent, max(paid_at) as last_order_at from orders x where x.customer_id = c.id and x.status in ${PAID}) o on true`;

const where = (filter: CustomerFilter, qIndex: number) => {
  const parts: string[] = [`($${qIndex}::text = '' or c.name ilike $${qIndex + 1} or c.email ilike $${qIndex + 1} or c.phone like $${qIndex + 1} or c.whatsapp_phone like $${qIndex + 1} or b.name ilike $${qIndex + 1} or exists (select 1 from orders z where z.customer_id = c.id and z.code ilike $${qIndex + 1}))`];
  if (filter === 'repeat') parts.push('coalesce(o.orders, 0) >= 2');
  if (filter === 'business') parts.push("(c.account_type = 'business' or c.business_id is not null)");
  if (filter === 'new') parts.push("c.created_at >= date_trunc('month', now())");
  if (filter === 'agreed') parts.push('c.marketing_opt_in');
  return parts.join(' and ');
};

const likeOf = (q: string) => {
  const t = q.trim().replace(/[%_\\]/g, (c) => `\\${c}`);
  // A phone typed the way people write it (0803 123 4567) should find +2348031234567.
  const asPhone = normalizePhone(q);
  return { text: q.trim(), like: `%${asPhone ?? t}%` };
};

export async function listCustomers(o: { q?: string; filter?: CustomerFilter; page?: number; sort?: 'recent' | 'spent' | 'orders'; pageSize?: number } = {}): Promise<{ rows: CustomerRow[]; total: number; pages: number; page: number }> {
  const size = Math.min(Math.max(o.pageSize ?? 40, 5), 200);
  const page = Math.max(o.page ?? 1, 1);
  const f = o.filter ?? 'all';
  const { text, like } = likeOf(o.q ?? '');
  const w = where(f, 1);
  const order = o.sort === 'spent' ? 'o.spent desc nulls last' : o.sort === 'orders' ? 'o.orders desc nulls last' : 'coalesce(o.last_order_at, c.created_at) desc';
  const total = (await one<{ n: number }>(`select count(*)::int as n from (${LIST_SQL} where ${w}) t`, [text, like]))?.n ?? 0;
  const rows = await query<CustomerRow>(`${LIST_SQL} where ${w} order by ${order}, c.id limit $3 offset $4`, [text, like, size, (page - 1) * size]);
  return { rows, total, pages: Math.max(1, Math.ceil(total / size)), page };
}

/** Every customer matching the list's filter, for the spreadsheet. */
export async function exportRows(o: { q?: string; filter?: CustomerFilter } = {}): Promise<CustomerRow[]> {
  const { text, like } = likeOf(o.q ?? '');
  return query<CustomerRow>(`${LIST_SQL} where ${where(o.filter ?? 'all', 1)} order by c.created_at, c.id`, [text, like]);
}

const csvCell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  // A spreadsheet runs anything that starts with = + - @ as a formula. A customer chooses their own name, so neutralise it.
  // A phone number (+234 803 123 4567) or a plain number is safe as it is, and customers expect to see it unchanged.
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?[\d\s()-]+$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function customersCsv(rows: CustomerRow[]): string {
  const head = ['Name', 'Phone (sign-in)', 'WhatsApp for updates', 'Email', 'Account type', 'Company', 'Orders paid', 'Total paid (naira)', 'Last order', 'Joined', 'Agreed to offers'];
  const day = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');
  const lines = rows.map((r) => [r.name, r.phone, r.whatsapp_phone, r.email, r.account_type, r.company, r.orders, (r.spent_kobo / 100).toFixed(2), day(r.last_order_at), day(r.created_at), r.marketing_opt_in ? 'yes' : 'no'].map(csvCell).join(','));
  return `﻿${[head.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`;
}

export type CustomerDetail = {
  c: Record<string, any>;
  company: { name: string; tax_id: string | null } | null;
  orders: { id: string; code: string; status: string; total_kobo: number; created_at: string; paid_at: string | null; summary: string; public_token: string }[];
  notes: { id: string; body: string; staff_name: string; created_at: string }[];
  methods: string[];
  claims: number;
  designs: number;
  custom: { code: string; title: string; status: string; created_at: string }[];
  stats: { orders: number; spent_kobo: number; first: string | null; last: string | null; average_kobo: number };
};

export async function customerDetail(id: string): Promise<CustomerDetail | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const c = await one<Record<string, any>>(
    'select id, name, email, email_verified, phone, whatsapp_phone, account_type, default_area, marketing_opt_in, lang, created_at, last_sign_in_at, business_id, business_role, google_sub is not null as has_google from customers where id = $1', [id],
  );
  if (!c) return null;
  const [company, orders, notes, methods, claims, designs, custom, stats] = await Promise.all([
    c.business_id ? one<{ name: string; tax_id: string | null }>('select name, tax_id from businesses where id = $1', [c.business_id]) : Promise.resolve(null),
    query<CustomerDetail['orders'][number]>(
      `select o.id, o.code, o.status, o.total_kobo, o.created_at, o.paid_at, o.public_token,
              (select string_agg(coalesce(i.label, p.name) || ' × ' || i.quantity, ', ' order by i.position, i.id) from order_items i join products p on p.id = i.product_id where i.order_id = o.id) as summary
       from orders o where o.customer_id = $1 and o.status <> 'draft' order by o.created_at desc limit 100`, [id]),
    query<CustomerDetail['notes'][number]>('select id, body, staff_name, created_at from customer_notes where customer_id = $1 order by created_at desc', [id]),
    query<{ method: string }>('select distinct method from sign_ins where customer_id = $1', [id]),
    one<{ n: number }>('select count(*)::int as n from claims cl join orders o on o.id = cl.order_id where o.customer_id = $1', [id]),
    one<{ n: number }>("select count(*)::int as n from studio_projects where customer_id = $1 and status <> 'purged'", [id]),
    query<CustomerDetail['custom'][number]>('select code, title, status, created_at from custom_requests where customer_id = $1 order by created_at desc limit 10', [id]),
    one<{ orders: number; spent: number; first: string | null; last: string | null }>(`select count(*)::int as orders, coalesce(sum(total_kobo),0)::int as spent, min(paid_at) as first, max(paid_at) as last from orders where customer_id = $1 and status in ${PAID}`, [id]),
  ]);
  const n = stats?.orders ?? 0;
  return {
    c, company, orders, notes, methods: methods.map((m) => m.method), claims: claims?.n ?? 0, designs: designs?.n ?? 0, custom,
    stats: { orders: n, spent_kobo: stats?.spent ?? 0, first: stats?.first ?? null, last: stats?.last ?? null, average_kobo: n ? Math.round((stats?.spent ?? 0) / n) : 0 },
  };
}

export async function addNote(customerId: string, who: Who, body: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const text = body.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1000);
  if (text.length < 2) return { ok: false, error: 'Write the note first.' };
  const c = await one<{ id: string; name: string | null }>('select id, name from customers where id = $1', [customerId]);
  if (!c) return { ok: false, error: 'That customer was not found.' };
  await query('insert into customer_notes (customer_id, body, staff_id, staff_name) values ($1,$2,$3,$4)', [customerId, text, who.id ?? null, who.name]);
  await audit(who, { area: 'customer', action: 'note_added', target: c.name ?? customerId, summary: 'Added a note', detail: { customerId } });
  return { ok: true };
}

export async function deleteNote(noteId: string, who: Who): Promise<void> {
  const n = await one<{ customer_id: string }>('delete from customer_notes where id = $1 returning customer_id', [noteId]);
  if (n) await audit(who, { area: 'customer', action: 'note_deleted', target: n.customer_id, summary: 'Deleted a note' });
}
