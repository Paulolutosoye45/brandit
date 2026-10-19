'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from './Logo';

type Item = { href: string; label: string; badge?: number };
export type NavGroup = { title: string | null; items: Item[] };

/**
 * The console's menu, in six areas: Today, Orders, Catalogue, Customers, Marketing and Settings.
 * On a desktop it is a sidebar. On a phone it is a bar with a Menu button that opens big links under each area's heading,
 * so nobody has to find a hidden scroll to reach Products or Coupons.
 */
export function ConsoleNav({ groups, name, role, children }: { groups: NavGroup[]; name: string; role: string; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const all = groups.flatMap((g) => g.items);
  // The longest matching link is the current one (so /console/orders/new does not light up Orders as well as New order).
  const current = all.filter((i) => path === i.href || path.startsWith(`${i.href}/`)).sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <aside className="no-print bg-ink text-white md:sticky md:top-0 md:flex md:h-screen md:min-h-screen md:flex-col md:overflow-y-auto">
      <div className="flex items-center justify-between gap-3 px-4 py-2 md:hidden">
        <Logo tone="light" className="h-7 w-auto" />
        <span className="min-w-0 flex-1 truncate text-right text-[14px] font-bold text-on-ink-muted">{current?.label ?? 'Console'}</span>
        <button type="button" aria-expanded={open} aria-controls="console-menu" onClick={() => setOpen(!open)} className="inline-flex min-h-[44px] items-center gap-2 rounded-sm2 bg-white/10 px-4 font-bold hover:bg-white/20">
          {open ? 'Close' : 'Menu'}
        </button>
      </div>
      <div id="console-menu" className={`${open ? 'flex' : 'hidden'} max-h-[calc(100vh-56px)] flex-col gap-2 overflow-y-auto px-3 pb-4 md:flex md:max-h-none md:flex-1 md:overflow-visible md:p-4`}>
        <div className="hidden px-3 py-2 md:block md:pb-3"><Logo tone="light" className="h-8 w-auto" /><span className="block text-[13px] text-on-ink-muted">ops console</span></div>
        <nav aria-label="Console" className="grid gap-3">
          {groups.map((g, gi) => (
            <div key={g.title ?? gi} className="grid gap-1">
              {g.title && <p className="px-3 pt-1 text-[12px] font-bold uppercase tracking-wider text-on-ink-muted">{g.title}</p>}
              <div className="grid grid-cols-2 gap-1 md:flex md:flex-col">
                {g.items.map((n) => {
                  const on = n === current;
                  return (
                    <Link key={n.href} href={n.href} aria-current={on ? 'page' : undefined} className={`inline-flex min-h-[48px] items-center justify-between gap-2 rounded-sm2 px-3 font-medium md:min-h-[40px] ${on ? 'bg-white/15 font-bold' : 'hover:bg-white/10'}`}>
                      <span>{n.label}</span>
                      {n.badge ? <span aria-label={`${n.badge} waiting`} className="grid h-[22px] min-w-[22px] place-items-center rounded-full bg-accent px-1.5 text-[12px] font-bold text-ink">{n.badge > 99 ? '99+' : n.badge}</span> : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="mt-2 border-t border-white/10 px-3 pt-3 text-[14px] md:mt-auto">
          <p className="font-bold">{name}</p>
          <p className="text-on-ink-muted">{role}</p>
          {children}
        </div>
      </div>
    </aside>
  );
}
