'use client';
import { useTransition } from 'react';

/**
 * Opens WhatsApp with the customer's number and the message already typed, and marks the message as taken at the same
 * moment. It is a real link, so it works even if the page script has not loaded.
 */
export function SendButton({ id, href, mark }: { id: number; href: string; mark: (id: number) => Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="btn-primary btn-sm" aria-busy={pending} onClick={() => start(async () => { await mark(id); })}>
      Send on WhatsApp
    </a>
  );
}
