import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireStaff, clearStaffSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ROLE_LABEL } from '@/lib/types';
import { navCounts } from '@/lib/today';
import { ConsoleNav, type NavGroup } from '@/components/ConsoleNav';

export const dynamic = 'force-dynamic';

async function signOut() {
  'use server';
  await clearStaffSession();
  redirect('/console/login');
}

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const s = await requireStaff();
  const floor = s.role === 'partner_press'; // a printing partner sees their own queue and the scan page, nothing else
  const counts = floor ? null : await navCounts().catch(() => null);
  const R = (a: Parameters<typeof can>[1]) => can(s.role, a);
  // Six areas. A person sees only the areas their role can use, so the menu stays short.
  const groups: NavGroup[] = [];
  const area = (title: string | null, items: { href: string; label: string; show: boolean; badge?: number }[]) => {
    const shown = items.filter((i) => i.show).map(({ href, label, badge }) => ({ href, label, badge }));
    if (shown.length) groups.push({ title, items: shown });
  };
  area(null, [
    { href: '/console/today', label: 'Today', show: !floor && (R('see_contact') || R('reports') || R('dispatch') || R('edit_rules')) },
  ]);
  area('Orders', [
    { href: '/console/queue', label: 'Job queue', show: true, badge: counts?.files },
    { href: '/console/orders', label: 'All orders', show: R('see_contact') || R('dispatch') },
    { href: '/console/orders/new', label: 'New order', show: R('build_order') },
    { href: '/console/custom', label: 'Custom quotes', show: R('quote_custom'), badge: counts?.quotes },
    { href: '/console/promise', label: 'Problems', show: R('claims'), badge: counts?.claims },
    { href: '/console/payments', label: 'Payments', show: R('see_payments'), badge: counts?.payments },
  ]);
  area('Catalogue', [
    { href: '/console/products', label: 'Products', show: R('manage_catalog') },
    { href: '/console/stock', label: 'Stock', show: R('manage_catalog') },
    { href: '/console/templates', label: 'Templates', show: R('manage_templates') },
    { href: '/console/studio', label: 'Studio', show: R('manage_studio') || R('review_studio') },
  ]);
  area('Customers', [
    { href: '/console/customers', label: 'Customers', show: R('see_customers') },
  ]);
  area('Marketing', [
    { href: '/console/homepage', label: 'Homepage', show: R('manage_content') },
    { href: '/console/campaigns', label: 'Seasonal pages', show: R('manage_campaigns') },
    { href: '/console/coupons', label: 'Coupons', show: R('manage_coupons') },
    { href: '/console/growth', label: 'Referrals & growth', show: R('manage_growth') },
    { href: '/console/reviews', label: 'Reviews', show: R('reply') },
    { href: '/console/reports', label: 'Reports', show: R('reports') },
  ]);
  area('Settings', [
    { href: '/console/business', label: 'Business details', show: R('manage_business') },
    { href: '/console/rules', label: 'Delivery & rules', show: R('edit_rules') },
    { href: '/console/messages', label: 'Messages', show: R('see_setup') || R('manage_content') },
    { href: '/console/pages', label: 'FAQ & policies', show: R('manage_content') },
    { href: '/console/team', label: 'Team', show: R('manage_team') },
    { href: '/console/setup', label: 'Connections', show: R('see_setup') },
    { href: '/console/activity', label: 'Activity log', show: R('see_activity') },
  ]);
  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <ConsoleNav groups={groups} name={s.name.split(' (')[0]} role={ROLE_LABEL[s.role]}>
        <Link href="/console/me" className="inline-flex min-h-[44px] items-center text-on-ink-muted underline hover:text-white">My PIN</Link>
        <form action={signOut}><button className="min-h-[44px] text-on-ink-muted underline hover:text-white">Sign out</button></form>
      </ConsoleNav>
      <main className="min-w-0 p-4 md:p-8">{children}</main>
    </div>
  );
}
