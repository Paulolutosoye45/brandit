'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { businessForm, saveBusiness } from '@/lib/business';
import { audit } from '@/lib/audit';

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '');

export async function saveBusinessAction(fd: FormData) {
  const staff = await requireStaff('manage_business');
  const before = await businessForm();
  const r = await saveBusiness({ whatsapp: s(fd, 'whatsapp'), phone: s(fd, 'phone'), email: s(fd, 'email'), address: s(fd, 'address'), hours: s(fd, 'hours'), reply_within: s(fd, 'reply_within'), legal_reviewed: fd.get('legal_reviewed') === 'on' });
  if (!r.ok) redirect(`/console/business?e=${encodeURIComponent(r.error)}&field=${r.field}`);
  const changed = (Object.keys(r.value) as (keyof typeof r.value)[]).filter((k) => String(before[k] ?? '') !== String(r.value[k] ?? ''));
  await audit({ id: staff.id, name: staff.name }, { area: 'settings', action: 'business_details', target: 'Business details', summary: changed.length ? `Changed ${changed.map((k) => k.replace('_', ' ')).join(', ')}` : 'Saved business details (no change)', detail: { changed } });
  // Every public page reads these, so refresh the layout that wraps them all.
  revalidatePath('/', 'layout');
  redirect('/console/business?ok=Saved.+The+site+shows+the+new+details+straight+away.');
}
