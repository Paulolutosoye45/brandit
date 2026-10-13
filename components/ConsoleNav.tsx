'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from './Logo';

type Item = { href: string; label: string };

/**
 * The console's menu. On a desktop it is a sidebar. On a phone it is a bar with a Menu button that opens a grid of big links,
 * so nobody has to find a hidden scroll to reach Products or Coupons.
 */
export function ConsoleNav({ items, name, role, children }: { items: Item[]; name: string; role: string; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const current = items.find((i) => path === i.href || path.startsWith(`${i.href}/`));
  return (
    <aside className="no-print bg-ink text-white md:sticky md:top-0 md:flex md:h-screen md:min-h-screen md:flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-2 md:hidden">
        <Logo tone="light" className="h-7 w-auto" />
        <span className="min-w-0 flex-1 truncate text-right text-[14px] font-bold text-on-ink-muted">{current?.label ?? 'Console'}</span>
        <button type="button" aria-expanded={open} aria-controls="console-menu" onClick={() => setOpen(!open)} className="inline-flex min-h-[44px] items-center gap-2 rounded-sm2 bg-white/10 px-4 font-bold hover:bg-white/20">
          {open ? 'Close' : 'Menu'}
        </button>
      </div>
      <div id="console-menu" className={`${open ? 'flex' : 'hidden'} flex-col gap-2 px-3 pb-4 md:flex md:flex-1 md:p-4`}>
        <div className="hidden px-3 py-2 md:block md:pb-5"><Logo tone="light" className="h-8 w-auto" /><span className="block text-[13px] text-on-ink-muted">ops console</span></div>
        <nav aria-label="Console" className="grid grid-cols-2 gap-1 md:flex md:flex-col">
          {items.map((n) => {
            const on = n === current;
            return (
              <Link key={n.href} href={n.href} aria-current={on ? 'page' : undefined} className={`inline-flex min-h-[48px] items-center rounded-sm2 px-3 font-medium md:min-h-[44px] ${on ? 'bg-white/15 font-bold' : 'hover:bg-white/10'}`}>{n.label}</Link>
            );
          })}
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
