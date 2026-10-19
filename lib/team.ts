import { one, query, tx, type Q } from './db';
import { checkPin, hashPin } from './password';
import type { Role } from './types';

export const ROLES: Role[] = ['admin', 'production_lead', 'file_desk', 'support', 'dispatcher', 'partner_press'];

/** A staff PIN is 6 to 12 digits, and not an easy one. Staff sign in with an email and a PIN, so this is the lock on the console. */
export function validatePin(pin: string): string | null {
  if (!/^\d{6,12}$/.test(pin)) return 'A PIN is 6 to 12 digits, numbers only.';
  if (/^(\d)\1+$/.test(pin)) return 'That PIN is too easy to guess. Do not repeat one digit.';
  const d = pin.split('').map(Number);
  const run = (step: number) => d.every((x, i) => i === 0 || x - d[i - 1] === step);
  if (run(1) || run(-1)) return 'That PIN is too easy to guess. Do not use a run like 123456.';
  if (['000000', '123123', '112233', '121212', '696969', '159753'].includes(pin)) return 'That PIN is too easy to guess. Pick another.';
  return null;
}

const emailOk = (e: string) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

export type StaffRow = { id: string; email: string; name: string; role: Role; press_id: string | null; press_name: string | null; active: boolean };

export async function listStaff(): Promise<StaffRow[]> {
  return query<StaffRow>('select s.id, s.email, s.name, s.role, s.press_id, p.name as press_name, s.active from staff s left join presses p on p.id = s.press_id order by s.active desc, s.name');
}
export const listPresses = () => query<{ id: string; name: string; is_partner: boolean }>('select id, name, is_partner from presses order by name');

type Result = { ok: true } | { ok: false; error: string; field?: string };

const activeAdmins = async (q: Pick<Q, 'query'>, exceptId?: string) =>
  (await q.query<{ n: number }>("select count(*)::int as n from staff where role = 'admin' and active and ($1::uuid is null or id <> $1::uuid)", [exceptId ?? null]))[0].n;

export async function addStaff(d: { name: string; email: string; role: string; pin: string; pressId?: string | null }): Promise<Result> {
  const name = String(d.name ?? '').trim().replace(/\s+/g, ' ');
  const email = String(d.email ?? '').trim().toLowerCase();
  if (name.length < 2 || name.length > 80) return { ok: false, error: 'Enter the person\'s name.', field: 'name' };
  if (!emailOk(email)) return { ok: false, error: 'Enter a full email address.', field: 'email' };
  if (!ROLES.includes(d.role as Role)) return { ok: false, error: 'Choose a role.', field: 'role' };
  const pinErr = validatePin(d.pin);
  if (pinErr) return { ok: false, error: pinErr, field: 'pin' };
  let pressId: string | null = null;
  if (d.role === 'partner_press') {
    if (!d.pressId || !(await one('select 1 as x from presses where id = $1', [d.pressId]))) return { ok: false, error: 'Choose the printing partner this person works for.', field: 'press' };
    pressId = d.pressId;
  }
  if (await one('select 1 as x from staff where lower(email) = $1', [email])) return { ok: false, error: 'Someone with that email is already on the team.', field: 'email' };
  await query('insert into staff (email, name, role, pin_hash, press_id) values ($1,$2,$3,$4,$5)', [email, name, d.role, hashPin(d.pin), pressId]);
  return { ok: true };
}

export async function setStaffActive(id: string, active: boolean, actorId: string): Promise<Result> {
  return tx(async (q) => {
    const s = (await q.query<{ role: Role; active: boolean }>('select role, active from staff where id = $1', [id]))[0];
    if (!s) return { ok: false, error: 'That person is not on the team.' };
    if (!active) {
      if (id === actorId) return { ok: false, error: 'You cannot switch yourself off. Ask another admin.' };
      if (s.role === 'admin' && (await activeAdmins(q, id)) === 0) return { ok: false, error: 'There must always be at least one active admin.' };
    }
    await q.query('update staff set active = $2 where id = $1', [id, active]);
    return { ok: true };
  });
}

