'use client';
import { usePathname } from 'next/navigation';

// Shown where people browse or wait, hidden where a sticky price bar or a form already fills the bottom of the screen.
const SHOW = new Set(['/', '/products', '/help', '/track']);

export function WhatsAppFab({ number }: { number: string }) {
  const path = usePathname();
  if (!(SHOW.has(path) || path.startsWith('/track/') || path.startsWith('/account'))) return null;
  return (
    <a
      href={`https://wa.me/${number}?text=${encodeURIComponent('Hi Brandit, I have a question.')}`}
      target="_blank" rel="noreferrer" aria-label="Talk to a person on WhatsApp"
      className="no-print fixed right-4 bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 inline-flex min-h-[52px] items-center gap-2.5 rounded-full bg-ink px-4 text-white shadow-[0_6px_0_rgba(11,31,51,0.25)] transition-transform active:translate-y-[2px] md:bottom-6 md:right-6 md:px-5"
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6 text-accent" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20l1.3-4.2A8 8 0 1 1 8.4 18.9L4 20z" /><path d="M9 9.5c.3 2 2.2 4 4.5 4.8" /></svg>
      <span className="hidden font-bold md:inline">Talk to a person</span>
    </a>
  );
}
