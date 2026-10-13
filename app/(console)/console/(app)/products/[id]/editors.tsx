'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/*
 * The small interactive editors on the product page. Each keeps its rows in state and hands the whole
 * list to a server action as one JSON field, so a save is all-or-nothing.
 */

const box = 'accent-[#0B1F33] h-5 w-5';
const plain = (k: number | undefined) => (k ? String(k / 100) : '');

// ---------- Options (Finish, Paper, Sides...) ----------
type Choice = { value?: string; label: string; extra: string; per: 'order' | 'piece' | 'sqft' };
type Opt = { key?: string; label: string; help: string; defIdx: number; choices: Choice[] };
type OptionIn = { key: string; label: string; help?: string; default: string; choices: { value: string; label: string; extra_kobo?: number; extra_per?: 'order' | 'piece' | 'sqft' }[] };

export function OptionsEditor({ id, initial, mode, action }: { id: string; initial: OptionIn[]; mode: string; action: (fd: FormData) => void }) {
  const [opts, setOpts] = useState<Opt[]>(() =>
    initial.map((o) => ({ key: o.key, label: o.label, help: o.help ?? '', defIdx: Math.max(0, o.choices.findIndex((c) => c.value === o.default)), choices: o.choices.map((c) => ({ value: c.value, label: c.label, extra: plain(c.extra_kobo), per: c.extra_per ?? 'order' })) })),
  );
  const set = (i: number, patch: Partial<Opt>) => setOpts((all) => all.map((o, n) => (n === i ? { ...o, ...patch } : o)));
  const setChoice = (i: number, j: number, patch: Partial<Choice>) => setOpts((all) => all.map((o, n) => (n === i ? { ...o, choices: o.choices.map((c, m) => (m === j ? { ...c, ...patch } : c)) } : o)));
  const payload = JSON.stringify(
    opts.map((o) => ({ key: o.key, label: o.label, help: o.help, defaultIndex: o.defIdx, choices: o.choices.map((c) => ({ value: c.value, label: c.label, extra: c.extra, per: c.per })) })),
  );

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="json" value={payload} />
      {opts.length === 0 && <p className="text-muted">No options yet. Add one if customers should choose something, such as a finish or a paper.</p>}
      {opts.map((o, i) => (
        <fieldset key={i} className="rounded-md2 border border-line bg-paper2/50 p-4 grid gap-3">
          <legend className="sr-only">Option {i + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor={`on-${i}`}>What is it called?</label><input id={`on-${i}`} className="field" value={o.label} maxLength={40} placeholder="Finish" onChange={(e) => set(i, { label: e.target.value })} /></div>
            <div><label className="label" htmlFor={`oh-${i}`}>A hint for customers (optional)</label><input id={`oh-${i}`} className="field" value={o.help} maxLength={120} placeholder="Matt looks calm. Gloss looks bright." onChange={(e) => set(i, { help: e.target.value })} /></div>
          </div>
          <div className="grid gap-2">
            <p className="label !mb-0">Choices</p>
            {o.choices.map((c, j) => (
              <div key={j} className="grid grid-cols-[1fr_auto] gap-2 rounded-sm2 bg-surface p-3 border border-line sm:grid-cols-[1fr_130px_150px_auto_auto] sm:items-end">
                <div className="col-span-2 sm:col-span-1"><label className="label" htmlFor={`cl-${i}-${j}`}>Choice</label><input id={`cl-${i}-${j}`} className="field !min-h-[44px]" value={c.label} maxLength={40} placeholder="Gloss" onChange={(e) => setChoice(i, j, { label: e.target.value })} /></div>
                <div><label className="label" htmlFor={`ce-${i}-${j}`}>Extra (₦)</label><input id={`ce-${i}-${j}`} inputMode="numeric" className="field !min-h-[44px]" value={c.extra} placeholder="0" onChange={(e) => setChoice(i, j, { extra: e.target.value.replace(/[^\d.]/g, '') })} /></div>
                <div>
                  <label className="label" htmlFor={`cp-${i}-${j}`}>Charged</label>
                  <select id={`cp-${i}-${j}`} className="field !min-h-[44px]" value={c.per} onChange={(e) => setChoice(i, j, { per: e.target.value as Choice['per'] })}>
                    <option value="order">Once per order</option>
                    <option value="piece">Per piece</option>
                    {mode === 'area' && <option value="sqft">Per square foot</option>}
                  </select>
                </div>
                <label className="flex min-h-[44px] items-center gap-2 text-[14px]"><input type="radio" name={`def-${i}`} className={box} checked={o.defIdx === j} onChange={() => set(i, { defIdx: j })} />Default</label>
                <button type="button" className="btn-ghost btn-sm !text-bad" aria-label={`Remove ${c.label || 'this choice'}`} onClick={() => set(i, { choices: o.choices.filter((_, m) => m !== j), defIdx: o.defIdx === j ? 0 : o.defIdx > j ? o.defIdx - 1 : o.defIdx })}>Remove</button>
              </div>
            ))}
            <button type="button" className="btn-secondary btn-sm self-start" onClick={() => set(i, { choices: [...o.choices, { label: '', extra: '', per: 'order' }] })}>Add a choice</button>
          </div>
          <button type="button" className="btn-ghost btn-sm self-start !text-bad" onClick={() => setOpts((all) => all.filter((_, n) => n !== i))}>Remove the {o.label || 'option'} option</button>
        </fieldset>
      ))}
      <div className="flex flex-wrap gap-3">
        {opts.length < 4 && <button type="button" className="btn-secondary btn-sm" onClick={() => setOpts((all) => [...all, { label: '', help: '', defIdx: 0, choices: [{ label: '', extra: '', per: 'order' }, { label: '', extra: '', per: 'order' }] }])}>Add an option</button>}
        <button className="btn-primary btn-sm">Save options</button>
      </div>
      <p className="text-[13px] text-muted">An extra is added to the price. Leave it empty for no extra. Use &ldquo;per piece&rdquo; for things like lamination on every card.</p>
    </form>
  );
}

