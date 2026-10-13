'use client';
import { useT } from '@/components/LangProvider';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Notice } from '@/components/Bits';
import { PhoneField } from '@/components/PhoneField';
import { naira } from '@/lib/money';

type TypeT = { key: string; label: string; hint: string };
type ItemT = { key: string; label: string; hint: string; unit: string; priced: boolean };
type Sugg = Record<string, { on: boolean; qty: number }>;
type Props = {
  types: TypeT[]; items: ItemT[]; startType: string; suggestions: Record<string, Sugg>; today: string;
  defaults: { name: string; phone: string; email: string }; replyHours: number; whatsapp: string | null;
};
type Row = { on: boolean; qty: string; touched: boolean };
type Est = { key: string; kobo: number | null; forQty: number | null };
type Err = { message: string; field?: string };

// Mirrors lib/eventPlanCore so the form follows the guest count without a round trip.
const roundUp = (n: number, step: number) => Math.ceil(n / step) * step;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const QTY: Record<string, (g: number) => number> = {
  invitations: (g) => clamp(roundUp(Math.ceil(g / 2), 10), 20, 5000),
  programmes: (g) => clamp(roundUp(g, 10), 20, 5000),
  flyers: (g) => clamp(roundUp(g, 50), 100, 5000),
  posters: () => 10,
  banner: () => 1,
  rollup: () => 1,
  tshirts: (g) => clamp(roundUp(Math.ceil(g / 10), 5), 10, 500),
  souvenirs: (g) => clamp(roundUp(g, 50), 50, 5000),
  badges: (g) => clamp(roundUp(Math.ceil(g / 5), 5), 10, 500),
};
const DRAFT = 'brandit.plan.draft';
const MAX_FILES = 5;

