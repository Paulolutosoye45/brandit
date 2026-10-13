'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from './LangProvider';

const items = [
  { href: '/', label: 'Home', d: 'M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z' },
  { href: '/products', label: 'Products', d: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { href: '/track', label: 'Track', d: 'M12 21s-7-6.2-7-11a7 7 0 1114 0c0 4.8-7 11-7 11zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z' },
  { href: '/account', label: 'Account', d: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6' },
];

export function BottomNav({ signedIn = false }: { signedIn?: boolean }) {
  const path = usePathname();
  const t = useT();
  // At checkout the Pay bar takes the bottom of the screen.
  if (path.startsWith('/checkout')) return null;
  return (
    <nav aria-label="Main" className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]">
      <ul className="grid grid-cols-4">
        {items.map((raw) => {
          const it = raw.href === '/account' && !signedIn ? { ...raw, label: 'Sign in', href: '/signin' } : raw;
          const on = it.href === '/' ? path === '/' : path.startsWith(it.href) || (raw.href === '/account' && path.startsWith('/account'));
          return (
            <li key={it.href}>
              <Link href={it.href} aria-current={on ? 'page' : undefined} className={`flex flex-col items-center justify-center gap-0.5 min-h-[60px] text-[12px] font-bold ${on ? 'text-ink' : 'text-muted'}`}>
                <span className={`h-7 w-12 rounded-full inline-flex items-center justify-center ${on ? 'bg-accent' : ''}`}>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={it.d} /></svg>
                </span>
                {t(it.label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
