'use client';
import { useEffect, useState } from 'react';

/*
 * The basket badge in the header and on the phone bar has to move the moment a product goes in, on any page,
 * without reloading. The builder says the new count; whatever shows a count listens.
 */
const EVENT = 'brandit:basket';

export function announceBasket(count: number) {
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { count } })); } catch { /* the next page load shows it */ }
}

export function useBasketCount(initial: number): number {
  const [n, setN] = useState(initial);
  useEffect(() => setN(initial), [initial]);
  useEffect(() => {
    const on = (e: Event) => { const c = (e as CustomEvent).detail?.count; if (typeof c === 'number') setN(c); };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return n;
}
