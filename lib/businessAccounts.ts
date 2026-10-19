import { one, query, tx } from './db';
import type { Q } from './db';
import { token } from './password';
import { appUrl } from './messages';
import { lagosDate, lagosParts, ymdOf } from './time';

/*
 * A business account is one company with several people under it.
 *  - The person who set the company up is its owner. Anyone they send the join link to becomes a member.
 *  - Members order for the company: the order carries the company's name and tax number, and uses the company's brand kit.
 *  - A member sees only their own orders. The owner sees every company order and gets the monthly statement for finance.
 *  - Only the owner can change the brand kit, remove people or replace the join link.
 */

type Db = Pick<Q, 'query'>;

export type Role = 'owner' | 'member';
export const joinUrl = (tokenValue: string) => `${appUrl()}/join/${tokenValue}`;

/** Called whenever a customer is put under a company. The first person to claim a company with no owner becomes its owner. */
export async function claimBusiness(q: Db, businessId: string, customerId: string): Promise<Role> {
  const b = (await q.query<{ owner_customer_id: string | null; join_token: string | null }>('select owner_customer_id, join_token from businesses where id = $1', [businessId]))[0];
  if (!b) return 'member';
  if (!b.owner_customer_id || b.owner_customer_id === customerId) {
    await q.query('update businesses set owner_customer_id = $2, join_token = coalesce(join_token, $3) where id = $1', [businessId, customerId, token(20)]);
    await q.query("update customers set business_role = 'owner' where id = $1", [customerId]);
    return 'owner';
  }
  await q.query("update customers set business_role = coalesce(business_role, 'member') where id = $1", [customerId]);
  return 'member';
}

export type Member = { id: string; name: string; role: Role; joinedAt: string; phone: string | null; email: string | null; orders: number };
export type CompanyOrder = { code: string; token: string; status: string; totalKobo: number; createdAt: string; by: string; summary: string };
export type BusinessView = {
  id: string; name: string; taxId: string | null; role: Role; ownerName: string;
  members: Member[]; joinUrl: string | null; orders: CompanyOrder[];
};

const PAID = "('paid','in_production','delivered')";
const firstName = (n: unknown) => String(n ?? '').trim().split(/\s+/)[0] || 'Someone';

/** Everything the "My business" page shows. Null when the customer is not under a company. */
export async function businessView(customerId: string): Promise<BusinessView | null> {
  const me = await one<{ business_id: string | null; business_role: Role | null }>('select business_id, business_role from customers where id = $1', [customerId]);
  if (!me?.business_id) return null;
  const b = await one<{ id: string; name: string; tax_id: string | null; owner_customer_id: string | null; join_token: string | null }>('select * from businesses where id = $1', [me.business_id]);
  if (!b) return null;
  const role: Role = me.business_role ?? (b.owner_customer_id === customerId ? 'owner' : 'member');
  const people = await query<any>(
    `select c.id, c.name, c.business_role, c.created_at, c.phone, c.whatsapp_phone, c.email,
            (select count(*)::int from orders o where o.customer_id = c.id and o.business_id = c.business_id and o.status in ${PAID}) as orders
       from customers c where c.business_id = $1 order by (c.id = $2) desc, c.created_at, c.id`, [b.id, b.owner_customer_id]);
  const owner = people.find((p) => p.id === b.owner_customer_id);
  const isOwner = role === 'owner';
  const orders = await query<any>(
    `select o.code, o.public_token, o.status, o.total_kobo, o.created_at, c.name as by,
            (select string_agg(coalesce(i.label, p.name) || ' × ' || i.quantity, ', ' order by i.position, i.id) from order_items i join products p on p.id = i.product_id where i.order_id = o.id) as summary
       from orders o left join customers c on c.id = o.customer_id
      where o.business_id = $1 and o.status <> 'draft' ${isOwner ? '' : 'and o.customer_id = $2'}
      order by o.created_at desc limit 40`,
    isOwner ? [b.id] : [b.id, customerId]);
  return {
    id: b.id, name: b.name, taxId: b.tax_id, role, ownerName: firstName(owner?.name),
    members: people.map((p) => ({
      id: p.id, name: p.name ?? 'Member', role: (p.business_role ?? (p.id === b.owner_customer_id ? 'owner' : 'member')) as Role, joinedAt: new Date(p.created_at).toISOString(),
      // Contact details are for the owner, who needs to reach their own people.
      phone: isOwner ? (p.whatsapp_phone ?? p.phone) : null, email: isOwner ? p.email : null, orders: p.orders,
    })),
    joinUrl: isOwner && b.join_token ? joinUrl(b.join_token) : null,
    orders: orders.map((o) => ({ code: o.code, token: o.public_token, status: o.status, totalKobo: o.total_kobo, createdAt: new Date(o.created_at).toISOString(), by: o.by ?? '', summary: o.summary ?? '' })),
  };
}