export async function setRole(id: string, role: string, pressId: string | null): Promise<Result> {
  if (!ROLES.includes(role as Role)) return { ok: false, error: 'Choose a role.' };
  return tx(async (q) => {
    const s = (await q.query<{ role: Role }>('select role from staff where id = $1', [id]))[0];
    if (!s) return { ok: false, error: 'That person is not on the team.' };
    if (s.role === 'admin' && role !== 'admin' && (await activeAdmins(q, id)) === 0) return { ok: false, error: 'There must always be at least one active admin.' };
    if (role === 'partner_press' && !pressId) return { ok: false, error: 'Choose the printing partner this person works for.' };
    await q.query('update staff set role = $2, press_id = $3 where id = $1', [id, role, role === 'partner_press' ? pressId : null]);
    return { ok: true };
  });
}

export async function resetPin(id: string, pin: string): Promise<Result> {
  const err = validatePin(pin);
  if (err) return { ok: false, error: err, field: 'pin' };
  const r = await query('update staff set pin_hash = $2 where id = $1 returning id', [id, hashPin(pin)]);
  return r.length ? { ok: true } : { ok: false, error: 'That person is not on the team.' };
}

export async function changeOwnPin(id: string, current: string, next: string): Promise<Result> {
  const s = await one<{ pin_hash: string }>('select pin_hash from staff where id = $1 and active', [id]);
  if (!s || !checkPin(current, s.pin_hash)) return { ok: false, error: 'Your current PIN is not right.', field: 'current' };
  const err = validatePin(next);
  if (err) return { ok: false, error: err, field: 'next' };
  if (current === next) return { ok: false, error: 'Choose a different PIN from the one you have now.', field: 'next' };
  await query('update staff set pin_hash = $2 where id = $1', [id, hashPin(next)]);
  return { ok: true };
}

export async function addPress(name: string, isPartner: boolean): Promise<Result> {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (n.length < 2 || n.length > 80) return { ok: false, error: 'Enter the press or partner name.' };
  if (await one('select 1 as x from presses where lower(name) = lower($1)', [n])) return { ok: false, error: 'That name is already in the list.' };
  await query('insert into presses (name, is_partner) values ($1,$2)', [n, isPartner]);
  return { ok: true };
}

/**
 * In live mode, make sure the owner can sign in to the console. ADMIN_EMAIL and ADMIN_PIN create that admin if the
 * address is not already an active admin, whether the database is brand new, was seeded before those were set, or holds
 * other admins (for example demo ones). An existing admin's PIN is never changed from here: changing ADMIN_PIN later does
 * nothing, so a PIN changed in the console is not undone by a redeploy. To reset a forgotten PIN: npm run admin -- set.
 */
export async function ensureAdmin(env: NodeJS.ProcessEnv = process.env, db?: { query: Q['query'] }): Promise<'created' | 'present' | 'skipped' | 'weak-pin'> {
  // At startup the caller passes the connection it already holds. Asking the shared one would wait on startup itself.
  const run = db ? db.query.bind(db) : query;
  if (!env.ADMIN_EMAIL || !env.ADMIN_PIN) return 'skipped';
  if (validatePin(env.ADMIN_PIN)) return 'weak-pin';
  const email = env.ADMIN_EMAIL.trim().toLowerCase();
  const have = (await run<{ n: number }>("select count(*)::int as n from staff where email = $1 and role = 'admin' and active", [email]))[0]?.n ?? 0;
  if (have > 0) return 'present';
  await run(
    `insert into staff (email, name, role, pin_hash) values ($1,'Admin','admin',$2)
     on conflict (email) do update set role = 'admin', active = true, pin_hash = excluded.pin_hash`,
    [email, hashPin(env.ADMIN_PIN)],
  );
  return 'created';
}
