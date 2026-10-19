import { beforeAll, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';

process.env.PGLITE_DIR = 'memory';
process.env.DEMO_MODE = 'true';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-biz-${process.pid}`);
delete process.env.PAYSTACK_SECRET_KEY;

let db: typeof import('../lib/db');
let O: typeof import('../lib/orders');
let BA: typeof import('../lib/businessAccounts');
let K: typeof import('../lib/brandKit');
let I: typeof import('../lib/identity');
let Pay: typeof import('../lib/payments');
let Priv: typeof import('../lib/privacy');

beforeAll(async () => {
  db = await import('../lib/db');
  await db.ready();
  O = await import('../lib/orders');
  BA = await import('../lib/businessAccounts');
  K = await import('../lib/brandKit');
  I = await import('../lib/identity');
  Pay = await import('../lib/payments');
  Priv = await import('../lib/privacy');
}, 60_000);

let n = 0;
const person = async (label: string) => {
  n++;
  return (await I.signInEmail(`${label}${n}@example.com`)).customer;
};
/** Checks out a flyers order and pays for it, as this customer, optionally typing a company name. */
async function pay(c: { id: string; email: string | null }, opts: { company?: string; taxId?: string } = {}) {
  n++;
  const d: any = await O.createDraft({ slug: 'flyers', quantity: 100, area: 'Yaba' });
  await db.query('update orders set customer_id = $2 where id = $1', [d.id, c.id]);
  const item = (await O.getItem(d.id))!;
  const f = await db.one<{ id: string }>(
    "insert into files (order_id, order_item_id, kind, storage_key, original_name, mime, bytes, width_px, height_px, check_result) values ($1,$2,'artwork','x.png','art.png','image/png',1000,3000,2000,'{\"status\":\"pass\"}') returning id",
    [d.id, item.id]);
  await db.query("update order_items set artwork_path = 'upload', artwork_file_id = $2, preview_approved_at = now() where id = $1", [item.id, f!.id]);
  const ck = await O.saveCheckout(d.id, { name: 'Test Person', phone: `0807${String(4000000 + n).slice(-7)}`, email: c.email ?? 'x@example.com', pickup: false, area: 'Yaba', addressLine: '1 Test Road, Yaba', company: opts.company, taxId: opts.taxId } as any, c.id);
  expect(ck.ok, JSON.stringify(ck)).toBe(true);
  const o = (await O.getOrder(d.id))!;
  const p = await Pay.initPayment(o, c.email ?? 'x@example.com');
  expect((await O.confirmPayment({ reference: p.reference, amountKobo: o.total_kobo, method: 'card' })).ok).toBe(true);
  return (await O.getOrder(d.id))!;
}

/** An owner with a company, and one member who joined with the link. */
async function company(name = 'Okafor Bakery Ltd') {
  const owner = await person('owner');
  const o = await pay(owner, { company: name, taxId: '12345678-0001' });
  const biz = (await BA.businessView(owner.id))!;
  const link = biz.joinUrl!.split('/').pop()!;
  const member = await person('member');
  expect((await BA.joinBusiness(member.id, link)).ok).toBe(true);
  return { owner, member, ownerOrder: o, link, biz };
}

describe('setting a company up', () => {
  it('makes the person who first enters the company name its owner, with a join link', async () => {
    const owner = await person('owner');
    const o = await pay(owner, { company: 'Eze Printing Works' });
    expect(o.business_id).toBeTruthy();
    const v = await BA.businessView(owner.id);
    expect(v?.role).toBe('owner');
    expect(v?.name).toBe('Eze Printing Works');
    expect(v?.joinUrl).toMatch(/\/join\/[\w-]{20}$/);
    expect(v?.members.map((m) => m.role)).toEqual(['owner']);
  });

  it('gives a person with no company nothing to show', async () => {
    const solo = await person('solo');
    expect(await BA.businessView(solo.id)).toBeNull();
  });
});

describe('joining with the link', () => {
  it('puts the member under the company, and their orders carry its name even if they type another', async () => {
    const t = await company();
    const view = (await BA.businessView(t.member.id))!;
    expect(view.role).toBe('member');
    expect(view.name).toBe('Okafor Bakery Ltd');
    expect(view.joinUrl).toBeNull(); // only the owner can invite
    const order = await pay(t.member, { company: 'Something Else Ltd' });
    expect(order.business_id).toBe(t.ownerOrder.business_id);
    const cust = (await db.one<any>('select business_id, business_role from customers where id = $1', [t.member.id]))!;
    expect(cust.business_id).toBe(t.ownerOrder.business_id);
    expect(cust.business_role).toBe('member');
  });

  it('shows the company name and the owner only, before anyone joins', async () => {
    const t = await company('Preview Co');
    const p = await BA.joinPreview(t.link);
    expect(p?.name).toBe('Preview Co');
    expect(JSON.stringify(p)).not.toContain('@');
    expect(await BA.joinPreview('short')).toBeNull();
    expect(await BA.joinPreview('x'.repeat(20))).toBeNull();
  });

  it('stops working when the owner makes a new link', async () => {
    const t = await company();
    expect((await BA.replaceJoinLink(t.member.id)).ok).toBe(false); // a member cannot
    expect((await BA.replaceJoinLink(t.owner.id)).ok).toBe(true);
    const late = await person('late');
    expect((await BA.joinBusiness(late.id, t.link)).ok).toBe(false);
    const fresh = (await BA.businessView(t.owner.id))!.joinUrl!.split('/').pop()!;
    expect(fresh).not.toBe(t.link);
    expect((await BA.joinBusiness(late.id, fresh)).ok).toBe(true);
  });

  it('will not let an owner with a team walk out into another company', async () => {
    const a = await company('Alpha Ltd');
    const b = await company('Beta Ltd');
    const r = await BA.joinBusiness(a.owner.id, b.link);
    expect(r.ok).toBe(false);
    expect((await BA.businessView(a.owner.id))?.name).toBe('Alpha Ltd');
  });
});

describe('who sees what', () => {
  it('lets the owner see every company order and a member only their own', async () => {
    const t = await company();
    const mine = await pay(t.member);
    const ownerSees = (await BA.businessView(t.owner.id))!.orders.map((o) => o.code);
    expect(ownerSees).toContain(mine.code);
    expect(ownerSees).toContain(t.ownerOrder.code);
    const memberSees = (await BA.businessView(t.member.id))!.orders.map((o) => o.code);
    expect(memberSees).toEqual([mine.code]);
  });

  it('shows contact details to the owner and names only to members', async () => {
    const t = await company();
    const asOwner = (await BA.businessView(t.owner.id))!;
    const asMember = (await BA.businessView(t.member.id))!;
    expect(asOwner.members.some((m) => m.email)).toBe(true);
    expect(asMember.members.every((m) => m.email === null && m.phone === null)).toBe(true);
  });
});

describe('the shared brand kit', () => {
  it('is the owner\'s kit for every member, and only the owner can change it', async () => {
    const t = await company();
    await K.saveBrandKit(t.owner.id, { display_name: 'Okafor Bakery', tagline: 'Fresh every morning', primary_hex: '#aa3300' });
    expect((await K.brandKitFor(t.member.id))?.display_name).toBe('Okafor Bakery');
    expect(await K.kitOwnerId(t.member.id)).toBe(t.owner.id);
    await expect(K.saveBrandKit(t.member.id, { display_name: 'Mine now' })).rejects.toThrow(/Only the owner/);
    await expect(K.addAsset(t.member.id, 'logo', 'x', { name: 'x.png', buf: Buffer.from('nope') })).rejects.toThrow(/Only the owner/);
    expect(await K.deleteAsset(t.owner.id, '00000000-0000-0000-0000-000000000000')).toBe(false);
    expect((await K.brandKitFor(t.member.id))?.display_name).toBe('Okafor Bakery');
    // The designer's brief for a member's order carries the company's kit.
    const snap = await K.brandSnapshot(t.member.id);
    expect(snap?.name).toBe('Okafor Bakery');
    expect(snap?.tagline).toBe('Fresh every morning');
  });

  it('goes back to the member\'s own kit when they leave', async () => {
    const t = await company();
    await K.saveBrandKit(t.owner.id, { display_name: 'Company kit' });
    expect((await BA.leaveBusiness(t.member.id)).ok).toBe(true);
    expect(await K.kitOwnerId(t.member.id)).toBe(t.member.id);
    expect(await K.brandKitFor(t.member.id)).toBeNull();
    expect(await BA.businessView(t.member.id)).toBeNull();
  });
});

describe('looking after the team', () => {
  it('lets the owner remove a member, and no one else', async () => {
    const t = await company();
    const other = await person('other');
    await BA.joinBusiness(other.id, t.link);
    expect((await BA.removeMember(t.member.id, other.id)).ok).toBe(false); // a member cannot remove
    expect((await BA.removeMember(t.owner.id, t.owner.id)).ok).toBe(false);
    expect((await BA.removeMember(t.owner.id, t.member.id)).ok).toBe(true);
    expect(await BA.businessView(t.member.id)).toBeNull();
    const stranger = await person('stranger');
    expect((await BA.removeMember(t.owner.id, stranger.id)).ok).toBe(false);
  });

  it('keeps the owner in until the team is gone, and can hand the company over', async () => {
    const t = await company();
    expect((await BA.leaveBusiness(t.owner.id)).ok).toBe(false);
    expect((await BA.handOver(t.owner.id, t.member.id)).ok).toBe(true);
    expect((await BA.businessView(t.member.id))?.role).toBe('owner');
    expect((await BA.businessView(t.owner.id))?.role).toBe('member');
    expect(await K.kitOwnerId(t.owner.id)).toBe(t.member.id);
  });

  it('passes the company to a member when the owner deletes their account', async () => {
    const t = await company();
    const r = await Priv.deleteAccount(t.owner.id);
    // A paid order still in progress blocks deletion; finish it first.
    expect(r.ok).toBe(false);
    await db.query("update orders set status = 'delivered' where customer_id = $1", [t.owner.id]);
    expect((await Priv.deleteAccount(t.owner.id)).ok).toBe(true);
    const v = (await BA.businessView(t.member.id))!;
    expect(v.role).toBe('owner');
    expect(v.joinUrl).toBeTruthy();
  });
});

describe('the monthly statement', () => {
  it('works out which month is which in Lagos time', () => {
    const r = BA.monthRange('2026-10')!;
    expect(r.from.toISOString()).toBe('2026-09-30T23:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-10-31T23:00:00.000Z');
    expect(r.label).toBe('October 2026');
    expect(BA.monthRange('2026-12')!.to.toISOString()).toBe('2026-12-31T23:00:00.000Z');
    expect(BA.monthRange('2026-13')).toBeNull();
    expect(BA.monthRange('nope')).toBeNull();
    expect(BA.lastMonth(new Date('2026-10-15T10:00:00Z'))).toBe('2026-09');
    expect(BA.lastMonth(new Date('2027-01-05T10:00:00Z'))).toBe('2026-12');
  });

  it('lists every company order paid in the month, adds them up, and gives the owner only', async () => {
    const t = await company('Statement Co');
    const m = await pay(t.member);
    const month = new Date().toISOString().slice(0, 7);
    // A last-month order is not in this month's statement.
    await db.query("update orders set paid_at = now() - interval '45 days' where id = $1", [t.ownerOrder.id]);
    const s = (await BA.statementFor(t.owner.id, month))!;
    expect(s.business).toBe('Statement Co');
    expect(s.taxId).toBe('12345678-0001');
    expect(s.lines.map((l) => l.code)).toEqual([m.code]);
    expect(s.totals.totalKobo).toBe(m.total_kobo);
    expect(s.lines[0].by).toBeTruthy();
    expect(await BA.statementFor(t.member.id, month)).toBeNull();
    expect(await BA.statementFor(t.owner.id, 'bad')).toBeNull();
  });

  it('leaves out refunded orders, and makes a CSV Excel cannot be tricked by', async () => {
    const t = await company('Csv Co');
    const a = await pay(t.member);
    const b = await pay(t.member);
    await db.query("update orders set status = 'refunded' where id = $1", [b.id]);
    await db.query("update customers set name = '=HYPERLINK(\"http://evil\")' where id = $1", [t.member.id]);
    const s = (await BA.statementFor(t.owner.id, new Date().toISOString().slice(0, 7)))!;
    expect(s.lines.map((l) => l.code)).toContain(a.code);
    expect(s.lines.map((l) => l.code)).not.toContain(b.code);
    const csv = BA.statementCsv(s);
    expect(csv).toContain('Order,Paid on,Ordered by');
    expect(csv).toContain(a.code);
    expect(csv).not.toMatch(/,=HYPERLINK/);
    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv.trim().split('\r\n').pop()!.startsWith('Total')).toBe(true);
  });
});
