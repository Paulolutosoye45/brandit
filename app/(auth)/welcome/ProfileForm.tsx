'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { submitProfile } from '../actions';
import { PhoneField } from '@/components/PhoneField';
import { Notice } from '@/components/Bits';
import { toE164 } from '@/lib/phoneFormat';

type Zone = { id: string; name: string; areas: string[] };
type Initial = { name: string; whatsapp: string; email: string; hasEmail: boolean; accountType: 'personal' | 'business'; company: string; area: string; marketing: boolean };

export function ProfileForm({ next, editing, zones, initial }: { next: string; editing: boolean; zones: Zone[]; initial: Initial }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [err, setErr] = useState<{ field: string; error: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Initial>(k: K, v: Initial[K]) => { setF((p) => ({ ...p, [k]: v })); if (err?.field === k) setErr(null); };
  const bad = (k: string) => err?.field === k;
  const msg = (k: string) => (bad(k) ? <p role="alert" className="mt-1.5 text-[14px] font-bold text-bad">{err!.error}</p> : null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await submitProfile({
      name: f.name, whatsapp: toE164(f.whatsapp), accountType: f.accountType, company: f.company, area: f.area || undefined,
      email: f.hasEmail ? undefined : f.email, marketing: f.marketing,
    }, next);
    if (!r.ok) { setBusy(false); setErr({ field: r.field, error: r.error }); document.getElementById(r.field)?.focus(); return; }
    router.replace(r.to);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid w-full max-w-[460px] gap-6" noValidate>
      <div className="grid gap-2">
        <h1 className="text-[34px] leading-[1.05]">{editing ? 'Your details' : 'Who is ordering?'}</h1>
        <p className="text-[17px] text-muted">{editing ? 'Keep these up to date so riders and receipts get it right.' : 'Two quick things so the rider knows who to look for and where to send your order updates.'}</p>
      </div>

      <div>
        <label htmlFor="name" className="label">Your name</label>
        <input id="name" className="field" autoComplete="name" autoFocus={!initial.name} value={f.name} onChange={(e) => set('name', e.target.value)} aria-invalid={bad('name')} placeholder="Tunde Adeyemi" />
        {msg('name')}
      </div>

      <div>
        <label htmlFor="whatsapp" className="label">WhatsApp number</label>
        <PhoneField id="whatsapp" value={f.whatsapp} onChange={(v) => set('whatsapp', v)} invalid={bad('whatsapp')} autoFocus={!!initial.name && !initial.whatsapp} describedBy="wa-help" />
        {msg('whatsapp') ?? <p id="wa-help" className="mt-1.5 text-[14px] text-muted">We message you here when your file is checked, printed and on its way.</p>}
      </div>

      {!initial.hasEmail && (
        <div>
          <label htmlFor="email" className="label">Email for receipts <span className="font-normal">(optional)</span></label>
          <input id="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" className="field" value={f.email} onChange={(e) => set('email', e.target.value)} aria-invalid={bad('email')} placeholder="you@example.com" />
          {msg('email')}
        </div>
      )}

      <fieldset>
        <legend className="label">Who is this for?</legend>
        <div className="grid grid-cols-2 gap-3">
          {([['personal', 'Me', 'Personal orders'], ['business', 'My business', 'Invoices and reorders']] as const).map(([v, t, d]) => (
            <label key={v} className={`cursor-pointer rounded-md2 border-2 p-4 transition-colors focus-within:shadow-focus ${f.accountType === v ? 'border-ink bg-surface' : 'border-line-control bg-surface hover:border-ink'}`}>
              <input type="radio" name="type" value={v} className="sr-only" checked={f.accountType === v} onChange={() => set('accountType', v)} />
              <span className="flex items-center justify-between gap-2"><span className="font-bold">{t}</span><span className={`grid h-5 w-5 place-items-center rounded-full border-2 ${f.accountType === v ? 'border-ink bg-ink' : 'border-line-control'}`}>{f.accountType === v && <span className="h-2 w-2 rounded-full bg-accent" />}</span></span>
              <span className="mt-0.5 block text-[14px] text-muted">{d}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {f.accountType === 'business' && (
        <div>
          <label htmlFor="company" className="label">Company name</label>
          <input id="company" className="field" autoComplete="organization" value={f.company} onChange={(e) => set('company', e.target.value)} aria-invalid={bad('company')} placeholder="Adeyemi & Sons Ltd" />
          {msg('company') ?? <p className="mt-1.5 text-[14px] text-muted">Shown on your invoices. You can add a tax ID later.</p>}
        </div>
      )}

      <div>
        <label htmlFor="area" className="label">Where do you usually need delivery? <span className="font-normal">(optional)</span></label>
        <select id="area" className="field" value={f.area} onChange={(e) => set('area', e.target.value)} aria-invalid={bad('area')}>
          <option value="">Choose an area</option>
          {zones.map((z) => <optgroup key={z.id} label={z.name}>{z.areas.map((a) => <option key={a}>{a}</option>)}</optgroup>)}
        </select>
        {msg('area') ?? <p className="mt-1.5 text-[14px] text-muted">We will show arrival times for your area on every product.</p>}
      </div>

      <label className="flex cursor-pointer items-start gap-3 text-[15px]">
        <input type="checkbox" className="mt-1 h-5 w-5 accent-[#0B1F33]" checked={f.marketing} onChange={(e) => set('marketing', e.target.checked)} />
        <span>Send me reorder reminders and offers on WhatsApp. <span className="text-muted">Order updates always come to you, whatever you choose here.</span></span>
      </label>

      {err && !['name', 'whatsapp', 'email', 'company', 'area'].includes(err.field) && <Notice tone="bad">{err.error}</Notice>}
      <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Start printing'}</button>
    </form>
  );
}
