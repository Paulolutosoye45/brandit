import { beforeAll, describe, expect, it } from 'vitest';

process.env.PGLITE_DIR = 'memory';
let db: typeof import('../lib/db');
let pv: typeof import('../lib/privacy');
let id: typeof import('../lib/identity');
beforeAll(async () => { db = await import('../lib/db'); pv = await import('../lib/privacy'); id = await import('../lib/identity'); await db.ready(); });

async function person(email: string, status: string) {
  const c = (await id.signInGoogle({ sub: `g-${email}`, email, name: 'Ada Obi', picture: 'https://x/p.png' })).customer;
  await db.query("update customers set whatsapp_phone = '+2348030001111', default_area = 'Yaba' where id = $1", [c.id]);
  const o = (await db.one<any>(
    "insert into orders (code, customer_id, status, total_kobo, public_token, address) values ('BR-' || floor(random()*90000+10000)::int, $1, $2, 1500000, md5(random()::text), $3) returning *",
    [c.id, status, JSON.stringify({ name: 'Ada Obi', line1: '12 Test Street', area: 'Yaba', contact_phone: '+2348030001111' })]))!;
  return { c, o };
}

describe('your data', () => {
  it('exports what we hold, without internal fields', async () => {
    const { c } = await person('export.me@example.com', 'delivered');
    const d: any = await pv.exportData(c.id);
    expect(d.profile).toMatchObject({ name: 'Ada Obi', email: 'export.me@example.com', whatsapp_phone: '+2348030001111' });
    expect(d.orders).toHaveLength(1);
    expect(d.orders[0].address.line1).toBe('12 Test Street');
    expect(d.sign_ins.length).toBeGreaterThan(0);
    expect(JSON.stringify(d)).not.toMatch(/google_sub|pin_hash|code_hash/);
  });
  it('will not delete while an order is being made', async () => {
    const { c } = await person('busy.person@example.com', 'paid');
    expect(await pv.deleteAccount(c.id)).toEqual({ ok: false, reason: 'IN_PROGRESS', count: 1 });
    expect((await db.one<any>('select name from customers where id = $1', [c.id]))!.name).toBe('Ada Obi');
  });
  it('erases the person and keeps the accounts', async () => {
    const { c, o } = await person('gone.person@example.com', 'delivered');
    const abandoned = (await db.one<any>("insert into orders (code, customer_id, status, total_kobo, public_token) values ('BR-' || floor(random()*90000+10000)::int, $1, 'awaiting_payment', 1000, md5(random()::text)) returning id", [c.id]))!;
    expect(await pv.deleteAccount(c.id)).toEqual({ ok: true });
    const after = (await db.one<any>('select * from customers where id = $1', [c.id]))!;
    expect(after).toMatchObject({ name: 'Deleted customer', email: null, phone: null, whatsapp_phone: null, google_sub: null, avatar_url: null, default_area: null });
    const order = (await db.one<any>('select address, total_kobo from orders where id = $1', [o.id]))!;
    expect(order.total_kobo).toBe(1500000);                 // the record of the sale stays
    expect(order.address).toEqual({ area: 'Yaba' });         // the person does not
    expect((await db.one<any>('select status from orders where id = $1', [abandoned.id]))!.status).toBe('cancelled');
    expect((await db.one<any>('select count(*)::int as n from sign_ins where customer_id = $1', [c.id]))!.n).toBe(0);
  });
  it('lets the same email start again as a new customer', async () => {
    const { c } = await person('again.person@example.com', 'delivered');
    await pv.deleteAccount(c.id);
    const fresh = (await id.signInEmail('again.person@example.com')).customer;
    expect(fresh.id).not.toBe(c.id);
  });
});
