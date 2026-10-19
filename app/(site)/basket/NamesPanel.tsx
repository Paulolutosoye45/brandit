'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { listText, parseNameList, totalOf, type NameRow } from '@/lib/nameListCore';

/**
 * "Different name on each?" The customer pastes a list or uploads a spreadsheet. We show what we understood before saving,
 * and the quantity (and so the price) follows the list.
 */
export function NamesPanel({ itemId, productName, names, quantity }: { itemId: string; productName: string; names: NameRow[] | null; quantity: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => listText(names));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; warnings: string[] } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  // After a save, the box shows the list as the server kept it.
  const kept = JSON.stringify(names);
  useEffect(() => { setText(listText(names)); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kept]);
  const preview = text.trim() ? parseNameList(text) : null;
  const saved = totalOf(names);
  const mismatch = names && saved !== quantity;

  async function send(init: RequestInit) {
    setBusy(true); setErr(null); setNote(null);
    const res = await fetch(`/api/basket/lines/${itemId}/names`, init);
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(j.error ?? 'Something went wrong. Please try again.'); return false; }
    return j as { total?: number; warnings?: string[]; quantityChanged?: boolean };
  }
  async function save() {
    const j = await send({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!j) return;
    setNote({ text: `Saved: ${j.total} ${productName.toLowerCase()}${j.quantityChanged ? '. The quantity and the price now follow your list.' : '.'}`, warnings: j.warnings ?? [] });
    router.refresh();
  }
  async function upload(f: File) {
    const fd = new FormData();
    fd.append('file', f);
    const j = await send({ method: 'PUT', body: fd });
    if (file.current) file.current.value = '';
    if (!j) return;
    setNote({ text: `Saved your spreadsheet: ${j.total} ${productName.toLowerCase()}${j.quantityChanged ? '. The quantity and the price now follow your list.' : '.'}`, warnings: j.warnings ?? [] });
    router.refresh();
  }
  async function remove() {
    const j = await send({ method: 'DELETE' });
    if (!j) return;
    setText('');
    router.refresh();
  }

  return (
    <div className="col-span-2 sm:col-span-3 rounded-md2 border border-line bg-paper2/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold">Different name on each?</p>
          <p className="text-[14px] text-muted">{names ? <>Your list has {names.length} {names.length === 1 ? 'name' : 'names'} ({saved} {saved === 1 ? 'piece' : 'pieces'}).</> : 'Add a list of names and we print each one. The quantity and price follow your list.'}</p>
        </div>
        <button type="button" className="btn-secondary btn-sm" aria-expanded={open} onClick={() => setOpen((x) => !x)}>{open ? 'Close' : names ? 'Edit the list' : 'Add a list'}</button>
      </div>
      {mismatch && <p role="alert" className="mt-2 rounded-md2 bg-warn-tint px-3 py-2 text-[14px] font-bold text-warn">The list adds up to {saved} but the order says {quantity}. Save the list again to match, or remove it.</p>}
      {open && (
        <div className="mt-3 grid gap-3">
          <div>
            <label className="label" htmlFor={`names-${itemId}`}>One name on each line</label>
            <textarea id={`names-${itemId}`} className="field !py-3 min-h-[160px] font-mono text-[15px]" value={text} onChange={(e) => setText(e.target.value)} placeholder={'Ada Obi\nTunde Bello, Accounts\nChioma Eze, Sales, 2'} />
            <p className="mt-1 text-[13px] text-muted">Add a role, a size or a line of text after a comma, and the number of copies after another comma. Copy a column from Excel and paste it here.</p>
          </div>
          {preview && (preview.ok
            ? <p className="text-[14px]" aria-live="polite"><span className="font-bold">{preview.rows.length} {preview.rows.length === 1 ? 'name' : 'names'}, {preview.total} {preview.total === 1 ? 'piece' : 'pieces'}.</span>{preview.warnings.length > 0 && <span className="text-warn"> {preview.warnings.slice(0, 3).join(' ')}</span>}</p>
            : <p className="text-[14px] text-bad" aria-live="polite">{preview.error}</p>)}
          {err && <p role="alert" className="rounded-md2 bg-bad-tint px-3 py-2 text-[14px] font-bold text-bad">{err}</p>}
          {note && <p role="status" className="rounded-md2 bg-good-tint px-3 py-2 text-[14px]"><span className="font-bold">{note.text}</span>{note.warnings.length > 0 && <span className="block text-[13px]">{note.warnings.slice(0, 4).join(' ')}</span>}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary btn-sm" disabled={busy || !text.trim()} onClick={save}>{busy ? 'Saving…' : 'Save the list'}</button>
            <label className="btn-secondary btn-sm cursor-pointer">Upload a spreadsheet<input ref={file} type="file" className="sr-only" accept=".xlsx,.csv,.txt,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} /></label>
            {names && <button type="button" className="link font-bold text-bad" disabled={busy} onClick={remove}>Remove the list</button>}
          </div>
        </div>
      )}
    </div>
  );
}
