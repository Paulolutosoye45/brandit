import { beforeAll, describe, expect, it, vi } from 'vitest';
import { deflateSync, crc32 } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';

process.env.PGLITE_DIR = 'memory';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-acct-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
delete process.env.PAYSTACK_SECRET_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.SMS_API_KEY;

function makePng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc((w + 1) * h))), chunk('IEND', Buffer.alloc(0))]);
}

let db: typeof import('../lib/db');
let id: typeof import('../lib/identity');
let otp: typeof import('../lib/otp');
let orders: typeof import('../lib/orders');
let art: typeof import('../lib/artwork');
let payments: typeof import('../lib/payments');

beforeAll(async () => {
  db = await import('../lib/db');
  id = await import('../lib/identity');
  otp = await import('../lib/otp');
  orders = await import('../lib/orders');
  art = await import('../lib/artwork');
  payments = await import('../lib/payments');
  await db.ready();
});

describe('small helpers', () => {
  it('only allows redirects to pages on this site', async () => {
    const { safeNext } = await import('../lib/safeNext');
    expect(safeNext('/checkout/abc?x=1')).toBe('/checkout/abc?x=1');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '/ok\nSet-Cookie: x', '/api/auth/google', '/signin', undefined, 42]) {
      expect(safeNext(bad as any)).toBe('/account');
    }
  });
  it('catches common email typos', async () => {
    const { suggestEmail } = await import('../lib/emailTypos');
    expect(suggestEmail('tunde@gmial.com')).toBe('tunde@gmail.com');
    expect(suggestEmail('Ada@yaho.com')).toBe('ada@yahoo.com');
    expect(suggestEmail('tunde@gmail.com')).toBeNull();
    expect(suggestEmail('nonsense')).toBeNull();
  });
  it('formats Nigerian numbers however they are typed or pasted', async () => {
    const { formatLocal, toE164, maskIdentifier } = await import('../lib/phoneFormat');
    for (const v of ['08031234567', '0803 123 4567', '+234 803 123 4567', '2348031234567', '8031234567']) expect(formatLocal(v)).toBe('803 123 4567');
    expect(toE164('803 123 4567')).toBe('+2348031234567');
    expect(formatLocal('0803')).toBe('803');
    expect(maskIdentifier('email', 'tunde@gmail.com')).toBe('tu•••@gmail.com');
    expect(maskIdentifier('phone', '+2348031234567')).toBe('+234 803 ••• 4567');
  });
});

describe('sign-in codes', () => {
  it('sends a code, accepts the right one once, and refuses reuse', async () => {
    const r = await otp.issueCode('email', ' Ada@Example.com ', 'ip-a');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.identifier).toBe('ada@example.com');
    expect(r.demoCode).toMatch(/^\d{6}$/);
    const ok = await otp.checkCode('email', 'ada@example.com', r.demoCode!);
    expect(ok).toEqual({ ok: true, identifier: 'ada@example.com' });
    expect((await otp.checkCode('email', 'ada@example.com', r.demoCode!)).ok).toBe(false);
  });
  it('rejects a bad address or number with a clear message', async () => {
    const a = await otp.issueCode('email', 'not-an-email', 'ip-b');
    const b = await otp.issueCode('phone', '12345', 'ip-b');
    expect(a.ok).toBe(false); expect(b.ok).toBe(false);
    if (!a.ok) expect(a.error).toMatch(/full email/i);
    if (!b.ok) expect(b.error).toMatch(/Nigerian mobile/i);
  });
  it('makes people wait 30 seconds between codes, and locks a code after five wrong tries', async () => {
    const first = await otp.issueCode('phone', '0803 555 0101', 'ip-c');
    expect(first.ok).toBe(true);
    const again = await otp.issueCode('phone', '0803 555 0101', 'ip-c');
    expect(again.ok).toBe(false);
    for (let i = 0; i < 5; i++) expect((await otp.checkCode('phone', '+2348035550101', '000000')).ok).toBe(false);
    if (first.ok) {
      const locked = await otp.checkCode('phone', '+2348035550101', first.demoCode!);
      expect(locked.ok).toBe(false);
      if (!locked.ok) expect(locked.error).toMatch(/Too many tries/);
    }
  });
  it('refuses an expired code', async () => {
    const r = await otp.issueCode('email', 'late@example.com', 'ip-d');
    await db.query("update login_codes set expires_at = now() - interval '1 minute' where identifier = 'late@example.com'");
    const c = await otp.checkCode('email', 'late@example.com', r.ok ? r.demoCode! : '');
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error).toMatch(/expired/);
  });
  it('limits how many codes one device can ask for', async () => {
    let blocked = false;
    for (let i = 0; i < 15; i++) {
      const r = await otp.issueCode('email', `spam${i}@example.com`, 'ip-spam');
      if (!r.ok && /Too many codes/.test(r.error)) blocked = true;
    }
    expect(blocked).toBe(true);
  });
});

