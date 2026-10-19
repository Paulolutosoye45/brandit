'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from './LangProvider';
import { useOrderSheet } from './builder/OrderSheet';
import { useBasketCount } from './builder/basketBus';

const HOME = 'M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z';
const ORDER = 'M12 5v14M5 12h14';
const BAG = 'M6 8h12l1 12H5L6 8zM9 8V7a3 3 0 016 0v1';
const ACCOUNT = 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6';

const cell = (on: boolean) => `flex min-h-[60px] w-full flex-col items-center justify-center gap-0.5 text-[12px] font-bold ${on ? 'text-ink' : 'text-muted'}`;
const pill = (on: boolean) => `relative inline-flex h-7 w-12 items-center justify-center rounded-full ${on ? 'bg-accent' : ''}`;
const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;

/** The phone's bottom bar: Home, Order, Basket, Account. Order opens the Order Builder in a panel. */
export function BottomNav({ signedIn = false, basketCount = 0 }: { signedIn?: boolean; basketCount?: number }) {
  const path = usePathname();
  const t = useT();
  const { open, isOpen } = useOrderSheet();
  const n = useBasketCount(basketCount);
  // At checkout the Pay bar takes the bottom of the screen.
  if (path.startsWith('/checkout')) return null;
  const account = signedIn ? { href: '/account', label: 'Account' } : { href: '/signin', label: 'Sign in' };
  return (
    <nav aria-label="Main" className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]">
      <ul className="grid grid-cols-4">
        <li><Link href="/" aria-current={path === '/' ? 'page' : undefined} className={cell(path === '/' && !isOpen)}><span className={pill(path === '/' && !isOpen)}><Icon d={HOME} /></span>{t('Home')}</Link></li>
        <li>
          <button type="button" aria-haspopup="dialog" onClick={() => open(null, { from: 'panel' })} className={cell(isOpen)}>
            <span className="inline-flex h-7 w-12 items-center justify-center rounded-full bg-ink text-white"><Icon d={ORDER} /></span>
            {t('Order')}
          </button>
        </li>
        <li>
          <Link href="/basket" aria-current={path.startsWith('/basket') ? 'page' : undefined} aria-label={n > 0 ? `${t('Basket')}, ${n}` : t('Basket')} className={cell(path.startsWith('/basket'))}>
            <span className={pill(path.startsWith('/basket'))}>
              <Icon d={BAG} />
              {n > 0 && <span className="absolute -right-0.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-ink px-1 text-[11px] font-bold text-white">{n}</span>}
            </span>
            {t('Basket')}
          </Link>
        </li>
        <li><Link href={account.href} aria-current={path.startsWith('/account') ? 'page' : undefined} className={cell(path.startsWith('/account'))}><span className={pill(path.startsWith('/account'))}><Icon d={ACCOUNT} /></span>{t(account.label)}</Link></li>
      </ul>
    </nav>
  );
}
