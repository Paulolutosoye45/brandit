import { NextResponse } from 'next/server';
import { googleOn, googleStart } from '@/lib/google';
import { isDemo } from '@/lib/db';
import { safeNext } from '@/lib/safeNext';
import { sessionCookieOptions } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const u = new URL(req.url);
  const next = safeNext(u.searchParams.get('next'));
  if (googleOn()) {
    const { url, cookie } = googleStart(next);
    const res = NextResponse.redirect(url);
    res.cookies.set('bg', cookie, sessionCookieOptions(600));
    return res;
  }
  if (isDemo()) return NextResponse.redirect(new URL(`/signin/demo-google?next=${encodeURIComponent(next)}`, u));
  return NextResponse.redirect(new URL('/signin?e=google_off', u));
}
