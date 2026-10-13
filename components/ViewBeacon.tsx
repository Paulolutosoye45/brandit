'use client';
import { useEffect } from 'react';

/** Counts one view of a page, once per visit. Used to see which seasonal pages and templates people look at. */
export function ViewBeacon({ name, slug }: { name: 'campaign_view' | 'template_view' | 'plan_view'; slug: string }) {
  useEffect(() => {
    try {
      const k = `brandit.seen.${name}.${slug}`;
      if (sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, '1');
    } catch { /* storage off: count it anyway */ }
    fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, slug }) }).catch(() => {});
  }, [name, slug]);
  return null;
}
