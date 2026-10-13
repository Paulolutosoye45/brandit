'use server';
import { redirect } from 'next/navigation';
import { clearCustomerSession, getCustomer } from '@/lib/session';
import { deleteAccount } from '@/lib/privacy';

export async function deleteMyAccount(fd: FormData) {
  const c = await getCustomer();
  if (!c) redirect('/signin');
  if (String(fd.get('confirm') ?? '').trim().toUpperCase() !== 'DELETE') redirect('/account/delete?e=Type+DELETE+to+confirm.');
  const r = await deleteAccount(c.id);
  if (!r.ok) {
    redirect(`/account/delete?e=${encodeURIComponent(r.reason === 'IN_PROGRESS' ? 'You have an order that is still being made. Delete your account after it is delivered, so you do not lose the print.' : 'We could not find your account.')}`);
  }
  await clearCustomerSession();
  redirect('/?deleted=1');
}
