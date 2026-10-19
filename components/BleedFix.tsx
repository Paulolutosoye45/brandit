'use client';
import { useState } from 'react';
import { Notice } from '@/components/Bits';
import { useT } from '@/components/LangProvider';

type Line = { id: string; status: string; label: string; message: string; action?: string };
export type BleedResult = { fileId: string; beforeFileId: string | null; check: { status: 'pass' | 'warn' | 'stop'; headline: string; lines: Line[]; dpi?: number | null } };

/*
 * The extra edge (bleed), offered when a design is exactly the finished size.
 *  - "Add the extra edge for me": a copy of the file with a 3 mm mirrored edge replaces it on the line.
 *  - The customer sees the file before and after, and can go back to their own file in one tap.
 * The customer's original is never overwritten.
 */
export function BleedFix(p: {
  orderId: string; itemId: string; lines: Line[]; fileId: string | null; beforeFileId: string | null; pdf: boolean; disabled?: boolean;
  onResult: (r: BleedResult) => void;
}) {
  const tr = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const offer = !p.pdf && !p.beforeFileId && p.lines.some((l) => l.action === 'add_bleed');
  if (!offer && !p.beforeFileId) return null;

  async function call(undo: boolean) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/orders/${p.orderId}/fix-bleed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: p.itemId, undo }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { setErr(j.error ?? tr('Something went wrong. Please try again.')); return; }
      p.onResult({ fileId: j.fileId, beforeFileId: j.beforeFileId ?? null, check: j.check });
    } catch {
      setErr(tr('We could not reach Brandit. Check your connection and try again.'));
    } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-3" data-bleed>
      {err && <Notice tone="bad">{err}</Notice>}
      {offer && (
        <div className="grid gap-2 rounded-md2 border-2 border-accent bg-accent/20 p-4">
          <p className="text-[16px] font-bold">{tr('Add the extra edge for me')}</p>
          <p className="text-[14px] text-muted">{tr('We copy your design and continue its edges by 3 mm, so no white line shows after cutting. Your own file is kept, and you can go back to it.')}</p>
          <button type="button" className="btn-secondary btn-sm self-start" disabled={busy || p.disabled} onClick={() => call(false)}>{busy ? tr('One moment…') : tr('Add the extra edge (free)')}</button>
        </div>
      )}
      {p.beforeFileId && p.fileId && (
        <figure className="grid gap-2 rounded-md2 bg-paper2 p-4" aria-label={tr('Before and after')}>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5 text-center">
              <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-sm2 border border-line bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${p.beforeFileId}?o=${p.orderId}`} alt={tr('Your file, as you sent it')} className="h-full w-full object-contain" />
              </div>
              <figcaption className="text-[13px] font-bold">{tr('Before: your file')}</figcaption>
            </div>
            <div className="grid gap-1.5 text-center">
              <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-sm2 border border-line bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${p.fileId}?o=${p.orderId}`} alt={tr('Your file with the extra edge')} className="h-full w-full object-contain" />
              </div>
              <figcaption className="text-[13px] font-bold">{tr('After: with a 3 mm extra edge')}</figcaption>
            </div>
          </div>
          <p className="text-[13px] text-muted">{tr('The extra edge is cut off after printing. Nothing inside your design has moved.')}</p>
          <button type="button" className="link self-start text-[14px]" disabled={busy || p.disabled} onClick={() => call(true)}>{busy ? tr('One moment…') : tr('Use my original file instead')}</button>
        </figure>
      )}
    </div>
  );
}
