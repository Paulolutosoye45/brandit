'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { checkCode, issueCode, type Channel } from '@/lib/otp';
import { saveProfile, signInEmail, signInGoogle, signInPhone, type ProfileInput } from '@/lib/identity';
import { clearCustomerSession, getCustomer, setCustomerSession } from '@/lib/session';
import { safeNext } from '@/lib/safeNext';
import { isDemo } from '@/lib/db';
import { googleOn } from '@/lib/google';
import { limited } from '@/lib/ratelimit';
import { clientIp } from '@/lib/clientip';
import { DEMO_GOOGLE, destination } from '@/lib/destination';
import { rememberLangFor } from '@/lib/lang';

const ip = async () => clientIp((await headers()).get('x-forwarded-for'));

export async function requestCode(channel: Channel, value: string) {
  return issueCode(channel, value, await ip());
}

export async function confirmCode(channel: Channel, value: string, code: string, next: string): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  if (limited(`verify:${await ip()}`, 40, 10 * 60_000)) return { ok: false, error: 'Too many tries from this device. Wait a few minutes and try again.' };
  const r = await checkCode(channel, value, code);
  if (!r.ok) return r;
  const { customer } = channel === 'email' ? await signInEmail(r.identifier) : await signInPhone(r.identifier);
  await setCustomerSession(customer.id);
  await rememberLangFor(customer.id);
  return { ok: true, to: destination(customer, next) };
}

/** Demo only: stands in for Google's account chooser until real Google credentials are set. */
export async function chooseDemoGoogle(index: number, next: string) {
  if (!isDemo() || googleOn()) redirect('/signin');
  const a = DEMO_GOOGLE[index];
  if (!a) redirect('/signin');
  const { customer } = await signInGoogle({ sub: a.sub, email: a.email, name: a.name, picture: null });
  await setCustomerSession(customer.id);
  await rememberLangFor(customer.id);
  redirect(destination(customer, next));
}

export async function submitProfile(input: ProfileInput, next: string): Promise<{ ok: true; to: string } | { ok: false; error: string; field: string }> {
  const c = await getCustomer();
  if (!c) return { ok: false, error: 'Sign in again to continue.', field: 'name' };
  const r = await saveProfile(c.id, input);
  if (!r.ok) return r;
  return { ok: true, to: safeNext(next) };
}

export async function signOut() {
  await clearCustomerSession();
  redirect('/');
}
