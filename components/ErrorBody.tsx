'use client';
import Link from 'next/link';
import { useEffect } from 'react';

/** When something breaks on our side. Says so plainly, lets the person retry, and never shows a stack trace. */
export function ErrorBody({ error, reset, standalone = false }: { error: Error & { digest?: string }; reset: () => void; standalone?: boolean }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className={`mx-auto grid max-w-[560px] justify-items-start gap-6 px-5 ${standalone ? 'min-h-screen content-center py-10' : 'py-16 sm:py-24'}`}>
      <div className="grid gap-2">
        <h1 className="text-[40px] leading-[1.05] sm:text-[52px]">Something went wrong on our side.</h1>
        <p className="text-[18px] text-muted">It was not anything you did, and your order is safe. Try again. If it keeps happening, tell us and we will sort it out.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-primary" onClick={reset}>Try again</button>
        <Link href="/help" className="btn-secondary">Get help</Link>
        <Link href="/" className="btn-ghost">Go to the home page</Link>
      </div>
      {error.digest && <p className="text-[13px] text-muted">Reference for our team: <span className="font-bold tabular">{error.digest}</span></p>}
    </div>
  );
}
