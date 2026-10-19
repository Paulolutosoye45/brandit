'use server';
import { redirect } from 'next/navigation';
import { getCustomer } from '@/lib/session';
import { reorder } from '@/lib/orders';
import { adoptBasket } from '@/lib/basket';

/** The button on the reminder page. Opening the link changes nothing; this does, and only for the signed-in owner of the order. */
export async function reorderFromReminder(fd: FormData) {
  const token = String(fd.get('token') ?? '');
  if (!/^[\w-]{8,40}$/.test(token)) redirect('/account');
  const c = await getCustomer();
  if (!c) redirect(`/signin?next=${encodeURIComponent(`/reorder/${token}`)}`);
  const r = await reorder(token, c.id);
  if ('error' in r) redirect(`/reorder/${token}?e=${encodeURIComponent(r.error)}`);
  await adoptBasket(r.id);
  redirect(`/checkout/${r.id}`);
}