export function PlanForm({ types, items, startType, suggestions, today, defaults, replyHours, whatsapp }: Props) {
  const tr = useT();
  const router = useRouter();
  const [type, setType] = useState(startType);
  const [date, setDate] = useState('');
  const [guests, setGuests] = useState('100');
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(items.map((i) => [i.key, { on: suggestions[startType]?.[i.key]?.on ?? false, qty: String(suggestions[startType]?.[i.key]?.qty ?? 1), touched: false }])));
  const [extra, setExtra] = useState('');
  const [notes, setNotes] = useState('');
  const [c, setC] = useState({ ...defaults, website: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState<Err | null>(null);
  const [busy, setBusy] = useState(false);
  const [est, setEst] = useState<Record<string, Est>>({});
  const pick = useRef<HTMLInputElement>(null);

  // Restore what was typed before, so a dropped connection costs nothing.
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT) ?? 'null');
      if (d && typeof d === 'object') {
        if (typeof d.date === 'string' && d.date > today) setDate(d.date);
        if (typeof d.guests === 'string') setGuests(d.guests);
        if (typeof d.extra === 'string') setExtra(d.extra);
        if (typeof d.notes === 'string') setNotes(d.notes);
        setC((x) => ({ ...x, name: x.name || d.name || '', phone: x.phone || d.phone || '', email: x.email || d.email || '' }));
      }
    } catch { /* no draft */ }
  }, [today]);
  useEffect(() => {
    try { localStorage.setItem(DRAFT, JSON.stringify({ date, guests, extra, notes, name: c.name, phone: c.phone, email: c.email })); } catch { /* storage off */ }
  }, [date, guests, extra, notes, c.name, c.phone, c.email]);

  const g = Math.trunc(Number(guests));
  // Untouched rows follow the event type and the guest count. A row the customer changed stays as they set it.
  useEffect(() => {
    setRows((prev) => {
      const next = { ...prev };
      for (const i of items) {
        if (next[i.key].touched) continue;
        next[i.key] = { ...next[i.key], on: suggestions[type]?.[i.key]?.on ?? false, qty: String((QTY[i.key] ?? (() => 1))(g >= 1 ? g : 100)) };
      }
      return next;
    });
  }, [type, g, items, suggestions]);

  const chosen = useMemo(() => items.filter((i) => rows[i.key]?.on).map((i) => ({ key: i.key, qty: Math.trunc(Number(rows[i.key].qty)) })), [items, rows]);
  const chosenKey = JSON.stringify(chosen);
  useEffect(() => {
    if (chosen.length === 0) { setEst({}); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/plan-event/estimate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: chosenKey });
        const d = await res.json().catch(() => null);
        if (d?.ok) setEst(Object.fromEntries((d.rows as Est[]).map((r) => [r.key, r])));
      } catch { /* the estimate is a nicety */ }
    }, 400);
    return () => clearTimeout(t);
    // chosenKey carries the chosen items; `chosen` itself would re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenKey]);

  const priced = chosen.filter((x) => est[x.key]?.kobo != null);
  const total = priced.reduce((n, x) => n + (est[x.key]!.kobo as number), 0);
  const allPriced = chosen.length > 0 && priced.length === chosen.length;

  const setRow = (k: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [k]: { ...r[k], ...patch, touched: true } }));
  const bad = (f: string) => err?.field === f;

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles([...files, ...Array.from(list)].slice(0, MAX_FILES));
    if (pick.current) pick.current.value = '';
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const fd = new FormData();
    fd.append('type', type); fd.append('date', date); fd.append('guests', guests);
    fd.append('items', JSON.stringify(chosen)); fd.append('extra', extra); fd.append('notes', notes);
    fd.append('name', c.name); fd.append('phone', c.phone); fd.append('email', c.email); fd.append('website', c.website);
    files.forEach((f) => fd.append('files', f));
    try {
      const res = await fetch('/api/plan-event', { method: 'POST', body: fd });
      const d = await res.json().catch(() => null);
      if (!d?.ok) { setErr({ message: d?.error || 'That did not send. Check your connection and try again.', field: d?.field }); setBusy(false); return; }
      try { localStorage.removeItem(DRAFT); } catch { /* ignore */ }
      router.push(d.token === 'thanks' ? '/' : `/custom-order/${d.token}?sent=1`);
    } catch {
      setErr({ message: 'That did not send. Check your connection and try again.' });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-6 pb-24 lg:pb-0" noValidate>
      <section className="card grid gap-4 p-5" aria-labelledby="ev-type">
        <h2 id="ev-type" className="text-[22px]">{tr('1. What kind of event?')}</h2>
        <div role="radiogroup" aria-labelledby="ev-type" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {types.map((t) => (
            <label key={t.key} className="flex min-h-[64px] cursor-pointer flex-col justify-center rounded-md2 border-2 border-line px-3 py-2 has-[:checked]:border-ink has-[:checked]:bg-paper2">
              <input type="radio" name="type" value={t.key} checked={type === t.key} onChange={() => setType(t.key)} className="sr-only" />
              <span className="text-[15px] font-bold leading-tight">{t.label}</span>
            </label>
          ))}
        </div>
        <p className="text-[14px] text-muted">{types.find((t) => t.key === type)?.hint}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ev-date">{tr('Date of the event')}</label>
            <input id="ev-date" type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} required className={`field ${bad('date') ? 'field-bad' : ''}`} aria-invalid={bad('date')} />
            <p className="mt-1 text-[13px] text-muted">{tr('We aim to deliver 2 days before.')}</p>
          </div>
          <div>
            <label className="label" htmlFor="ev-guests">{tr('Guests expected')}</label>
            <input id="ev-guests" inputMode="numeric" value={guests} onChange={(e) => setGuests(e.target.value.replace(/\D/g, '').slice(0, 5))} required className={`field ${bad('guests') ? 'field-bad' : ''}`} aria-invalid={bad('guests')} />
            <p className="mt-1 text-[13px] text-muted">{tr('A rough number is fine. It sets the quantities below.')}</p>
          </div>
        </div>
      </section>

      <section className="card grid gap-3 p-5" aria-labelledby="ev-items">
        <h2 id="ev-items" className="text-[22px]">{tr('2. What do you need printed?')}</h2>
        {bad('items') && err && <Notice tone="bad">{err.message}</Notice>}
        <ul className="grid gap-2">
          {items.map((i) => {
            const r = rows[i.key];
            const e = est[i.key];
            return (
              <li key={i.key} className={`rounded-md2 border-2 p-3 ${r.on ? 'border-ink bg-paper2' : 'border-line'}`}>
                <div className="flex items-start gap-3">
                  <input id={`it-${i.key}`} type="checkbox" checked={r.on} onChange={(ev) => setRow(i.key, { on: ev.target.checked })} className="mt-1 h-6 w-6 shrink-0 accent-[#0B1F33]" />
                  <div className="min-w-0 flex-1">
                    <label htmlFor={`it-${i.key}`} className="block cursor-pointer text-[17px] font-bold leading-tight">{i.label}</label>
                    <p className="text-[14px] text-muted">{i.hint}</p>
                    {r.on && (
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <label className="sr-only" htmlFor={`q-${i.key}`}>How many {i.unit}</label>
                        <input id={`q-${i.key}`} inputMode="numeric" value={r.qty} onChange={(ev) => setRow(i.key, { qty: ev.target.value.replace(/\D/g, '').slice(0, 6) })} className={`field !min-h-[44px] w-28 ${bad(`qty_${i.key}`) ? 'field-bad' : ''}`} />
                        <span className="text-[15px] text-muted">{i.unit}</span>
                        {e?.kobo != null && <span className="ml-auto text-[15px] font-bold tabular">about {naira(e.kobo)}{e.forQty && e.forQty !== Math.trunc(Number(r.qty)) ? <span className="font-normal text-muted"> for {e.forQty}</span> : null}</span>}
                        {e && e.kobo == null && <span className="ml-auto text-[14px] text-muted">{tr('We will price this one')}</span>}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        <div>
          <label className="label" htmlFor="ev-extra">{tr('Anything else?')}</label>
          <textarea id="ev-extra" value={extra} onChange={(e) => setExtra(e.target.value)} maxLength={400} rows={2} className="field" placeholder="Souvenir mugs, a thank-you card, aso-ebi labels…" />
        </div>
        <div>
          <label className="label" htmlFor="ev-notes">{tr('Notes for the designer')} <span className="font-normal text-muted">{tr('(optional)')}</span></label>
          <textarea id="ev-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={600} rows={3} className="field" placeholder="Colours, names, the venue, a style you like…" />
        </div>
        <div className="grid gap-2">
          <p className="label !mb-0">Photos or a logo <span className="font-normal text-muted">(optional, up to {MAX_FILES})</span></p>
          <input ref={pick} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple className="sr-only" id="ev-files" onChange={(e) => addFiles(e.target.files)} />
          <label htmlFor="ev-files" className="btn-secondary btn-sm cursor-pointer self-start">{tr('Add files')}</label>
          {files.length > 0 && (
            <ul className="grid gap-1 text-[14px]">
              {files.map((f, n) => <li key={`${f.name}-${n}`} className="flex items-center justify-between gap-3"><span className="truncate">{f.name}</span><button type="button" className="link shrink-0" onClick={() => setFiles(files.filter((_, k) => k !== n))}>{tr('Remove')}</button></li>)}
            </ul>
          )}
        </div>
      </section>

      <section className="card grid gap-4 p-5" aria-labelledby="ev-you">
        <h2 id="ev-you" className="text-[22px]">{tr('3. Where do we send the price?')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="ev-name">{tr('Your name')}</label><input id="ev-name" autoComplete="name" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} required className={`field ${bad('name') ? 'field-bad' : ''}`} /></div>
          <div><label className="label" htmlFor="ev-phone">{tr('WhatsApp or phone number')}</label><PhoneField id="ev-phone" value={c.phone} onChange={(v) => setC({ ...c, phone: v })} invalid={bad('phone')} /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="ev-email">{tr('Email')} <span className="font-normal text-muted">{tr('(optional)')}</span></label><input id="ev-email" type="email" autoComplete="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} className={`field ${bad('email') ? 'field-bad' : ''}`} /></div>
        </div>
        <div className="hidden" aria-hidden="true"><label>Website<input tabIndex={-1} autoComplete="off" value={c.website} onChange={(e) => setC({ ...c, website: e.target.value })} /></label></div>
        {err && !bad('items') && <Notice tone="bad">{err.message}</Notice>}
        <p className="text-[14px] text-muted">We reply within {replyHours} hours, Monday to Saturday. You pay nothing now.</p>
        {whatsapp && <p className="text-[14px] text-muted">Event in a few days? <a className="link" href={`https://wa.me/${whatsapp}`}>Message us on WhatsApp</a> so we can plan around the date.</p>}
      </section>

      <div className="fixed inset-x-0 bottom-[60px] z-20 border-t border-line bg-surface/95 p-3 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
        <div className="mx-auto flex max-w-[1160px] items-center justify-between gap-3">
          <div className="min-w-0 text-[14px]">
            {chosen.length === 0 ? <span className="text-muted">{tr('Tick what you need')}</span> : allPriced ? <><span className="block text-muted">{tr('Rough print cost')}</span><span className="font-display text-[22px] font-extrabold tabular">about {naira(total)}</span></> : <span className="text-muted">{priced.length > 0 ? `${naira(total)} so far. ` : ''}We price the rest.</span>}
          </div>
          <button className="btn-primary shrink-0 !px-6" disabled={busy}>{busy ? tr('Sending…') : tr('Get my one price')}</button>
        </div>
      </div>
      <p className="text-[13px] text-muted">{tr('The guide above is the print cost only. Design, delivery and anything special are in the price we send you.')}</p>
    </form>
  );
}
