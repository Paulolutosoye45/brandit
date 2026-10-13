'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const KEY = 'brandit.coupon';
const TTL = 14 * 86_400_000;

/**
 * A shared link like brandit.ng/?code=WELCOME10 keeps the code on this phone for two weeks and applies it at checkout.
 * The customer sees one slim line saying so, which they can close.
 */
function Inner() {
  const sp = useSearchParams();
  const [code, setCode] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    try {
      const fromLink = (sp.get('code') ?? '').trim().toUpperCase();
      if (/^[A-Z0-9][A-Z0-9_-]{2,23}$/.test(fromLink)) {
        localStorage.setItem(KEY, JSON.stringify({ code: fromLink, at: Date.now() }));
        setCode(fromLink);
        return;
      }
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (saved?.code && Date.now() - saved.at < TTL) setCode(saved.code);
      else if (saved) localStorage.removeItem(KEY);
    } catch { /* private mode: no saved code, nothing to show */ }
  }, [sp]);
  if (!code || closed) return null;
  return (
    <div className="no-print bg-accent text-ink">
      <div className="mx-auto flex max-w-[1160px] items-center justify-between gap-3 px-5 py-2 text-[15px]">
        <p><span className="font-bold">Code {code} is saved.</span> We take it off at checkout.</p>
        <button type="button" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center font-bold" aria-label="Hide this message" onClick={() => setClosed(true)}>×</button>
      </div>
    </div>
  );
}

export function CouponCapture() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}