describe('one person, one account', () => {
  it('phone sign-in creates a customer once and finds them again', async () => {
    const a = await id.signInPhone('+2348031110001');
    const b = await id.signInPhone('+2348031110001');
    expect(a.isNew).toBe(true); expect(b.isNew).toBe(false);
    expect(b.customer.id).toBe(a.customer.id);
  });
  it('email sign-in marks the address verified and finds the same person next time', async () => {
    const a = await id.signInEmail('Chinedu@Example.com');
    const b = await id.signInEmail('chinedu@example.com');
    expect(a.isNew).toBe(true); expect(a.customer.email_verified).toBe(true);
    expect(b.customer.id).toBe(a.customer.id);
  });
  it('a guest who ordered with an email gets their history when they later sign in with that email', async () => {
    const guest = await db.one<any>("insert into customers (phone, name, email) values ('+2348031110002', 'Guest Buyer', 'guest.buyer@example.com') returning id");
    const s = await id.signInEmail('guest.buyer@example.com');
    expect(s.isNew).toBe(false);
    expect(s.customer.id).toBe(guest.id);
    expect(s.customer.email_verified).toBe(true);
  });
  it('Google links to an existing customer with the same verified email instead of making a second account', async () => {
    const e = await id.signInEmail('ngozi@example.com');
    const g = await id.signInGoogle({ sub: 'g-ngozi', email: 'Ngozi@example.com', name: 'Ngozi Eze', picture: 'https://x/y.png' });
    expect(g.isNew).toBe(false);
    expect(g.customer.id).toBe(e.customer.id);
    expect(g.customer.google_sub).toBe('g-ngozi');
    const again = await id.signInGoogle({ sub: 'g-ngozi', email: 'ngozi@example.com', name: 'Ngozi Eze', picture: null });
    expect(again.customer.id).toBe(e.customer.id);
    const count = await db.one<any>("select count(*)::int as n from customers where lower(email) = 'ngozi@example.com'");
    expect(count.n).toBe(1);
  });
  it('a new Google account becomes a new customer, with the name and picture from Google', async () => {
    const g = await id.signInGoogle({ sub: 'g-new-1', email: 'new.person@example.com', name: 'New Person', picture: 'https://x/p.png' });
    expect(g.isNew).toBe(true);
    expect(g.customer).toMatchObject({ name: 'New Person', email_verified: true, avatar_url: 'https://x/p.png', phone: null });
  });
  it('refuses to re-link an email that already belongs to a different Google account', async () => {
    await id.signInGoogle({ sub: 'g-owner', email: 'shared@example.com', name: 'Owner' });
    await expect(id.signInGoogle({ sub: 'g-someone-else', email: 'shared@example.com', name: 'Someone Else' })).rejects.toBeInstanceOf(id.GoogleConflictError);
  });
  it('a number someone only typed in is never used to find an account', async () => {
    const victim = await id.signInPhone('+2348031110003');
    const g = await id.signInGoogle({ sub: 'g-typed', email: 'typed.number@example.com', name: 'Typist' });
    const saved = await id.saveProfile(g.customer.id, { name: 'Typist', whatsapp: '+2348031110003', accountType: 'personal' });
    expect(saved.ok).toBe(true);
    const still = await db.one<any>('select count(*)::int as n from customers where id = $1', [victim.customer.id]);
    expect(still.n).toBe(1);
    const mine = await db.one<any>('select id, phone, whatsapp_phone from customers where id = $1', [g.customer.id]);
    expect(mine.id).not.toBe(victim.customer.id);
    expect(mine.phone).toBeNull();
    expect(mine.whatsapp_phone).toBe('+2348031110003');
  });
  it('records each sign-in', async () => {
    const c = await id.signInPhone('+2348031110004');
    await id.signInPhone('+2348031110004');
    const r = await db.one<any>("select count(*)::int as n from sign_ins where customer_id = $1 and method = 'phone'", [c.customer.id]);
    expect(r.n).toBe(2);
  });
});

