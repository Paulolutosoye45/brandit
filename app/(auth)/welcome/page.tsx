import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { requireCustomer } from '@/lib/session';
import { contactPhone, needsProfile } from '@/lib/identity';
import { listZones } from '@/lib/catalog';
import { one } from '@/lib/db';
import { safeNext } from '@/lib/safeNext';
import { formatLocal } from '@/lib/phoneFormat';
import { ProfileForm } from './ProfileForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your details' };

export default async function Welcome(props: { searchParams: Promise<{ next?: string; edit?: string }> }) {
  const searchParams = await props.searchParams;
  const next = safeNext(searchParams.next);
  const c = await requireCustomer(`/welcome${searchParams.next ? `?next=${encodeURIComponent(searchParams.next)}` : ''}`);
  const editing = searchParams.edit === '1';
  if (!editing && !needsProfile(c)) redirect(next);
  const zones = await listZones();
  const company = c.business_id ? (await one<{ name: string }>('select name from businesses where id = $1', [c.business_id]))?.name ?? '' : '';
  return (
    <ProfileForm
      next={editing && !searchParams.next ? '/account' : next}
      editing={editing}
      zones={zones.map((z) => ({ id: z.id, name: z.name, areas: z.areas }))}
      initial={{
        name: c.name ?? '', whatsapp: formatLocal(contactPhone(c) ?? ''), email: c.email ?? '', hasEmail: !!c.email,
        accountType: c.account_type, company, area: c.default_area ?? '', marketing: c.marketing_opt_in,
      }}
    />
  );
}
