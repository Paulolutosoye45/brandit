'use client';
import { useEffect, useState } from 'react';
import { naira } from '@/lib/money';
import { durationText } from '@/lib/time';
import type { publicQuote } from '@/lib/publicQuote';
import { useLang, useT } from '@/components/LangProvider';

/** The arrival line is built on the server from a date. In Pidgin only the small words around the date change. */
export function arrivalLine(text: string, pcm: boolean) {
  const up = text.replace(/^./, (c) => c.toUpperCase());
  return pcm ? up.replace(/ by (\d)/, ' before $1') : up;
}

export type PublicQuote = ReturnType<typeof publicQuote>;
export type QuoteState = PublicQuote | { ok: false; message: string } | null;

/** Counts down to today's cut-off. When it hits zero it asks for a fresh quote. */
export function useCountdown(cutoffAt: string | null | undefined, startMs: number | null | undefined, onExpire?: () => void) {
  const [left, setLeft] = useState<number | null>(startMs ?? null);
  useEffect(() => {
    if (!cutoffAt || startMs == null) { setLeft(null); return; }
    const end = Date.parse(cutoffAt);
    const tick = () => {
      const ms = end - Date.now();
      setLeft(Math.max(0, ms));
      if (ms <= 0) { clearInterval(id); onExpire?.(); }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cutoffAt, startMs]);
  return left;
}

export function PromisePanel({ q, onExpire }: { q: PublicQuote; onExpire?: () => void }) {
  const tr = useT();
  const pcm = useLang() === 'pcm';
  const left = useCountdown(q.cutoffAt, q.countdownMs, onExpire);
  const fast = q.tier === '24h';
  return (
    <div className={`rounded-md2 px-5 py-4 ${fast ? 'bg-good-tint' : 'bg-warn-tint'}`}>
      <p className={`flex items-center gap-2 text-[14px] font-bold ${fast ? 'text-good' : 'text-warn'}`}>
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
        <span>{fast ? (left != null ? <>{tr('24-hour printing. Order in the next')} <span className="tabular">{durationText(left)}</span></> : tr('24-hour printing')) : tr('Standard delivery')}</span>
      </p>
      <p className="font-display font-extrabold text-[24px] leading-tight mt-0.5 capitalize-first">{arrivalLine(q.arrivalText, pcm)}</p>
      {fast ? (
        <p className="text-[14px] text-muted mt-1">{tr('Shown before you pay. Late on a 24-hour order? Delivery is on us.')}</p>
      ) : (
        q.reasonTexts.length > 0 && (
          <ul className="mt-1.5 text-[14px] text-ink grid gap-1">
            {q.reasonTexts.map((t) => <li key={t}>{tr(t)}</li>)}
          </ul>
        )
      )}
      {q.meetsDeadline != null && (
        <p className={`mt-3 text-[14px] font-bold ${q.meetsDeadline ? 'text-good' : 'text-bad'}`}>
          {q.meetsDeadline ? tr('Yes, this arrives in time for your deadline.') : tr('This will not arrive by your deadline. Try pickup, fewer items, or a closer area.')}
        </p>
      )}
    </div>
  );
}

export function PriceBlock({ q, pickup = false }: { q: PublicQuote; pickup?: boolean }) {
  const tr = useT();
  // For quantity and size products, what one piece costs helps people compare. Banners are priced by the square foot, so they skip it.
  const each = q.quantity > 1 && q.areaSqft == null ? Math.round(q.priceKobo / q.quantity) : null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] text-muted">{tr('Your price')}</span>
        <span key={q.priceKobo} className="animate-rise font-display text-[46px] font-extrabold leading-none tabular" aria-live="polite">{naira(q.priceKobo)}</span>
      </div>
      {each != null && <p className="mt-1 text-right text-[14px] font-bold tabular">{tr('About {amount} each', { amount: naira(each) })}</p>}
      <p className="mt-1 text-[14px] text-muted text-right">
        {pickup ? tr('Pickup is free') : q.deliveryKobo > 0 ? tr('plus {amount} delivery to {zone}', { amount: naira(q.deliveryKobo), zone: q.zone?.name.split(':')[0] ?? tr('your area') }) : tr('Delivery fee shown once you choose your area')}
      </p>
    </div>
  );
}
