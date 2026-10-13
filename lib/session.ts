import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { one, isDemo } from './db';
import type { Role } from './types';
import { can, type Action } from './permissions';

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (isDemo()) return 'brandit-demo-secret-not-for-production';
  throw new Error('SESSION_SECRET must be set (16+ characters) when DEMO_MODE=false.');
}

export function sign(payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  const mac = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verify<T = Record<string, any>>(tok: string | undefined | null): T | null {
  if (!tok) return null;
  const [body, mac] = tok.split('.');
  if (!body || !mac) return null;
  const want = createHmac('sha256', secret()).update(body).digest();
  const got = Buffer.from(mac, 'base64url');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof p.exp !== 'number' || p.exp < Date.now() / 1000) return null;
    return p as T;
  } catch {
    return null;
  }
}

const secure = () => process.env.NODE_ENV === 'production' && !isDemo();
const opts = (maxAge: number) => ({ httpOnly: true, sameSite: 'lax' as const, secure: secure(), path: '/', maxAge });

// ---------- Customers ----------
export async function setCustomerSession(customerId: string) {
  (await cookies()).set('bc', sign({ cid: customerId }, 60 * 60 * 24 * 30), opts(60 * 60 * 24 * 30));
}
/** For route handlers that build their own redirect response. */
export function customerSessionCookie(customerId: string) {
  return { name: 'bc', value: sign({ cid: customerId }, 60 * 60 * 24 * 30), options: opts(60 * 60 * 24 * 30) };
}
export async function clearCustomerSession() {
  (await cookies()).delete('bc');
}
export async function getCustomer(): Promise<import('./identity').Customer | null> {
  const p = verify<{ cid: string }>((await cookies()).get('bc')?.value);
  if (!p) return null;
  return one<any>('select * from customers where id = $1', [p.cid]);
}
export async function requireCustomer(next: string) {
  const c = await getCustomer();
  if (!c) redirect(`/signin?next=${encodeURIComponent(next)}`);
  return c;
}
export const sessionCookieOptions = opts;

// ---------- Staff ----------
export async function setStaffSession(staffId: string) {
  (await cookies()).set('bs', sign({ sid: staffId }, 60 * 60 * 12), opts(60 * 60 * 12));
}
export async function clearStaffSession() {
  (await cookies()).delete('bs');
}
export type StaffUser = { id: string; email: string; name: string; role: Role; press_id: string | null };
export async function getStaff(): Promise<StaffUser | null> {
  const p = verify<{ sid: string }>((await cookies()).get('bs')?.value);
  if (!p) return null;
  const r = await one('select id, email, name, role, press_id from staff where id = $1 and active', [p.sid]);
  return (r as StaffUser) ?? null;
}
export async function requireStaff(action?: Action): Promise<StaffUser> {
  const s = await getStaff();
  if (!s) redirect('/console/login');
  if (action && !can(s.role, action)) redirect('/console/forbidden');
  return s;
}