/** What someone sees before they accept a join link. Never anything about the other members. */
export async function joinPreview(tokenValue: string): Promise<{ name: string; owner: string } | null> {
  if (!/^[\w-]{10,40}$/.test(tokenValue)) return null;
  const b = await one<any>('select b.name, c.name as owner from businesses b left join customers c on c.id = b.owner_customer_id where b.join_token = $1', [tokenValue]);
  return b ? { name: b.name, owner: firstName(b.owner) } : null;
}

export type Outcome = { ok: true } | { ok: false; error: string };

export async function joinBusiness(customerId: string, tokenValue: string): Promise<Outcome> {
  if (!/^[\w-]{10,40}$/.test(tokenValue)) return { ok: false, error: 'This join link is not valid. Ask the owner for a new one.' };
  return tx(async (q) => {
    const b = (await q.query<{ id: string; name: string }>('select id, name from businesses where join_token = $1', [tokenValue]))[0];
    if (!b) return { ok: false as const, error: 'This join link is not valid any more. Ask the owner for a new one.' };
    const me = (await q.query<{ business_id: string | null; business_role: Role | null }>('select business_id, business_role from customers where id = $1 for update', [customerId]))[0];
    if (!me) return { ok: false as const, error: 'We could not find your account.' };
    if (me.business_id === b.id) return { ok: true as const };
    if (me.business_id && me.business_role === 'owner') {
      const others = (await q.query<{ n: number }>('select count(*)::int as n from customers where business_id = $1 and id <> $2', [me.business_id, customerId]))[0].n;
      if (others > 0) return { ok: false as const, error: 'You run a company account with other people in it. Remove them or hand it over before joining another company.' };
    }
    await q.query("update customers set business_id = $2, business_role = 'member', account_type = 'business' where id = $1", [customerId, b.id]);
    await q.query("insert into events (name, props) values ('business_joined', '{}')");
    return { ok: true as const };
  });
}

/** Leave a company. The owner cannot leave while other people are in it. */
export async function leaveBusiness(customerId: string): Promise<Outcome> {
  const me = await one<{ business_id: string | null; business_role: Role | null }>('select business_id, business_role from customers where id = $1', [customerId]);
  if (!me?.business_id) return { ok: true };
  if (me.business_role === 'owner') {
    const others = (await one<{ n: number }>('select count(*)::int as n from customers where business_id = $1 and id <> $2', [me.business_id, customerId]))!.n;
    if (others > 0) return { ok: false, error: 'You own this company account. Remove the other people first, or hand the account over.' };
  }
  await query("update customers set business_id = null, business_role = null where id = $1", [customerId]);
  return { ok: true };
}

/** The owner takes someone out of the company. Their old orders stay on the company's record. */
export async function removeMember(ownerId: string, memberId: string): Promise<Outcome> {
  if (ownerId === memberId) return { ok: false, error: 'You cannot remove yourself. Use leave instead.' };
  const o = await one<{ business_id: string | null; business_role: Role | null }>('select business_id, business_role from customers where id = $1', [ownerId]);
  if (!o?.business_id || o.business_role !== 'owner') return { ok: false, error: 'Only the owner of the company account can remove people.' };
  const r = await query("update customers set business_id = null, business_role = null where id = $1 and business_id = $2 and business_role = 'member' returning id", [memberId, o.business_id]);
  return r.length ? { ok: true } : { ok: false, error: 'That person is not in your company account.' };
}

/** A new join link; the old one stops working at once. */
export async function replaceJoinLink(ownerId: string): Promise<Outcome> {
  const o = await one<{ business_id: string | null; business_role: Role | null }>('select business_id, business_role from customers where id = $1', [ownerId]);
  if (!o?.business_id || o.business_role !== 'owner') return { ok: false, error: 'Only the owner of the company account can do that.' };
  await query('update businesses set join_token = $2 where id = $1', [o.business_id, token(20)]);
  return { ok: true };
}

/** The owner hands the company to a member. */
export async function handOver(ownerId: string, memberId: string): Promise<Outcome> {
  const o = await one<{ business_id: string | null; business_role: Role | null }>('select business_id, business_role from customers where id = $1', [ownerId]);
  if (!o?.business_id || o.business_role !== 'owner') return { ok: false, error: 'Only the owner of the company account can do that.' };
  const m = await one('select 1 as x from customers where id = $1 and business_id = $2 and business_role = \'member\'', [memberId, o.business_id]);
  if (!m) return { ok: false, error: 'That person is not in your company account.' };
  await tx(async (q) => {
    await q.query('update businesses set owner_customer_id = $2 where id = $1', [o.business_id, memberId]);
    await q.query("update customers set business_role = 'member' where id = $1", [ownerId]);
    await q.query("update customers set business_role = 'owner' where id = $1", [memberId]);
  });
  return { ok: true };
}

/** Deleting an account must not strand a company: the longest-standing member takes it over. */
export async function handOverOnDelete(q: Db, customerId: string): Promise<void> {
  const me = (await q.query<{ business_id: string | null; business_role: Role | null }>('select business_id, business_role from customers where id = $1', [customerId]))[0];
  if (!me?.business_id || me.business_role !== 'owner') return;
  const next = (await q.query<{ id: string }>('select id from customers where business_id = $1 and id <> $2 order by created_at, id limit 1', [me.business_id, customerId]))[0];
  if (next) {
    await q.query('update businesses set owner_customer_id = $2 where id = $1', [me.business_id, next.id]);
    await q.query("update customers set business_role = 'owner' where id = $1", [next.id]);
  } else {
    await q.query('update businesses set owner_customer_id = null, join_token = null where id = $1', [me.business_id]);
  }
}

