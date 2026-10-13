import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { googleFinish } from '@/lib/google';
import { GoogleConflictError, signInGoogle } from '@/lib/identity';
import { customerSessionCookie } from '@/lib/session';
import { destination } from '@/lib/destination';
import { rememberLangFor } from '@/lib/lang';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const u = new URL(req.url);
  const back = (e: string) => {
    const res = NextResponse.redirect(new URL(`/signin?e=${e}`, u));
    res.cookies.delete('bg');
    return res;
  };
  if (u.searchParams.get('error')) return back('google_cancelled');
  const r = await googleFinish({ code: u.searchParams.get('code'), state: u.searchParams.get('state') }, (await cookies()).get('bg')?.value);
  if (!r.ok) return back(r.code === 'expired' ? 'google_expired' : 'google_failed');
  let customer;
  try {
    ({ customer } = await signInGoogle(r.profile));
  } catch (e) {
    if (e instanceof GoogleConflictError) return back('google_conflict');
    throw e;
  }
  await rememberLangFor(customer.id);
  const res = NextResponse.redirect(new URL(destination(customer, r.next), u));
  const c = customerSessionCookie(customer.id);
  res.cookies.set(c.name, c.value, c.options);
  res.cookies.delete('bg');
  return res;
}
