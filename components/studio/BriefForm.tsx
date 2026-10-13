'use client';
import { useRef, useState } from 'react';
import type { ProjectView } from '@/lib/studio/view';
import { FONT_CHOICES, PALETTES, SHAPE_CHOICES, STYLES, THEME_CHOICES } from '@/content/studio';
import { act, Spinner, Toast } from './ui';

export type Draft = ProjectView['brief'];

/** The words, the look and the pictures. The same form is used before payment and for free word changes afterwards. */
export function BriefForm({ v, draft, onChange, locked, onAssetsChanged, onConsent }: {
  v: ProjectView; draft: Draft; onChange: (d: Draft) => void; locked: boolean; onAssetsChanged: () => void; onConsent: () => void;
}) {
  const logo = v.assets.find((a) => a.kind === 'logo') ?? null;
  const photo = v.assets.find((a) => a.kind === 'photo') ?? null;
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const setLine = (id: string, text: string) => onChange({ ...draft, lines: { ...draft.lines, [id]: text } });
  const setChoice = (patch: Partial<Draft['choices']>) => onChange({ ...draft, choices: { ...draft.choices, ...patch } });
  const isId = v.product.slug === 'id-cards';

  return (
    <div className="grid gap-6">
      <fieldset className="grid gap-4" disabled={locked}>
        <legend className="text-[20px] font-bold">Your words</legend>
        <p className="-mt-2 text-[15px] text-muted">Type these exactly as they must print. Brandit sets them in real letters, so they will never be misspelled by the picture maker.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {v.occasion.lines.map((l) => (
            <div key={l.id} className={l.max > 70 ? 'sm:col-span-2' : ''}>
              <label className="label" htmlFor={`l-${l.id}`}>{l.label}{l.required ? <span className="text-bad"> *</span> : null}</label>
              <input id={`l-${l.id}`} className="field" value={draft.lines[l.id] ?? ''} maxLength={l.max} placeholder={l.example} autoComplete="off" onChange={(e) => setLine(l.id, e.target.value)} />
              {l.hint && <p className="mt-1 text-[13px] text-muted">{l.hint}</p>}
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="grid gap-4" disabled={locked}>
        <legend className="text-[20px] font-bold">The look</legend>
        <div>
          <label className="label" htmlFor="look">Describe the feel you want (optional)</label>
          <textarea id="look" className="field py-3" rows={2} maxLength={300} value={draft.look} onChange={(e) => set({ look: e.target.value })} placeholder="For example: royal blue and gold, calm and rich, plenty Ankara pattern" />
          <p className="mt-1 text-[13px] text-muted">English, Pidgin or Yoruba is fine. Only this description is sent to the picture maker. Do not put names or numbers here.</p>
        </div>
        <div role="radiogroup" aria-label="Style" className="flex flex-wrap gap-2">
          {STYLES.filter((s) => !s.muted || v.occasion.id === 'party' || v.occasion.id === 'owambe').map((s) => (
            <label key={s.id} className={`inline-flex min-h-[44px] cursor-pointer items-center rounded-full border-2 px-4 font-bold ${draft.style === s.id ? 'border-ink bg-ink text-white' : 'border-line-control bg-surface hover:border-ink'}`}>
              <input type="radio" name="style" className="sr-only" checked={draft.style === s.id} onChange={() => set({ style: s.id })} />{s.label}
            </label>
          ))}
        </div>
        <div>
          <p className="label">Colours</p>
          <div role="radiogroup" aria-label="Colours" className="flex flex-wrap gap-2">
            {logo && (
              <label className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border-2 px-3 font-bold ${draft.palette === 'logo' ? 'border-ink bg-paper2' : 'border-line-control bg-surface hover:border-ink'}`}>
                <input type="radio" name="palette" className="sr-only" checked={draft.palette === 'logo'} onChange={() => set({ palette: 'logo' })} />
                {(logo.theme ? [logo.theme.bg, logo.theme.accent] : logo.colours.slice(0, 2)).map((c: string) => <span key={c} className="h-5 w-5 rounded-full border border-line" style={{ background: c }} />)}From my logo
              </label>
            )}
            {PALETTES.map((p) => (
              <label key={p.id} className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border-2 px-3 font-bold ${draft.palette === p.id ? 'border-ink bg-paper2' : 'border-line-control bg-surface hover:border-ink'}`}>
                <input type="radio" name="palette" className="sr-only" checked={draft.palette === p.id} onChange={() => set({ palette: p.id })} />
                <span className="h-5 w-5 rounded-full border border-line" style={{ background: p.bg }} /><span className="-ml-3 h-5 w-5 rounded-full border border-line" style={{ background: p.accent }} />
                <span className="text-[14px]">{p.label}</span>
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2" disabled={locked}>
        <legend className="mb-2 text-[20px] font-bold">Lettering</legend>
        <div>
          <label className="label" htmlFor="font">Letter style</label>
          <select id="font" className="field" value={draft.choices.font} onChange={(e) => setChoice({ font: e.target.value as any })}>
            {FONT_CHOICES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <p className="mt-1 text-[13px] text-muted">{FONT_CHOICES.find((f) => f.id === draft.choices.font)?.blurb}</p>
        </div>
        <div>
          <label className="label" htmlFor="theme">Colour of the words</label>
          <select id="theme" className="field" value={draft.choices.theme} onChange={(e) => setChoice({ theme: e.target.value as any })}>
            {THEME_CHOICES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </div>
        <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-sm2 border-2 border-line-control px-4 hover:border-ink">
          <input type="checkbox" className="h-5 w-5 accent-ink" checked={draft.choices.style === 'panels'} onChange={(e) => setChoice({ style: e.target.checked ? 'panels' : 'clean' })} />
          <span><span className="font-bold">Put words on a solid panel</span><span className="block text-[13px] text-muted">Easiest to read over a busy pattern.</span></span>
        </label>
        {photo && (
          <div>
            <label className="label" htmlFor="shape">Shape of your photo</label>
            <select id="shape" className="field" value={draft.choices.photoShape} onChange={(e) => setChoice({ photoShape: e.target.value as any })}>
              {SHAPE_CHOICES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
        )}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2" disabled={locked}>
        <legend className="mb-2 text-[20px] font-bold">Your pictures <span className="text-[15px] font-normal text-muted">(optional)</span></legend>
        <Upload id={v.id} kind="photo" label="Photo" help="A person, a couple, a building. Placed exactly as it is. We never redraw it." asset={photo} onDone={onAssetsChanged} disabled={locked} />
        <Upload id={v.id} kind="logo" label="Logo" help="Placed exactly as you give it. Use the biggest, clearest copy you have." asset={logo} onDone={onAssetsChanged} disabled={locked} />
        {!isId && (
          <div className="sm:col-span-2">
            <label className="label" htmlFor="qr">QR code link (optional)</label>
            <input id="qr" className="field" inputMode="url" placeholder="https://instagram.com/yourbrand" value={draft.qrUrl} onChange={(e) => set({ qrUrl: e.target.value })} maxLength={300} />
            <p className="mt-1 text-[13px] text-muted">Studio draws a scannable QR code for this link and keeps it sharp. It must start with https://.</p>
          </div>
        )}
      </fieldset>

      <div className="rounded-md2 border-2 border-line-control p-4">
        <label className={`flex items-start gap-3 ${v.consent ? '' : 'cursor-pointer'}`}>
          <input type="checkbox" className="mt-1 h-5 w-5 accent-ink" checked={v.consent} disabled={v.consent || locked} onChange={onConsent} />
          <span className="text-[15px]">
            <span className="font-bold">I understand how my design is made.</span> Only my description of the look (the feel, style and colours) is sent to picture-making companies, some outside Nigeria. My names, dates, phone numbers and photos stay with Brandit and are never sent. Brandit may keep my design for {v.keepDays} days. <a className="link" href="/legal/ai-designs" target="_blank" rel="noopener noreferrer">Read more</a>.
          </span>
        </label>
      </div>
    </div>
  );
}

function Upload({ id, kind, label, help, asset, onDone, disabled }: { id: string; kind: 'photo' | 'logo'; label: string; help: string; asset: ProjectView['assets'][number] | null; onDone: () => void; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function send(file: File | undefined) {
    if (!file) return;
    setBusy(true); setErr(null);
    const fd = new FormData();
    fd.append('file', file); fd.append('kind', kind);
    try {
      const res = await fetch(`/api/studio/projects/${id}/assets`, { method: 'POST', body: fd });
      const j = await res.json().catch(() => null);
      if (!j?.ok) setErr(j?.error ?? 'Something went wrong. Please try again.'); else onDone();
    } catch { setErr('The upload was interrupted. Check your connection and try again.'); }
    setBusy(false);
    if (input.current) input.current.value = '';
  }
  async function remove() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/studio/projects/${id}/assets`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }) });
      const j = await res.json().catch(() => null);
      if (!j?.ok) setErr(j?.error ?? 'We could not remove that.'); else onDone();
    } catch { setErr('Check your connection and try again.'); }
    setBusy(false);
  }
  return (
    <div className="grid content-start gap-2 rounded-md2 border border-line p-3">
      <p className="font-bold">{label}</p>
      {asset ? (
        <div className="flex items-center gap-3">
          <img src={asset.url} alt={`Your ${label.toLowerCase()}`} className="h-20 w-20 rounded-sm2 border border-line bg-paper2 object-contain" />
          <div className="min-w-0 text-[14px]"><p className="truncate font-bold">{asset.title || label}</p><p className="text-muted">{asset.w} × {asset.h} pixels</p></div>
          <button type="button" className="btn-secondary btn-sm ml-auto" onClick={remove} disabled={busy || disabled}>Remove</button>
        </div>
      ) : (
        <button type="button" className="btn-secondary btn-sm w-fit" onClick={() => input.current?.click()} disabled={busy || disabled}>{busy ? <><Spinner className="h-4 w-4" /> Uploading…</> : `Add a ${label.toLowerCase()}`}</button>
      )}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label={`Choose a ${label.toLowerCase()}`} onChange={(e) => send(e.target.files?.[0])} />
      <p className="text-[13px] text-muted">{help}</p>
      {err && <Toast tone="bad">{err}</Toast>}
    </div>
  );
}

/** Proves the customer's phone number once, so free sketches are counted per person and not per email address. */
export function PhoneVerify({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [demo, setDemo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function send() {
    setBusy(true); setErr(null);
    const res = await fetch('/api/studio/phone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) }).then((r) => r.json()).catch(() => null);
    if (res?.done) onDone(); else if (res?.sent) { setSent(true); setDemo(res.demoCode ?? null); } else setErr(res?.error ?? 'Something went wrong. Try again.');
    setBusy(false);
  }
  async function check() {
    setBusy(true); setErr(null);
    const res = await fetch('/api/studio/phone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code }) }).then((r) => r.json()).catch(() => null);
    if (res?.done) onDone(); else setErr(res?.error ?? 'Something went wrong. Try again.');
    setBusy(false);
  }
  return (
    <div className="grid gap-3 rounded-md2 border-2 border-line-control p-4">
      <p className="font-bold">Verify your phone number to get free sketches</p>
      <p className="text-[14px] text-muted">We send a code by SMS. This keeps the free sketches fair, and it is how we message you when your designs are ready.</p>
      {!sent ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="grow"><label className="label" htmlFor="sp">Nigerian mobile number</label><input id="sp" className="field" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <button type="button" className="btn-secondary" onClick={send} disabled={busy || phone.trim().length < 10}>{busy ? 'Sending…' : 'Send code'}</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="grow"><label className="label" htmlFor="sc">6-digit code</label><input id="sc" className="field tabular" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
          <button type="button" className="btn-primary" onClick={check} disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify'}</button>
        </div>
      )}
      {demo && <Toast tone="warn">Demo mode: your code is <strong className="tabular">{demo}</strong>. On the live site it arrives by SMS.</Toast>}
      {err && <Toast tone="bad">{err}</Toast>}
    </div>
  );
}

export { act };