// ---------- Sizes with prices ----------
type SizeRowT = { key?: string; label: string; w: string; h: string; price: string };
export function SizesEditor({ id, initial, action }: { id: string; initial: SizeRowT[]; action: (fd: FormData) => void }) {
  const [rows, setRows] = useState<SizeRowT[]>(initial);
  const set = (i: number, patch: Partial<SizeRowT>) => setRows((all) => all.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: number) => setRows((all) => { const j = i + d; if (j < 0 || j >= all.length) return all; const c = [...all]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const payload = JSON.stringify(rows.map((r) => ({ key: r.key, label: r.label, w_in: r.w, h_in: r.h, price: r.price })));
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="json" value={payload} />
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded-md2 border border-line bg-paper2/50 p-3 sm:grid-cols-[1fr_90px_90px_150px_auto] sm:items-end">
          <div className="col-span-2 sm:col-span-1"><label className="label" htmlFor={`sl-${i}`}>Size name</label><input id={`sl-${i}`} className="field !min-h-[44px]" value={r.label} maxLength={50} placeholder="A4" onChange={(e) => set(i, { label: e.target.value })} /></div>
          <div><label className="label" htmlFor={`sw-${i}`}>Width (in)</label><input id={`sw-${i}`} inputMode="decimal" className="field !min-h-[44px]" value={r.w} placeholder="8.3" onChange={(e) => set(i, { w: e.target.value.replace(/[^\d.]/g, '') })} /></div>
          <div><label className="label" htmlFor={`sh-${i}`}>Height (in)</label><input id={`sh-${i}`} inputMode="decimal" className="field !min-h-[44px]" value={r.h} placeholder="11.7" onChange={(e) => set(i, { h: e.target.value.replace(/[^\d.]/g, '') })} /></div>
          <div className="col-span-2 sm:col-span-1"><label className="label" htmlFor={`sp-${i}`}>Price (₦)</label><input id={`sp-${i}`} inputMode="numeric" className="field !min-h-[44px]" value={r.price} placeholder="12000" onChange={(e) => set(i, { price: e.target.value.replace(/[^\d.]/g, '') })} /></div>
          <div className="col-span-2 flex gap-1 sm:col-span-1">
            <button type="button" className="btn-ghost btn-sm" aria-label={`Move ${r.label || 'size'} up`} disabled={i === 0} onClick={() => move(i, -1)}>Up</button>
            <button type="button" className="btn-ghost btn-sm" aria-label={`Move ${r.label || 'size'} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>Down</button>
            <button type="button" className="btn-ghost btn-sm !text-bad" aria-label={`Remove ${r.label || 'size'}`} onClick={() => setRows((all) => all.filter((_, n) => n !== i))}>Remove</button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-3">
        {rows.length < 12 && <button type="button" className="btn-secondary btn-sm" onClick={() => setRows((all) => [...all, { label: '', w: '', h: '', price: '' }])}>Add a size</button>}
        <button className="btn-primary btn-sm">Save sizes and prices</button>
      </div>
      <p className="text-[13px] text-muted">Keep sizes in order from smallest to largest. The width and height let us warn a customer when their file is too small to print sharply.</p>
    </form>
  );
}

// ---------- Quantity steps ----------
type TierRowT = { quantity: string; price: string };
export function TiersEditor({ id, initial, action }: { id: string; initial: TierRowT[]; action: (fd: FormData) => void }) {
  const [rows, setRows] = useState<TierRowT[]>(initial);
  const set = (i: number, patch: Partial<TierRowT>) => setRows((all) => all.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="json" value={JSON.stringify(rows)} />
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 rounded-md2 border border-line bg-paper2/50 p-3 sm:max-w-[560px]">
          <div><label className="label" htmlFor={`tq-${i}`}>Quantity</label><input id={`tq-${i}`} inputMode="numeric" className="field !min-h-[44px]" value={r.quantity} placeholder="100" onChange={(e) => set(i, { quantity: e.target.value.replace(/\D/g, '') })} /></div>
          <div><label className="label" htmlFor={`tp-${i}`}>Price for all (₦)</label><input id={`tp-${i}`} inputMode="numeric" className="field !min-h-[44px]" value={r.price} placeholder="15000" onChange={(e) => set(i, { price: e.target.value.replace(/[^\d.]/g, '') })} /></div>
          <button type="button" className="btn-ghost btn-sm !text-bad" aria-label={`Remove the ${r.quantity || 'empty'} step`} onClick={() => setRows((all) => all.filter((_, n) => n !== i))}>Remove</button>
        </div>
      ))}
      <div className="flex flex-wrap gap-3">
        {rows.length < 12 && <button type="button" className="btn-secondary btn-sm" onClick={() => setRows((all) => [...all, { quantity: '', price: '' }])}>Add a quantity</button>}
        <button className="btn-primary btn-sm">Save prices</button>
      </div>
      <p className="text-[13px] text-muted">The price is for the whole quantity, not each piece. Customers pick from these quantities. A step you remove here can no longer be ordered.</p>
    </form>
  );
}

// ---------- Photo upload ----------
export function ImageUploader({ productId, count, max }: { productId: string; count: number; max: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const room = max - count;

  async function send(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    Array.from(files).slice(0, Math.max(room, 0)).forEach((f) => fd.append('photos', f));
    try {
      const res = await fetch(`/api/console/products/${productId}/images`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({ ok: false, errors: ['The upload failed. Check your connection and try again.'] }));
      const errs: string[] = data.errors ?? (data.error ? [data.error] : []);
      if (data.added) setMsg({ tone: 'good', text: `${data.added} photo${data.added === 1 ? '' : 's'} added.${errs.length ? ' ' + errs.join(' ') : ''}` });
      else setMsg({ tone: 'bad', text: errs.join(' ') || 'The upload failed. Try again.' });
      router.refresh();
    } catch {
      setMsg({ tone: 'bad', text: 'The upload failed. Check your connection and try again.' });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="grid gap-2">
      <input ref={input} id="photo-input" type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => send(e.target.files)} disabled={busy || room <= 0} />
      <label htmlFor="photo-input" className={`btn-primary btn-sm self-start cursor-pointer ${busy || room <= 0 ? 'opacity-60 pointer-events-none' : ''}`}>{busy ? 'Uploading…' : 'Add photos'}</label>
      <p className="text-[13px] text-muted">{room > 0 ? `JPG, PNG or WebP, up to 8 MB each. You can add ${room} more. Photos taken on a phone are fine; we shrink them for fast loading.` : `This product has the most photos allowed (${max}). Remove one to add another.`}</p>
      {msg && <p role={msg.tone === 'bad' ? 'alert' : 'status'} className={`rounded-md2 px-4 py-3 text-[15px] ${msg.tone === 'good' ? 'bg-good-tint' : 'bg-bad-tint'}`}>{msg.text}</p>}
    </div>
  );
}
