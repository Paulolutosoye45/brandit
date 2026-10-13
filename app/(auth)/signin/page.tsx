import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getCustomer } from '@/lib/session';
import { authMethods } from '@/lib/authconfig';
import { safeNext } from '@/lib/safeNext';
import { destination } from '@/lib/destination';
import { SignInFlow } from './SignInFlow';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in' };

const ERRORS: Record<string, string> = {
  google_cancelled: 'Google sign-in was cancelled. Choose a way to continue.',
  google_expired: 'That Google sign-in took too long. Try again.',
  google_failed: 'Google sign-in did not work. Try again, or use your email.',
  google_conflict: 'That email is already linked to a different Google account. Sign in with a code sent to your email instead.',
  google_off: 'Google sign-in is not set up yet. Use your email or phone number.',
};

export default async function SignIn(props: { searchParams: Promise<{ next?: string; e?: string }> }) {
  const searchParams = await props.searchParams;
  const next = safeNext(searchParams.next);
  const c = await getCustomer();
  if (c) redirect(destination(c, next));
  const m = authMethods();
  return <SignInFlow methods={{ google: m.google, email: m.email, phone: m.phone, demo: m.demo }} next={next} initialError={searchParams.e ? ERRORS[searchParams.e] : undefined} />;
}
