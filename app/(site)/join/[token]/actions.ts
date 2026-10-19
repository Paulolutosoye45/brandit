'use server';
import { redirect } from 'next/navigation';
import { getCustomer } from '@/lib/session';
import { joinBusiness } from '@/lib/businessAccounts';

export async function joinAction(fd: FormData) {
  const token = String(fd.get('token') ?? '');
  const c = await getCustomer();
  if (!c) redirect(`/signin?next=${encodeURIComponent(`/join/${token}`)}`);
  const r = await joinBusiness(c.id, token);
  redirect(r.ok ? '/account/business?joined=1' : `/join/${encodeURIComponent(token)}?e=${encodeURIComponent(r.error)}`);
}
