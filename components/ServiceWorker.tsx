'use client';
import { useEffect } from 'react';

/** Registers the small offline helper. Production only, so development never gets stuck behind a cached page. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    const go = () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* not available here; the site works without it */ });
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
  }, []);
  return null;
}
