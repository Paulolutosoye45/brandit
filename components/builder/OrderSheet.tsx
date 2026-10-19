'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ProductVisual } from '@/components/ProductVisual';
import { useT } from '@/components/LangProvider';
import { OrderBuilder } from './OrderBuilder';
import { useBasketCount } from './basketBus';
import type { BuilderData, QuickProduct } from './types';

/*
 * The Order Builder as a panel. It slides up from the bottom on a phone and in from the right on a computer.
 * Anything on the site can open it: the home page tiles, the "Order now" button, the phone bottom bar.
 */

type OpenOpts = { line?: string | null; package?: string | null; qty?: number | null; from?: 'home' | 'panel' | 'basket' };
type Ctx = { open: (slug?: string | null, opts?: OpenOpts) => void; close: () => void; isOpen: boolean };
const SheetCtx = createContext<Ctx | null>(null);

/** Outside the provider (an error page, say) "open" simply goes to the product list. */
export function useOrderSheet(): Ctx {
  return useContext(SheetCtx) ?? { open: (slug) => { window.location.href = slug ? `/products/${slug}` : '/products'; }, close: () => {}, isOpen: false };
}

export function OrderSheetProvider({ children, basketCount = 0 }: { children: React.ReactNode; basketCount?: number }) {
  const [state, setState] = useState<{ open: boolean; slug: string | null; opts: OpenOpts }>({ open: false, slug: null, opts: {} });
  const path = usePathname();
  const lastFocus = useRef<HTMLElement | null>(null);
  const open = useCallback((slug?: string | null, opts: OpenOpts = {}) => {
    lastFocus.current = document.activeElement as HTMLElement | null;
    setState({ open: true, slug: slug ?? null, opts });
  }, []);
  const close = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
    setTimeout(() => lastFocus.current?.focus?.(), 0);
  }, []);
  // Going to another page (checkout, the basket) closes the panel.
  useEffect(() => { setState((s) => (s.open ? { ...s, open: false } : s)); }, [path]);
  const value = useMemo(() => ({ open, close, isOpen: state.open }), [open, close, state.open]);
  return (
    <SheetCtx.Provider value={value}>
      {children}
      {state.open && <Sheet slug={state.slug} opts={state.opts} basketCount={basketCount} onSlug={(slug) => setState((s) => ({ ...s, slug, opts: { from: 'panel' } }))} onClose={close} />}
    </SheetCtx.Provider>
  );
}

