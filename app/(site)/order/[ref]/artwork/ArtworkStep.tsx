'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Notice } from '@/components/Bits';
import { naira } from '@/lib/money';
import { CropMarks } from '@/components/Brand';
import { useT } from '@/components/LangProvider';
import { BleedFix } from '@/components/BleedFix';

type Line = { id: string; status: 'pass' | 'warn' | 'stop'; label: string; message: string; action?: string };
type Outcome = { ok: true; fileId: string; check: { status: 'pass' | 'warn' | 'stop'; dpi: number | null; lines: Line[]; headline: string }; widthPx: number | null; heightPx: number | null; suggestion: { key: string; label: string } | null; attached: boolean } | { ok: false; error: string };

type Props = {
  orderId: string;
  itemId: string;
  productName: string;
  isFrame: boolean;
  currentSizeLabel: string | null;
  printW: number | null;
  printH: number | null;
  designFeeKobo: number;
  fixFeeKobo: number;
  fixMode: boolean;
  maxUploadMb: number;
  flaggedReason: string | null;
  startPath: 'upload' | 'design';
  /** Set when Brandit Studio is open to this customer. */
  studio?: { href: string; fromKobo: number } | null;
  kit: { name: string | null; assets: { id: string; title: string; kind: string; pdf: boolean; thumb: boolean }[] } | null;
};

