'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCustomer } from '@/lib/session';
import { handOver, leaveBusiness, removeMember, replaceJoinLink } from '@/lib/businessAccounts';

async function me() {
  const c = await getCustomer();
  if (!c) redirect('/signin?next=/account/business');
  return c;
}
const done = (r: { ok: boolean; error?: string }, ok: string): never => {
  revalidatePath('/account/business');
  redirect(`/account/business?${r.ok ? `ok=${encodeURIComponent(ok)}` : `e=${encodeURIComponent(r.error ?? 'Something went wrong.')}`}`);
};

export async function removeMemberAction(fd: FormData) { const c = await me(); done(await removeMember(c.id, String(fd.get('id') ?? '')), 'They have been removed from the company account.'); }
export async function replaceLinkAction() { const c = await me(); done(await replaceJoinLink(c.id), 'New link made. The old one no longer works.'); }
export async function handOverAction(fd: FormData) { const c = await me(); done(await handOver(c.id, String(fd.get('id') ?? '')), 'The company account now belongs to them.'); }
export async function leaveAction() {
  const c = await me();
  const r = await leaveBusiness(c.id);
  revalidatePath('/account');
  if (r.ok) redirect('/account');
  done(r, '');
}
