'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatSplit, kindOf, parseSplit, resolveSelection } from '@/lib/options';
import type { ProductOption } from '@/lib/types';
import type { TryIn, TryOut } from '@/lib/priceAdmin';
import { tryPriceAction } from '../../actions';

/*
 * "Try a price": choose things the way a customer would and see the price, what it is made of, what it costs and what
 * margin that leaves. It also lets you try add-ons and combinations that are not on sale yet.
 */

type Props = { productId: string; mode: 'tier' | 'size' | 'area'; options: ProductOption[]; sizes: { key: string; label: string }[]; targetMarginPct: number };
const money = (k: number) => `₦${(k / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

export function TryPrice({ productId, mode, options, sizes, targetMarginPct }: Props) {
  const [qty, setQty] = useState('100');
  const [size, setSize] = useState(sizes[0]?.key ?? '');
  const [w, setW] = useState('6');
  const [h, setH] = useState('3');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [out, setOut] = useState<TryOut | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const q = Math.max(0, Math.trunc(Number(qty)) || 0);
  const sel = useMemo(() => resolveSelection(options, { config, sizeKey: mode === 'size' ? size : null, quantity: q || 1 }, { preview: true }), [options, config, mode, size, q]);

  useEffect(() => {
    const mine = ++seq.current;
    setBusy(true);
    const t = setTimeout(async () => {
      const input: TryIn = { quantity: q || 1, config, sizeKey: mode === 'size' ? size : null, widthFt: mode === 'area' ? Number(w) : undefined, heightFt: mode === 'area' ? Number(h) : undefined };
      try {
        const r = await tryPriceAction(productId, input);
        if (mine === seq.current) setOut(r as TryOut);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [productId, q, config, size, w, h, mode]);

  const pick = (key: string, value: string) => setConfig((c) => ({ ...c, [key]: value }));
  const current = (o: ProductOption) => sel.config[o.key] ?? '';
  const tag = (c: ProductOption['choices'][number]) => (c.unpriced ? ' (needs a price)' : c.hidden ? ' (switched off)' : c.provisional ? ' (placeholder price)' : '');

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {mode === 'size' && (
          <div><label className="label" htmlFor="t-size">Size</label><select id="t-size" className="field !min-h-[44px]" value={size} onChange={(e) => setSize(e.target.value)}>{sizes.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
        )}
        {mode === 'area' && (
          <>
            <div><label className="label" htmlFor="t-w">Width (ft)</label><input id="t-w" inputMode="decimal" className="field !min-h-[44px]" value={w} onChange={(e) => setW(e.target.value.replace(/[^\d.]/g, ''))} /></div>
            <div><label className="label" htmlFor="t-h">Height (ft)</label><input id="t-h" inputMode="decimal" className="field !min-h-[44px]" value={h} onChange={(e) => setH(e.target.value.replace(/[^\d.]/g, ''))} /></div>
          </>
        )}
        {sel.quantity === null && <div><label className="label" htmlFor="t-q">{mode === 'tier' ? 'Quantity' : 'How many'}</label><input id="t-q" inputMode="numeric" className="field !min-h-[44px]" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} /></div>}
      </div>

      {sel.active.map((o) => {
        const kind = kindOf(o);
        return (
          <fieldset key={o.key} className="grid gap-2">
            <legend className="label !mb-1">{o.label}{o.group === 'special' ? ' (make it special)' : ''}</legend>
            {kind === 'pick' && (
              <select aria-label={o.label} className="field !min-h-[44px]" value={current(o)} onChange={(e) => pick(o.key, e.target.value)}>
                {o.choices.map((c) => <option key={c.value} value={c.value}>{c.label}{tag(c)}</option>)}
              </select>
            )}
            {kind === 'tick' && (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {o.choices.map((c) => {
                  const on = (current(o) || '').split(',').includes(c.value);
                  return (
                    <label key={c.value} className="inline-flex min-h-[40px] items-center gap-2 text-[15px]">
                      <input type="checkbox" className="h-5 w-5 accent-[#0B1F33]" checked={on} onChange={(e) => {
                        const set = new Set((current(o) || '').split(',').filter(Boolean));
                        if (e.target.checked) set.add(c.value); else set.delete(c.value);
                        pick(o.key, o.choices.map((x) => x.value).filter((v) => set.has(v)).join(','));
                      }} />{c.label}{tag(c)}
                    </label>
                  );
                })}
              </div>
            )}
            {kind === 'split' && (
              <div className="flex flex-wrap gap-2">
                {o.choices.map((c) => {
                  const counts = parseSplit(current(o));
                  return (
                    <label key={c.value} className="grid gap-1 text-[13px] font-bold text-muted">{c.label}{tag(c)}
                      <input inputMode="numeric" className="field !min-h-[40px] !w-[76px] !px-2" value={counts[c.value] ?? ''} placeholder="0" onChange={(e) => {
                        const next = { ...counts, [c.value]: Math.trunc(Number(e.target.value.replace(/\D/g, ''))) || 0 };
                        pick(o.key, formatSplit(next, o.choices.map((x) => x.value)) || ' ');
                      }} />
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>
        );
      })}

      <div className="rounded-md2 border-2 border-ink p-4" aria-live="polite">
        {!out && <p className="text-muted">Working out the price…</p>}
        {out && !out.ok && <p className="font-bold text-bad">{out.error}</p>}
        {out && out.ok && (
          <div className={`grid gap-3 ${busy ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-[32px] font-bold leading-none">{money(out.priced.totalKobo)}</span>
              <span className="text-muted">{out.priced.quantity.toLocaleString('en-US')} {mode === 'area' ? `× ${out.priced.unitLabel}` : 'pieces'}{out.priced.basis !== 'step' && out.priced.fromStep ? `, worked out from the ${out.priced.fromStep.toLocaleString('en-US')} step` : ''}</span>
            </div>
            {out.priced.notes.length > 0 && <ul className="list-disc pl-5 text-[14px] text-warn">{out.priced.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            <table className="w-full text-[14px]">
              <tbody>
                {out.priced.lines.map((l, i) => (
                  <tr key={i} className="border-t border-line first:border-0"><td className="py-1 pr-3"><span className="font-bold">{l.label}</span>{l.detail && <span className="block text-muted">{l.detail}</span>}</td><td className={`py-1 text-right tabular-nums ${l.kobo < 0 ? 'text-good' : ''}`}>{l.kobo < 0 ? '−' : ''}{money(Math.abs(l.kobo))}</td></tr>
                ))}
              </tbody>
            </table>
            {out.priced.costKobo != null ? (
              <p className="text-[14px]">
                It costs us <b>{money(out.priced.costKobo)}</b>
                {out.margin && <>, which leaves <b className={out.margin.level === 'loss' ? 'text-bad' : out.margin.level === 'thin' ? 'text-warn' : 'text-good'}>{out.margin.level === 'loss' ? 'a loss' : `${Math.round(out.margin.pct)}%`}</b> (target {targetMarginPct}%).</>}
                {out.suggested != null && <> To reach {targetMarginPct}% this would need to be about <b>{money(out.suggested)}</b>.</>}
              </p>
            ) : (
              <p className="text-[14px] text-muted">No cost is entered for some part of this price, so the margin cannot be worked out. Turn on &ldquo;Show what it costs us&rdquo; in the grid and fill in the costs.</p>
            )}
            {out.ladder.length > 1 && (
              <div className="overflow-x-auto"><table className="text-[13px]"><caption className="mb-1 text-left font-bold">Quantity steps with these choices</caption><tbody>
                <tr>{out.ladder.map((s) => <th key={s.quantity} className="px-2 text-right font-bold">{s.quantity.toLocaleString('en-US')}</th>)}</tr>
                <tr>{out.ladder.map((s) => <td key={s.quantity} className="px-2 text-right tabular-nums">{money(s.totalKobo)}</td>)}</tr>
                <tr>{out.ladder.map((s) => <td key={s.quantity} className="px-2 text-right tabular-nums text-muted">{money(s.unitKobo)} each{s.savePct ? ` · save ${s.savePct}%` : ''}</td>)}</tr>
              </tbody></table></div>
            )}
            {out.packages.length > 0 && (
              <p className="text-[14px]"><b>Packages at this quantity:</b> {out.packages.map((p) => `${p.label} ${money(p.totalKobo)}`).join(' · ')}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
