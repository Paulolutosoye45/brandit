'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const KEY = 'brandit.draft';
const TTL = 3 * 86_400_000;
// Only on pages where a person is browsing. In the order flow itself the bar would just be in the way.
const SHOW = (p: string) => p === '/' || p === '/products' || p === '/help' || p.startsWith('/account');

/** "Pick up where you left off." The order a person started on this phone and did not finish. */
export function ResumeOrder() {
  const path = usePathname();
  const [o, setO] = useState<{ title: string; price: string; next: string } | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (!SHOW(path)) return;
    let alive = true;
    (async () => {
      try {
        const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
        if (!saved?.id || Date.now() - saved.at > TTL) { localStorage.removeItem(KEY); return; }
        const r = await fetch(`/api/orders/${saved.id}/resume`).then((x) => x.json());
        if (!alive) return;
        if (r.open) setO(r); else localStorage.removeItem(KEY);
      } catch { /* no saved order, or storage is blocked: show nothing */ }
    })();
    return () => { alive = false; };
  }, [path]);

  if (!o || closed || !SHOW(path)) return null;
  return (
    <div className="no-print border-b border-line bg-warn-tint">
      <div className="mx-auto flex max-w-[1160px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-2 text-[15px]">
        <p><span className="font-bold">Pick up where you left off:</span> {o.title}, {o.price}</p>
        <div className="flex items-center gap-1">
          <Link href={o.next} className="btn-primary btn-sm">Continue</Link>
          <button type="button" aria-label="Hide this" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center font-bold" onClick={() => setClosed(true)}>×</button>
        </div>
      </div>
    </div>
  );
}
