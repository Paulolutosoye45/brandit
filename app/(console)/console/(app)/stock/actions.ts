'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { setChoiceStock } from '@/lib/stock';

export async function stockAction(fd: FormData) {
  const staff = await requireStaff('manage_catalog');
  const g = (k: string) => String(fd.get(k) ?? '');
  const r = await setChoiceStock({ id: staff.id, name: staff.name }, g('product'), g('option'), g('value'), g('on') === '1');
  revalidatePath('/products', 'layout'); revalidatePath('/'); revalidatePath('/console/stock');
  redirect(`/console/stock?${r.ok ? `ok=${encodeURIComponent(r.message)}` : `e=${encodeURIComponent(r.error)}`}#p-${g('product')}`);
}
