import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireStaff, clearStaffSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ROLE_LABEL } from '@/lib/types';
import { ConsoleNav } from '@/components/ConsoleNav';

export const dynamic = 'force-dynamic';

async function signOut() {
  'use server';
  await clearStaffSession();
  redirect('/console/login');
}

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const s = await requireStaff();
  const nav = [
    { href: '/console/queue', label: 'Job queue', show: true },
    { href: '/console/orders', label: 'Orders', show: can(s.role, 'see_contact') || can(s.role, 'dispatch') },
    { href: '/console/custom', label: 'Custom orders', show: can(s.role, 'quote_custom') },
    { href: '/console/promise', label: 'Promise desk', show: can(s.role, 'claims') },
    { href: '/console/products', label: 'Products', show: can(s.role, 'manage_catalog') },
    { href: '/console/templates', label: 'Templates', show: can(s.role, 'manage_templates') },
    { href: '/console/campaigns', label: 'Seasonal pages', show: can(s.role, 'manage_campaigns') },
    { href: '/console/coupons', label: 'Coupons', show: can(s.role, 'manage_coupons') },
    { href: '/console/studio', label: 'Studio', show: can(s.role, 'manage_studio') || can(s.role, 'review_studio') },
    { href: '/console/growth', label: 'Growth', show: can(s.role, 'manage_growth') },
    { href: '/console/reviews', label: 'Reviews', show: can(s.role, 'reply') },
    { href: '/console/rules', label: 'Delivery and rules', show: can(s.role, 'edit_rules') },
    { href: '/console/reports', label: 'Reports', show: can(s.role, 'reports') },
    { href: '/console/team', label: 'Team', show: can(s.role, 'manage_team') },
    { href: '/console/setup', label: 'Setup', show: can(s.role, 'see_setup') },
  ].filter((n) => n.show);
  return (
    <div className="min-h-screen md:grid md:grid-cols-[230px_1fr]">
      <ConsoleNav items={nav.map(({ href, label }) => ({ href, label }))} name={s.name.split(' (')[0]} role={ROLE_LABEL[s.role]}>
        <Link href="/console/me" className="inline-flex min-h-[44px] items-center text-on-ink-muted underline hover:text-white">My PIN</Link>
        <form action={signOut}><button className="min-h-[44px] text-on-ink-muted underline hover:text-white">Sign out</button></form>
      </ConsoleNav>
      <main className="min-w-0 p-4 md:p-8">{children}</main>
    </div>
  );
}
