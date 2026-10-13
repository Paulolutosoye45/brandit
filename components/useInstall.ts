'use client';
import { useCallback, useEffect, useState } from 'react';

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const SNOOZE = 'brandit.install.snooze';
const DONE = 'brandit.install.done';
const VISITS = 'brandit.visits';
const DAY = 86_400_000;

let deferred: BIPEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
if (typeof window !== 'undefined') {
  // Captured as early as this module loads, so the browser's offer is not missed before a component mounts.
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BIPEvent; notify(); });
  window.addEventListener('appinstalled', () => { deferred = null; try { localStorage.setItem(DONE, '1'); } catch { /* storage off */ } notify(); });
}

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage off */ } };

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}
function isIosSafari() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // Other iPhone browsers cannot add to the home screen from their own menu in the same way, so we only guide Safari.
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
}

/** Count one visit per browser session. Used to wait until someone has come back before asking. */
export function countVisit(): number {
  try {
    if (!sessionStorage.getItem('brandit.visit.counted')) {
      sessionStorage.setItem('brandit.visit.counted', '1');
      put(VISITS, String((Number(get(VISITS)) || 0) + 1));
    }
  } catch { /* storage off */ }
  return Number(get(VISITS)) || 0;
}

export function useInstall() {
  const [, tick] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    setReady(true);
    return () => { listeners.delete(l); };
  }, []);

  const standalone = ready && isStandalone();
  const done = ready && get(DONE) === '1';
  const snoozed = ready && Number(get(SNOOZE) || 0) > Date.now();
  const ios = ready && isIosSafari();
  const canPrompt = ready && !!deferred;
  const available = ready && !standalone && !done && (canPrompt || ios);

  const install = useCallback(async () => {
    if (!deferred) return 'none' as const;
    const e = deferred;
    deferred = null;
    notify();
    await e.prompt();
    const { outcome } = await e.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
    if (outcome === 'accepted') put(DONE, '1');
    else put(SNOOZE, String(Date.now() + 30 * DAY));
    notify();
    return outcome;
  }, []);
  const snooze = useCallback((days = 30) => { put(SNOOZE, String(Date.now() + days * DAY)); notify(); }, []);

  return { available, canPrompt, ios, snoozed, install, snooze };
}
