'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Prod = { slug: string; name: string; grid: { changed: number; added: number; removed: number; costsOnly: number; confirmed: number; summary: string } | null; addons: number; lines: string[] };
type Result = { ok: boolean; applied: boolean; products: Prod[]; problems: string[]; belowCost: string[]; readLines: number; unchanged: number };

/** Upload a filled-in price sheet, look at what it would change, then apply it. */
export function SheetUpload() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [error, setError] = useState('');

  async function send(mode: 'check' | 'apply') {
    if (!file) return;
    setBusy(true);
    setError('');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('mode', mode);
    try {
      const r = await fetch('/api/console/products/sheet', { method: 'POST', body: fd });
      const data = (await r.json().catch(() => null)) as Result | null;
      if (!data) setError('The upload failed. Check your connection and try again.');
      else {
        setRes(data);
        if (data.applied) router.refresh();
      }
    } catch {
      setError('The upload failed. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const changes = res?.products.reduce((n, p) => n + (p.grid ? p.grid.changed + p.grid.added + p.grid.removed + p.grid.costsOnly + p.grid.confirmed : 0) + p.addons, 0) ?? 0;

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <label className="label" htmlFor="sheet-file">Your filled-in price sheet (Excel or CSV)</label>
        <input id="sheet-file" ref={input} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="field !py-2" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRes(null); setError(''); }} />
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-secondary btn-sm" disabled={!file || busy} onClick={() => send('check')}>{busy ? 'Reading…' : 'Check it: show me what would change'}</button>
      </div>
      <div aria-live="polite" className="grid gap-3">
        {error && <p className="font-bold text-bad">{error}</p>}
        {res && res.problems.length > 0 && (
          <div className="rounded-md2 border-2 border-bad bg-bad-tint p-4">
            <p className="font-bold text-bad">Nothing was saved. Fix {res.problems.length === 1 ? 'this' : 'these'} in the sheet and upload it again:</p>
            <ul className="mt-1 list-disc pl-5 text-[15px]">{res.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </div>
        )}
        {res && res.ok && (
          <div className={`rounded-md2 border-2 p-4 ${res.applied ? 'border-good bg-good-tint' : 'border-ink'}`}>
            <p className="font-bold">{res.applied ? 'Saved. Customers see these prices now.' : changes === 0 ? 'This sheet would not change anything.' : `This sheet would make ${changes} change${changes === 1 ? '' : 's'}. Nothing is saved yet.`}</p>
            <p className="text-[14px] text-muted">{res.readLines} lines read, {res.unchanged} already the same.</p>
            {res.products.length > 0 && (
              <ul className="mt-2 grid gap-1 text-[15px]">
                {res.products.map((p) => (
                  <li key={p.slug}>
                    <b>{p.name}</b>: {[p.grid?.summary.replace(`${p.name}: `, '').replace(/\.$/, ''), p.addons ? `${p.addons} add-on${p.addons === 1 ? '' : 's'} updated` : ''].filter(Boolean).join('; ')}
                    {p.lines.length > 0 && <span className="block text-[13px] text-muted">{p.lines.slice(0, 6).join(' · ')}{p.lines.length > 6 ? ` · and ${p.lines.length - 6} more` : ''}</span>}
                  </li>
                ))}
              </ul>
            )}
            {res.belowCost.length > 0 && <p className="mt-2 text-[15px] font-bold text-warn">Careful: {res.belowCost.length} price{res.belowCost.length === 1 ? ' is' : 's are'} below cost ({res.belowCost.slice(0, 4).join('; ')}{res.belowCost.length > 4 ? '…' : ''}).</p>}
            {!res.applied && changes > 0 && (
              <div className="mt-3"><button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => send('apply')}>{busy ? 'Saving…' : `Save these ${changes} change${changes === 1 ? '' : 's'}`}</button></div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