// ---------- the monthly statement ----------

export type StatementLine = {
  code: string; paidAt: string; by: string; summary: string;
  printKobo: number; designKobo: number; deliveryKobo: number; discountKobo: number; vatKobo: number; totalKobo: number;
};
export type Statement = { month: string; label: string; business: string; taxId: string | null; lines: StatementLine[]; totals: Omit<StatementLine, 'code' | 'paidAt' | 'by' | 'summary'> };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The first moment of a month and of the next, in Lagos time. */
export function monthRange(month: string): { from: Date; to: Date; label: string } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]);
  const ny = mo === 12 ? y + 1 : y; const nm = mo === 12 ? 1 : mo + 1;
  return { from: lagosDate(ymdOf(y, mo, 1), '00:00'), to: lagosDate(ymdOf(ny, nm, 1), '00:00'), label: `${MONTHS[mo - 1]} ${y}` };
}

/** The month before `now` in Lagos, as 2026-09. */
export function lastMonth(now = new Date()): string {
  const p = lagosParts(now).ymd;
  const [y, m] = p.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Every company order paid in a month, for the owner's finance team. Refunded and cancelled orders are not in it. */
export async function statementFor(ownerId: string, month: string): Promise<Statement | null> {
  const range = monthRange(month);
  if (!range) return null;
  const o = await one<{ business_id: string | null; business_role: Role | null }>('select business_id, business_role from customers where id = $1', [ownerId]);
  if (!o?.business_id || o.business_role !== 'owner') return null;
  const b = await one<{ name: string; tax_id: string | null }>('select name, tax_id from businesses where id = $1', [o.business_id]);
  if (!b) return null;
  const rows = await query<any>(
    `select o.code, o.paid_at, c.name as by, o.subtotal_kobo, o.design_fee_kobo, o.delivery_fee_kobo, o.discount_kobo, o.vat_kobo, o.total_kobo,
            (select string_agg(coalesce(i.label, p.name) || ' × ' || i.quantity, ', ' order by i.position, i.id) from order_items i join products p on p.id = i.product_id where i.order_id = o.id) as summary
       from orders o left join customers c on c.id = o.customer_id
      where o.business_id = $1 and o.status in ${PAID} and o.paid_at >= $2 and o.paid_at < $3 order by o.paid_at, o.code`,
    [o.business_id, range.from.toISOString(), range.to.toISOString()]);
  const lines: StatementLine[] = rows.map((r) => ({
    code: r.code, paidAt: new Date(r.paid_at).toISOString(), by: r.by ?? '', summary: r.summary ?? '',
    printKobo: r.subtotal_kobo ?? 0, designKobo: r.design_fee_kobo ?? 0, deliveryKobo: r.delivery_fee_kobo ?? 0, discountKobo: r.discount_kobo ?? 0, vatKobo: r.vat_kobo ?? 0, totalKobo: r.total_kobo ?? 0,
  }));
  const sum = (k: keyof StatementLine) => lines.reduce((a, l) => a + (l[k] as number), 0);
  return {
    month, label: range.label, business: b.name, taxId: b.tax_id, lines,
    totals: { printKobo: sum('printKobo'), designKobo: sum('designKobo'), deliveryKobo: sum('deliveryKobo'), discountKobo: sum('discountKobo'), vatKobo: sum('vatKobo'), totalKobo: sum('totalKobo') },
  };
}

const csvCell = (v: unknown) => {
  let s = String(v ?? '');
  // A cell that starts with = + - @ would run as a formula when opened in Excel.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const naira2 = (kobo: number) => (kobo / 100).toFixed(2);

/** The statement as a spreadsheet file: amounts in naira, one row per order, a total at the bottom. */
export function statementCsv(s: Statement): string {
  const head = ['Order', 'Paid on', 'Ordered by', 'What', 'Print', 'Design', 'Delivery', 'Discount', 'VAT included', 'Total'];
  const rows = s.lines.map((l) => [l.code, l.paidAt.slice(0, 10), l.by, l.summary, naira2(l.printKobo), naira2(l.designKobo), naira2(l.deliveryKobo), naira2(l.discountKobo), naira2(l.vatKobo), naira2(l.totalKobo)]);
  const t = s.totals;
  const foot = ['Total', '', '', `${s.lines.length} order${s.lines.length === 1 ? '' : 's'}`, naira2(t.printKobo), naira2(t.designKobo), naira2(t.deliveryKobo), naira2(t.discountKobo), naira2(t.vatKobo), naira2(t.totalKobo)];
  const title = [[`${s.business} · ${s.label}`], s.taxId ? [`Tax ID ${s.taxId}`] : []].filter((r) => r.length);
  return [...title, head, ...rows, foot].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

