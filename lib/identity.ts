import { one, query, tx, type Q } from './db';
import { normalizePhone } from './phone';
import { cleanEmail, isEmail } from './otp';
import { listZones } from './catalog';

export type Customer = {
  id: string; phone: string | null; email: string | null; email_verified: boolean; google_sub: string | null;
  name: string | null; whatsapp_phone: string | null; account_type: 'personal' | 'business'; default_area: string | null;
  marketing_opt_in: boolean; avatar_url: string | null; profile_completed_at: string | null; business_id: string | null;
  nudge_ok: boolean; lang: 'en' | 'pcm';
};
export type Method = 'google' | 'email' | 'phone';
export class GoogleConflictError extends Error { constructor() { super('GOOGLE_ACCOUNT_CONFLICT'); } }

/** The number we send order updates to. */
export const contactPhone = (c: Pick<Customer, 'phone' | 'whatsapp_phone'>) => c.whatsapp_phone ?? c.phone ?? null;

/** We need a name and one number we can reach. Anything else is optional. */
export const needsProfile = (c: Pick<Customer, 'name' | 'phone' | 'whatsapp_phone'>) => !c.name?.trim() || !contactPhone(c);

async function logSignIn(q: Q, id: string, method: Method) {
  await q.query('update customers set last_sign_in_at = now() where id = $1', [id]);
  await q.query('insert into sign_ins (customer_id, method) values ($1,$2)', [id, method]);
}

/**
 * Who is this? The rules, in order, and why they are safe:
 *  - Google: the same Google account always lands on the same customer. If Google says the email is
 *    verified and it matches an existing customer, we link to it, so one person is never two accounts.
 *  - Email: a correct code proves the person controls the address, so we match the customer with that address.
 *  - Phone: a correct code proves the person controls the number.
 * A number someone only typed in (the WhatsApp number) is never used to match, so nobody can
 * take over an account by typing someone else's number.
 */
export async function signInGoogle(p: { sub: string; email: string; name?: string | null; picture?: string | null }): Promise<{ customer: Customer; isNew: boolean }> {
  const email = cleanEmail(p.email);
  return tx(async (q) => {
    let c = (await q.query<Customer>('select * from customers where google_sub = $1', [p.sub]))[0];
    let isNew = false;
    if (!c) {
      c = (await q.query<Customer>('select * from customers where lower(email) = $1 order by email_verified desc, created_at asc limit 1', [email]))[0];
      if (c) {
        // An email already tied to a different Google account is never re-linked silently.
        if (c.google_sub && c.google_sub !== p.sub) throw new GoogleConflictError();
        await q.query(
          `update customers set google_sub = $2, email_verified = true, email = $5, avatar_url = coalesce(avatar_url, $3), name = coalesce(nullif(name, ''), $4) where id = $1`,
          [c.id, p.sub, p.picture ?? null, p.name ?? null, email],
        );
      } else {
        c = (await q.query<Customer>(
          'insert into customers (email, email_verified, google_sub, name, avatar_url) values ($1, true, $2, $3, $4) returning *',
          [email, p.sub, p.name ?? null, p.picture ?? null],
        ))[0];
        isNew = true;
      }
    }
    await logSignIn(q, c.id, 'google');
    return { customer: (await q.query<Customer>('select * from customers where id = $1', [c.id]))[0], isNew };
  });
}

export async function signInEmail(rawEmail: string): Promise<{ customer: Customer; isNew: boolean }> {
  const email = cleanEmail(rawEmail);
  return tx(async (q) => {
    let c = (await q.query<Customer>('select * from customers where lower(email) = $1 order by email_verified desc, created_at asc limit 1', [email]))[0];
    let isNew = false;
    if (c) {
      if (!c.email_verified) await q.query('update customers set email_verified = true where id = $1', [c.id]);
    } else {
      c = (await q.query<Customer>('insert into customers (email, email_verified) values ($1, true) returning *', [email]))[0];
      isNew = true;
    }
    await logSignIn(q, c.id, 'email');
    return { customer: (await q.query<Customer>('select * from customers where id = $1', [c.id]))[0], isNew };
  });
}

export async function signInPhone(phone: string): Promise<{ customer: Customer; isNew: boolean }> {
  return tx(async (q) => {
    let c = (await q.query<Customer>('select * from customers where phone = $1', [phone]))[0];
    let isNew = false;
    if (!c) {
      c = (await q.query<Customer>('insert into customers (phone) values ($1) returning *', [phone]))[0];
      isNew = true;
    }
    await logSignIn(q, c.id, 'phone');
    return { customer: c, isNew };
  });
}

export type ProfileInput = { name: string; whatsapp: string; accountType: 'personal' | 'business'; company?: string; area?: string; email?: string; marketing?: boolean };
export type ProfileResult = { ok: true } | { ok: false; error: string; field: keyof ProfileInput };

export async function saveProfile(customerId: string, d: ProfileInput): Promise<ProfileResult> {
  const c = await one<Customer>('select * from customers where id = $1', [customerId]);
  if (!c) return { ok: false, error: 'Sign in again to continue.', field: 'name' };
  const name = String(d.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2) return { ok: false, error: 'Tell us your name so the rider knows who to look for.', field: 'name' };
  if (name.length > 80) return { ok: false, error: 'That name is too long. Use up to 80 characters.', field: 'name' };
  const wa = normalizePhone(d.whatsapp);
  if (!wa) return { ok: false, error: 'Enter a Nigerian mobile number, like 0803 123 4567.', field: 'whatsapp' };
  if (d.accountType === 'business' && (d.company ?? '').trim().length < 2) return { ok: false, error: 'Enter your company name.', field: 'company' };

  let email: string | null = null;
  if (!c.email && d.email?.trim()) {
    email = cleanEmail(d.email);
    if (!isEmail(email)) return { ok: false, error: 'Enter a full email address, like name@example.com.', field: 'email' };
  }
  let area: string | null = null;
  if (d.area) {
    const zones = await listZones();
    if (!zones.some((z) => z.areas.includes(d.area!))) return { ok: false, error: 'Choose an area from the list.', field: 'area' };
    area = d.area;
  }

  await tx(async (q) => {
    let businessId = c.business_id;
    if (d.accountType === 'business') {
      const company = d.company!.trim();
      const b = businessId ? await q.query<{ id: string }>('select id from businesses where id = $1 and lower(name) = lower($2)', [businessId, company]) : [];
      businessId = b[0]?.id ?? (await q.query<{ id: string }>('insert into businesses (name) values ($1) returning id', [company]))[0].id;
    }
    await q.query(
      `update customers set name = $2, whatsapp_phone = $3, account_type = $4, business_id = $5, default_area = $6,
         email = coalesce(email, $7), marketing_opt_in = $8, profile_completed_at = coalesce(profile_completed_at, now()) where id = $1`,
      [customerId, name, wa === c.phone ? null : wa, d.accountType, d.accountType === 'business' ? businessId : c.business_id, area ?? c.default_area, email, !!d.marketing],
    );
  });
  return { ok: true };
}

/** Which sign-in methods this customer has used, for the account page. */
export async function methodsFor(customerId: string): Promise<Method[]> {
  const rows = await query<{ method: Method }>('select distinct method from sign_ins where customer_id = $1', [customerId]);
  return rows.map((r) => r.method);
}