export function ArtworkStep(p: Props) {
  const router = useRouter();
  const tr = useT();
  const [path, setPath] = useState<'upload' | 'design'>(p.startPath);
  const [pct, setPct] = useState<number | null>(null);
  const [out, setOut] = useState<Outcome | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string; pdf: boolean } | null>(null);
  const [beforeId, setBeforeId] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Design brief
  const [brief, setBrief] = useState({ purpose: '', wording: '', colours: '', examples: '', logo_note: '' });
  const [refIds, setRefIds] = useState<string[]>([]);
  const [refName, setRefName] = useState<string | null>(null);
  const [useKit, setUseKit] = useState(true);

  function send(file: File, asReference = false) {
    return new Promise<any>((resolve) => {
      const fd = new FormData();
      fd.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/orders/${p.orderId}/upload?item=${p.itemId}${asReference ? '&as=reference' : ''}`);
      xhr.upload.onprogress = (e) => e.lengthComputable && setPct(Math.round((e.loaded / e.total) * 100));
      xhr.onload = () => {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { resolve({ ok: false, error: xhr.status === 413 ? `This file is larger than ${p.maxUploadMb} MB. Export a smaller copy and upload that.` : 'Something went wrong. Please try again.' }); }
      };
      xhr.onerror = () => resolve({ ok: false, error: 'The upload was interrupted. Check your connection and try again.' });
      xhr.send(fd);
    });
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setErr(null); setOut(null); setAgree(false); setPct(0); setBeforeId(null);
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview({ url: URL.createObjectURL(file), name: file.name, pdf: file.type === 'application/pdf' });
    // Say so at once instead of sending a file the site is going to refuse.
    if (file.size > p.maxUploadMb * 1_000_000) { setPct(null); setOut({ ok: false, error: `This file is larger than ${p.maxUploadMb} MB. Export a smaller copy and upload that.` } as Outcome); return; }
    const r: Outcome = await send(file);
    setPct(null);
    setOut(r);
  }

  async function fromKit(a: { id: string; title: string; pdf: boolean }) {
    setErr(null); setOut(null); setAgree(false); setPct(0);
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview({ url: `/api/brand-assets/${a.id}`, name: a.title, pdf: a.pdf });
    const res = await fetch(`/api/orders/${p.orderId}/kit-asset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId: a.id, itemId: p.itemId }) });
    const r: Outcome = await res.json().catch(() => ({ ok: false, error: 'Something went wrong. Please try again.' }));
    setPct(null);
    setOut(r);
  }

  async function onReference(file: File | undefined) {
    if (!file) return;
    setPct(0);
    const r = await send(file, true);
    setPct(null);
    if (r.ok) { setRefIds((x) => [...x, r.fileId]); setRefName(file.name); } else setErr(r.error);
  }

  async function approve() {
    setBusy(true); setErr(null);
    const res = await fetch(`/api/orders/${p.orderId}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: p.itemId }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.error ?? 'Something went wrong.'); setBusy(false); return; }
    router.push(j.next);
  }

  async function submitBrief(fix = false) {
    setBusy(true); setErr(null);
    const body = fix
      ? { purpose: 'Fix my file', wording: 'Please fix the file I uploaded so it prints sharp. Keep the design as it is.', fix: true, reference_file_ids: out && out.ok ? [out.fileId] : [], itemId: p.itemId }
      : { ...brief, reference_file_ids: refIds, use_kit: !!p.kit && useKit, itemId: p.itemId };
    const res = await fetch(`/api/orders/${p.orderId}/artwork-path`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.error ?? 'Something went wrong.'); setBusy(false); return; }
    router.push(j.next);
  }

  const status = out && out.ok ? out.check.status : null;
  const portrait = (p.printH ?? 1) > (p.printW ?? 1);
  const ratio = p.printW && p.printH ? p.printW / p.printH : 1.5;
  const tone = status === 'pass' ? 'bg-good-tint' : status === 'warn' ? 'bg-warn-tint' : 'bg-bad-tint';

  return (
    <div className="mx-auto max-w-[760px] px-5 pb-12 grid gap-6">
      {p.fixMode && p.flaggedReason && (
        <Notice tone="warn"><p className="font-bold">{tr('We need a new file for this order.')}</p><p>{p.flaggedReason} Your delivery clock is paused until we have a file we can print.</p></Notice>
      )}

      {!p.fixMode && (
        <div className={`grid gap-3 ${p.studio ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`} role="group" aria-label={tr('How do you want to give us the artwork?')}>
          <button type="button" aria-pressed={path === 'upload'} onClick={() => setPath('upload')} className={`card p-5 text-left grid gap-1 border-2 ${path === 'upload' ? 'border-ink bg-ink text-white' : 'hover:border-ink'}`}>
            <span className="font-bold text-[19px]">{tr('I have a file')}</span>
            <span className={`text-[15px] ${path === 'upload' ? 'text-on-ink-muted' : 'text-muted'}`}>{tr('We check it in seconds and show you what will print.')}</span>
          </button>
          <button type="button" aria-pressed={path === 'design'} onClick={() => setPath('design')} className={`card p-5 text-left grid gap-1 border-2 ${path === 'design' ? 'border-ink bg-ink text-white' : 'hover:border-ink'}`}>
            <span className="font-bold text-[19px]">{tr('Design it for me')}</span>
            <span className={`text-[15px] ${path === 'design' ? 'text-on-ink-muted' : 'text-muted'}`}>{tr('{amount} flat fee. A proof in about a working day, with two rounds of changes.', { amount: naira(p.designFeeKobo) })}</span>
          </button>
          {p.studio && (
            <a href={p.studio.href} className="card grid gap-1 border-2 border-accent bg-accent/20 p-5 text-left hover:border-ink">
              <span className="text-[19px] font-bold">{tr('Make it with Brandit Studio')}</span>
              <span className="text-[15px] text-muted">{tr('See free sketches with your own words, then pay from {amount} and get a print-ready design in minutes.', { amount: naira(p.studio.fromKobo) })}</span>
            </a>
          )}
        </div>
      )}

      {path === 'upload' && (
        <section className="card p-5 grid gap-5" aria-labelledby="up">
          <div>
            <h2 id="up" className="text-[22px]">{tr('Upload your file')}</h2>
            <p className="text-[14px] text-muted mt-1">PDF, JPG or PNG, up to {p.maxUploadMb} MB. Printing {p.productName.toLowerCase()}{p.currentSizeLabel ? ` at ${p.currentSizeLabel}` : ''}.</p>
          </div>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
            className="rounded-md2 border-2 border-dashed border-line-control bg-paper p-8 grid place-items-center gap-3 text-center"
          >
            <input ref={input} id="file" type="file" aria-label="Choose your artwork file" className="sr-only" accept="image/jpeg,image/png,application/pdf" onChange={(e) => onFile(e.target.files?.[0])} />
            <label htmlFor="file" className="btn-primary cursor-pointer">{preview ? tr('Choose a different file') : tr('Choose a file')}</label>
            <p className="text-[14px] text-muted">{tr('or drop it here')}</p>
            {pct != null && (
              <div className="w-full max-w-[320px]" role="status" aria-live="polite">
                <div className="h-2 rounded-full bg-line overflow-hidden"><div className="h-full bg-ink transition-[width]" style={{ width: `${pct}%` }} /></div>
                <p className="text-[14px] mt-1.5">{pct < 100 ? tr('Uploading… {pct}%', { pct }) : tr('Checking your file…')}</p>
              </div>
            )}
          </div>

          {p.kit && p.kit.assets.length > 0 && (
            <div className="grid gap-2 rounded-md2 bg-paper2 p-4">
              <p className="font-bold">{tr('Or use a file from your brand kit')}</p>
              <ul className="flex gap-3 overflow-x-auto pb-1">
                {p.kit.assets.map((a) => (
                  <li key={a.id} className="shrink-0">
                    <button type="button" onClick={() => fromKit(a)} className="grid w-[104px] gap-1 text-left" aria-label={`Use ${a.title}`}>
                      <span className="grid h-[84px] w-[104px] place-items-center overflow-hidden rounded-sm2 border border-line bg-white">
                        {a.thumb
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={`/api/brand-assets/${a.id}?size=thumb`} alt="" className="h-full w-full object-contain" />
                          : <span className="px-2 text-center text-[12px] font-bold">PDF</span>}
                      </span>
                      <span className="line-clamp-2 text-[13px] font-bold leading-tight">{a.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {out && !out.ok && <Notice tone="bad">{out.error}</Notice>}

          {out && out.ok && (
            <div className="grid gap-5">
              <div className={`rounded-md2 p-4 grid gap-3 ${tone}`} role="status">
                <p className="font-bold text-[18px] flex items-start gap-2">
                  <span className={`mt-0.5 shrink-0 ${status === 'pass' ? 'text-good' : status === 'warn' ? 'text-warn' : 'text-bad'}`}>
                    {status === 'pass' ? <Check className="h-5 w-5" /> : <span aria-hidden className="font-display text-[20px] leading-none">!</span>}
                  </span>
                  {out.check.headline}
                </p>
                <ul className="grid gap-1.5 text-[15px]">
                  {out.check.lines.filter((l) => l.status !== 'pass' || l.id === 'resolution' || l.id === 'shape' || l.id === 'bleed').map((l) => (
                    <li key={l.id}><span className="font-bold">{l.label}: </span>{l.message}</li>
                  ))}
                </ul>
              </div>

              {status !== 'stop' && (
                <BleedFix
                  orderId={p.orderId} itemId={p.itemId} lines={out.check.lines} fileId={out.fileId} beforeFileId={beforeId} pdf={!!preview?.pdf} disabled={busy}
                  onResult={(r) => {
                    setAgree(false);
                    setBeforeId(r.beforeFileId);
                    setOut({ ...out, fileId: r.fileId, check: r.check as typeof out.check });
                    setPreview((v) => (v ? { ...v, url: `/api/files/${r.fileId}?o=${p.orderId}` } : v));
                  }}
                />
              )}

              {out.suggestion && p.isFrame && out.suggestion.label !== p.currentSizeLabel && (
                <Notice tone="neutral"><p className="font-bold">Tip for a sharper frame</p><p>This photo will print sharpest at {out.suggestion.label}. You chose {p.currentSizeLabel}. Go back to change the size if you would like.</p></Notice>
              )}

              {status === 'stop' ? (
                <div className="grid gap-3">
                  <p className="text-[15px]">{tr('Upload a larger or clearer file, or let us fix it for you.')}</p>
                  <div className="flex flex-wrap gap-3">
                    <label htmlFor="file" className="btn-secondary cursor-pointer">{tr('Upload a different file')}</label>
                    {!p.fixMode && <button type="button" className="btn-dark" disabled={busy} onClick={() => submitBrief(true)}>{tr('Fix it for me for {amount}', { amount: naira(p.fixFeeKobo) })}</button>}
                  </div>
                </div>
              ) : (
                <>
                  {preview && (
                    <figure className="grid gap-2 justify-items-center">
                      <div className="relative my-3 grid w-full max-w-[420px] place-items-center rounded-md2 bg-paper2 p-5">
                        <CropMarks />
                        {preview.pdf ? (
                          <div className="h-[220px] grid place-items-center text-center text-muted"><div><p className="font-bold text-ink break-all">{preview.name}</p><p className="text-[14px]">PDF. A person checks the pages before printing.</p></div></div>
                        ) : (
                          <div className="relative overflow-hidden bg-white shadow-[0_6px_0_rgba(11,31,51,0.18)]" style={{ aspectRatio: String(ratio), width: portrait ? '60%' : '100%', maxHeight: 360 }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={preview.url} alt={tr('Your artwork as it will print')} className="h-full w-full object-cover" />
                          </div>
                        )}
                      </div>
                      <figcaption className="text-[14px] text-muted text-center">{tr('This is your proof. It shows how your file fits the print area. Anything outside the frame is trimmed.')}</figcaption>
                    </figure>
                  )}
                  <label className="flex items-start gap-3 cursor-pointer min-h-[44px]">
                    <input type="checkbox" className="mt-1 h-5 w-5 accent-[#0B1F33]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                    <span className="text-[16px]"><span className="font-bold">{tr('This is what will print.')}</span> {tr('I have checked the spelling, the phone numbers and the colours. We print exactly what you approve.')}</span>
                  </label>
                  <button type="button" className="btn-primary" disabled={!agree || busy} onClick={approve}>{busy ? tr('One moment…') : p.fixMode ? tr('Send this file to the file desk') : tr('Approve and continue to checkout')}</button>
                </>
              )}
            </div>
          )}
          {err && <Notice tone="bad">{err}</Notice>}
        </section>
      )}

      {path === 'design' && !p.fixMode && (
        <section className="card p-5 grid gap-5" aria-labelledby="brief">
          <div>
            <h2 id="brief" className="text-[22px]">{tr('Tell us what to make')}</h2>
            <p className="text-[14px] text-muted mt-1">{tr('Five quick questions. We send a proof, you approve it, and then it prints.')}</p>
          </div>
          <div><label className="label" htmlFor="b1">{tr('What is it for?')}</label><input id="b1" className="field" placeholder="For example: opening day of my salon" value={brief.purpose} onChange={(e) => setBrief({ ...brief, purpose: e.target.value })} /></div>
          <div><label className="label" htmlFor="b2">{tr('The exact words to use')}</label><textarea id="b2" className="field !py-3 min-h-[110px]" placeholder="Names, phone numbers, address, offers. We copy these exactly." value={brief.wording} onChange={(e) => setBrief({ ...brief, wording: e.target.value })} /></div>
          <div>
            <p className="label">{tr('Your logo')}</p>
            <input id="logo" type="file" aria-label="Choose a logo or reference picture" className="sr-only" accept="image/jpeg,image/png,application/pdf" onChange={(e) => onReference(e.target.files?.[0])} />
            <div className="flex flex-wrap items-center gap-3"><label htmlFor="logo" className="btn-secondary btn-sm cursor-pointer">{tr('Upload a logo')}</label><span className="text-[14px] text-muted">{refName ? tr('Added: {name}', { name: refName }) : tr('Or tell us below where to find it.')}</span></div>
          </div>
          <div><label className="label" htmlFor="b4">{tr('Colours you like')}</label><input id="b4" className="field" placeholder="For example: navy and gold" value={brief.colours} onChange={(e) => setBrief({ ...brief, colours: e.target.value })} /></div>
          <div><label className="label" htmlFor="b5">{tr('Anything we should look at?')}</label><input id="b5" className="field" placeholder="A link to a design you like, or where we can find your logo" value={brief.examples} onChange={(e) => setBrief({ ...brief, examples: e.target.value })} /></div>
          {p.kit && (
            <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md2 bg-paper2 p-4">
              <input type="checkbox" className="mt-1 h-5 w-5 accent-[#0B1F33]" checked={useKit} onChange={(e) => setUseKit(e.target.checked)} />
              <span><span className="block font-bold">{tr('Use my brand kit')}{p.kit.name ? ` (${p.kit.name})` : ''}</span><span className="block text-[14px] text-muted">{tr('Your logo, colours, fonts and contact line go to the designer, so you do not have to repeat them.')}</span></span>
            </label>
          )}
          <Notice tone="neutral">{tr('Design fee')} <span className="font-bold">{naira(p.designFeeKobo)}</span>. {tr('It is added at checkout. Your delivery time is set when you approve the proof, so a 24-hour order runs from that moment.')}</Notice>
          {err && <Notice tone="bad">{err}</Notice>}
          <button type="button" className="btn-primary" disabled={busy || !brief.purpose.trim() || !brief.wording.trim()} onClick={() => submitBrief(false)}>{busy ? tr('One moment…') : tr('Continue to checkout')}</button>
        </section>
      )}
    </div>
  );
}
