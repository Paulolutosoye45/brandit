'use client';
import Link from 'next/link';
import { useOrderSheet } from './OrderSheet';
import { useBasketCount } from './basketBus';

/** "Order now" in the header. It opens the Order Builder in a panel from any page. */
export function OrderNowButton({ label }: { label: string }) {
  const { open } = useOrderSheet();
  return <button type="button" className="btn-primary btn-sm hidden whitespace-nowrap md:inline-flex" onClick={() => open(null, { from: 'panel' })}>{label}</button>;
}

const BAG = 'M6 8h12l1 12H5L6 8zM9 8V7a3 3 0 016 0v1';

/** The basket in the header, with how many products are in it. The phone has its own in the bottom bar. */
export function BasketLink({ initial, label }: { initial: number; label: string }) {
  const n = useBasketCount(initial);
  return (
    <Link href="/basket" aria-label={n > 0 ? `${label}, ${n}` : label} className="relative hidden min-h-[44px] min-w-[44px] items-center justify-center rounded-full hover:bg-paper2 md:inline-flex">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={BAG} /></svg>
      {n > 0 && <span className="absolute right-0.5 top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-ink px-1 text-[12px] font-bold text-white">{n}</span>}
    </Link>
  );
}

/** A button anywhere on a page that opens the Order Builder: on a product when it is given one, on the product list when it is not. */
export function OpenOrder({ label, slug = null, className = 'btn-primary' }: { label: string; slug?: string | null; className?: string }) {
  const { open } = useOrderSheet();
  return <button type="button" className={className} onClick={() => open(slug, { from: 'home' })}>{label}</button>;
}