describe('getting the right details', () => {
  it('asks for a name and a number only when one is missing', async () => {
    const g = await id.signInGoogle({ sub: 'g-needs', email: 'needs@example.com', name: 'Needs Number' });
    expect(id.needsProfile(g.customer)).toBe(true);           // Google gives a name, but no number
    const p = await id.signInPhone('+2348031110005');
    expect(id.needsProfile(p.customer)).toBe(true);           // phone gives a number, but no name
    const ok = await db.one<any>("insert into customers (phone, name) values ('+2348031110006', 'Complete Person') returning *");
    expect(id.needsProfile(ok)).toBe(false);
  });
  it('validates each field and says which one is wrong', async () => {
    const c = (await id.signInPhone('+2348031110007')).customer;
    const base = { name: 'Ada Obi', whatsapp: '+2348031110007', accountType: 'personal' as const };
    expect(await id.saveProfile(c.id, { ...base, name: 'A' })).toMatchObject({ ok: false, field: 'name' });
    expect(await id.saveProfile(c.id, { ...base, whatsapp: '12345' })).toMatchObject({ ok: false, field: 'whatsapp' });
    expect(await id.saveProfile(c.id, { ...base, accountType: 'business', company: '' })).toMatchObject({ ok: false, field: 'company' });
    expect(await id.saveProfile(c.id, { ...base, email: 'nope' })).toMatchObject({ ok: false, field: 'email' });
    expect(await id.saveProfile(c.id, { ...base, area: 'Narnia' })).toMatchObject({ ok: false, field: 'area' });
  });
  it('saves a business profile, links a company, and finishes the sign-up', async () => {
    const c = (await id.signInPhone('+2348031110008')).customer;
    const r = await id.saveProfile(c.id, { name: '  Bola   Ade  ', whatsapp: '0803 111 0008', accountType: 'business', company: 'Ade & Sons', area: 'Yaba', email: 'Bola@Ade.com', marketing: true });
    expect(r).toEqual({ ok: true });
    const after = (await db.one<any>('select * from customers where id = $1', [c.id]))!;
    expect(after).toMatchObject({ name: 'Bola Ade', account_type: 'business', default_area: 'Yaba', email: 'bola@ade.com', marketing_opt_in: true });
    expect(after.whatsapp_phone).toBeNull();                  // same as the sign-in number, so no second copy
    expect(after.profile_completed_at).not.toBeNull();
    expect((await db.one<any>('select name from businesses where id = $1', [after.business_id]))!.name).toBe('Ade & Sons');
    expect(id.needsProfile(after)).toBe(false);
  });
  it('never replaces an email the person has already verified', async () => {
    const c = (await id.signInEmail('keeper@example.com')).customer;
    await id.saveProfile(c.id, { name: 'Keeper', whatsapp: '+2348031110009', accountType: 'personal', email: 'other@example.com' });
    const after = (await db.one<any>('select email, whatsapp_phone from customers where id = $1', [c.id]))!;
    expect(after.email).toBe('keeper@example.com');
    expect(after.whatsapp_phone).toBe('+2348031110009');
  });
});

describe('checkout keeps a signed-in customer on one account', () => {
  it('attaches the order to the Google customer and sends updates to the number they typed', async () => {
    const g = (await id.signInGoogle({ sub: 'g-checkout', email: 'checkout.person@example.com', name: 'Checkout Person' })).customer;
    const before = (await db.one<any>('select count(*)::int as n from customers'))!.n;

    const d: any = await orders.createDraft({ slug: 'business-cards', quantity: 100, area: 'Yaba' });
    const up = await art.saveArtwork(d.id, { name: 'card.png', type: 'image/png', buf: makePng(1050, 600) });
    expect(up.ok).toBe(true);
    const c = await orders.saveCheckout(d.id, { name: 'Checkout Person', phone: '0803 777 0001', email: 'checkout.person@example.com', pickup: false, area: 'Yaba', addressLine: '5 Test Road, Yaba' }, g.id);
    expect(c).toEqual({ ok: true });

    const o = (await orders.getOrder(d.id))!;
    expect(o.customer_id).toBe(g.id);
    expect((await db.one<any>('select count(*)::int as n from customers'))!.n).toBe(before);
    const after = (await db.one<any>('select phone, whatsapp_phone from customers where id = $1', [g.id]))!;
    expect(after.phone).toBeNull();
    expect(after.whatsapp_phone).toBe('+2348037770001');

    const p = await payments.initPayment(o, 'checkout.person@example.com');
    const paid = await orders.confirmPayment({ reference: p.reference, amountKobo: o.total_kobo, method: 'card' });
    expect(paid.ok).toBe(true);
    const msg = (await db.one<any>("select to_phone from messages where order_id = $1 and template = 'paid'", [d.id]))!;
    expect(msg.to_phone).toBe('+2348037770001');
  });
  it('a guest checkout still works with no account, and does not overwrite a verified email', async () => {
    const owner = (await id.signInEmail('verified.owner@example.com')).customer;
    await db.query("update customers set phone = '+2348037770002' where id = $1", [owner.id]);
    const d: any = await orders.createDraft({ slug: 'business-cards', quantity: 100, area: 'Yaba' });
    await art.saveArtwork(d.id, { name: 'card.png', type: 'image/png', buf: makePng(1050, 600) });
    const c = await orders.saveCheckout(d.id, { name: 'Guest At Same Number', phone: '0803 777 0002', email: 'someone.else@example.com', pickup: false, area: 'Yaba', addressLine: '9 Test Road, Yaba' });
    expect(c).toEqual({ ok: true });
    const after = (await db.one<any>('select email, email_verified from customers where id = $1', [owner.id]))!;
    expect(after).toMatchObject({ email: 'verified.owner@example.com', email_verified: true });
  });
});