function Sheet({ slug, opts, basketCount, onSlug, onClose }: { slug: string | null; opts: OpenOpts; basketCount: number; onSlug: (slug: string | null) => void; onClose: () => void }) {
  const tr = useT();
  const box = useRef<HTMLDivElement>(null);
  const [added, setAdded] = useState(false);
  const count = useBasketCount(basketCount);

  // Lock the page behind, close on Escape, keep Tab inside.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const els = Array.from(box.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not(.sr-only), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((x) => x.offsetParent !== null);
      if (els.length === 0) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70]" role="presentation">
      <div className="absolute inset-0 bg-ink/55" onClick={onClose} aria-hidden="true" />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={tr('Order')}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 flex h-[92dvh] flex-col overflow-hidden rounded-t-lg2 bg-surface shadow-press outline-none animate-rise md:inset-y-0 md:left-auto md:right-0 md:h-full md:w-[540px] md:rounded-none"
      >
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3">
          {slug ? (
            <button type="button" className="inline-flex min-h-[44px] items-center gap-1 font-bold" onClick={() => onSlug(null)}><span aria-hidden>←</span> {tr('All products')}</button>
          ) : (
            <p className="font-display text-[24px] font-extrabold leading-none">{tr('What do you need?')}</p>
          )}
          <button type="button" aria-label={tr('Close')} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-[26px] leading-none hover:bg-paper2" onClick={onClose}>×</button>
        </div>
        <div className="min-h-0 flex-1">
          {slug ? (
            <BuilderLoader key={slug} slug={slug} opts={opts} onAnother={() => { setAdded(true); onSlug(null); }} />
          ) : (
            <Picker count={count} added={added} onPick={(s) => { setAdded(false); onSlug(s); }} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}

function BuilderLoader({ slug, opts, onAnother }: { slug: string; opts: OpenOpts; onAnother: () => void }) {
  const tr = useT();
  const [data, setData] = useState<BuilderData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/builder/${slug}${opts.line ? `?line=${opts.line}` : ''}`, { cache: 'no-store' });
        const j = await res.json();
        if (!alive) return;
        if (!res.ok) setErr(j.error ?? tr('Something went wrong. Please try again.')); else setData(j);
      } catch {
        if (alive) setErr(tr('We could not reach Brandit. Check your connection and try again.'));
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, opts.line]);

  if (err) return <div className="grid gap-3 px-4 py-6"><p className="font-bold text-bad">{err}</p><Link className="btn-secondary btn-sm self-start" href={`/products/${slug}`}>{tr('Open the product page')}</Link></div>;
  if (!data) return <div className="grid gap-3 px-4 py-4" aria-label={tr('Loading')}><div className="h-16 animate-pulse rounded-md2 bg-placeholder" /><div className="h-48 animate-pulse rounded-md2 bg-placeholder" /><div className="h-32 animate-pulse rounded-md2 bg-placeholder" /></div>;
  return <OrderBuilder data={data} mode="panel" startedFrom={opts.from ?? 'panel'} startPackage={opts.package ?? null} startQty={opts.qty ?? null} onAnother={onAnother} />;
}

function Picker({ count, added, onPick, onClose }: { count: number; added: boolean; onPick: (slug: string) => void; onClose: () => void }) {
  const tr = useT();
  const [products, setProducts] = useState<QuickProduct[] | null>(null);
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/builder', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (alive) setProducts(j.products ?? []); }).catch(() => { if (alive) setProducts([]); });
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (!added) input.current?.focus(); }, [added]);
  const shown = (products ?? []).filter((p) => !q.trim() || `${p.name} ${p.category}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="flex h-full flex-col">
      <div className="grid gap-3 px-4 pb-3">
        {added && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md2 bg-good-tint px-4 py-3 text-good">
            <p className="font-bold">{count === 1 ? tr('Added. 1 product in your basket.') : tr('Added. {n} products in your basket.', { n: count })}</p>
            <Link href="/basket" className="btn-primary btn-sm" onClick={onClose}>{tr('Go to basket')}</Link>
          </div>
        )}
        <label htmlFor="sheet-search" className="sr-only">{tr('Search products')}</label>
        <input ref={input} id="sheet-search" className="field" type="search" placeholder={tr('Search: business cards, flyers, banners…')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && shown.length >= 1) onPick(shown[0].slug); }} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {products === null ? (
          <div className="grid grid-cols-2 gap-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-36 animate-pulse rounded-lg2 bg-placeholder" />)}</div>
        ) : shown.length === 0 ? (
          <div className="grid gap-3 rounded-md2 bg-paper2 p-5">
            <p className="font-bold">{tr('We did not find that.')}</p>
            <p className="text-muted">{tr('Describe it and a person sends you a price.')}</p>
            <Link href="/custom-order" className="btn-secondary btn-sm self-start" onClick={onClose}>{tr('Ask for a custom price')}</Link>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {shown.map((p) => (
              <li key={p.slug}>
                <button type="button" onClick={() => onPick(p.slug)} className="flex h-full w-full flex-col overflow-hidden rounded-lg2 border border-line bg-surface text-left transition-colors hover:border-ink">
                  <span className="block aspect-[4/3] w-full bg-paper2"><ProductVisual cover={p.cover} alt="" slug={p.slug} name={p.name} className="h-full w-full" /></span>
                  <span className="grid gap-0.5 p-3">
                    <span className="text-[16px] font-bold leading-tight">{p.name}</span>
                    <span className="text-[14px] font-bold">{p.from}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
