'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PriceBlock, PromisePanel, type QuoteState, type PublicQuote } from './PromiseCard';
import { CropMarks } from './Brand';

type Zone = { id: string; name: string; areas: string[] };

/** The home page's live example: a real price and a real delivery time for one quantity-priced product. */
export function HeroQuote({ zones, qtys, defaultArea, slug, name }: { zones: Zone[]; qtys: number[]; defaultArea?: string | null; slug: string; name: string }) {
  const [qty, setQty] = useState(qtys.includes(100) ? 100 : qtys[0]);
  const [area, setArea] = useState(zones[0]?.areas[0] ?? '');
  const [q, setQ] = useState<QuoteState>(null);
  const seq = useRef(0);

  useEffect(() => {
    const saved = localStorage.getItem('brandit.area');
    if (saved && zones.some((z) => z.areas.includes(saved))) setArea(saved);
    else if (defaultArea && zones.some((z) => z.areas.includes(defaultArea))) setArea(defaultArea);
  }, [zones, defaultArea]);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const r = await fetch('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, quantity: qty, area }) }).then((x) => x.json()).catch(() => null);
    if (mine === seq.current && r) setQ(r);
  }, [qty, area, slug]);
  useEffect(() => { load(); }, [load]);

  const ok = q && q.ok ? (q as PublicQuote) : null;
  return (
    <div className="relative">
    <CropMarks />
    <div className="card relative grid gap-5 rounded-lg2 border-ink p-6 shadow-press sm:p-7" aria-label="Live price and delivery time">
      <div className="flex items-center justify-between gap-3">
        <p className="font-display font-extrabold text-[24px]">{name}</p>
        {ok?.tier === '24h' && <span className="pill bg-ink text-white animate-pop">24-hour</span>}
      </div>
      <div>
        <p className="label">How many?</p>
        <div className={`grid gap-2 ${qtys.length <= 4 ? 'grid-cols-4' : 'grid-cols-3 sm:grid-cols-4'}`} role="group" aria-label="Quantity">
          {qtys.slice(0, 8).map((n) => <button key={n} type="button" className="choice !px-0" aria-pressed={qty === n} onClick={() => setQty(n)}>{n.toLocaleString('en-US')}</button>)}
        </div>
      </div>
      <div>
        <label htmlFor="hero-area" className="label">Deliver to</label>
        <select id="hero-area" className="field" value={area} onChange={(e) => { setArea(e.target.value); localStorage.setItem('brandit.area', e.target.value); }}>
          {zones.map((z) => <optgroup key={z.id} label={z.name}>{z.areas.map((a) => <option key={a}>{a}</option>)}</optgroup>)}
        </select>
      </div>
      <div className="border-t border-line pt-5 grid gap-4 min-h-[210px]">
        {ok ? (<><PriceBlock q={ok} /><PromisePanel q={ok} onExpire={load} /></>) : <div className="h-[190px] rounded-md2 bg-placeholder animate-pulse" />}
      </div>
      <Link href={`/products/${slug}`} className="btn-primary">Order {name.toLowerCase()}</Link>
    </div>
    </div>
  );
}
