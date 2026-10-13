'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Notice } from '@/components/Bits';
import { PhoneField } from '@/components/PhoneField';

type Props = {
  products: { slug: string; name: string }[];
  initialProduct: string;
  defaults: { name: string; phone: string; email: string };
  replyHours: number;
  whatsapp: string | null;
};
type Err = { message: string; field?: string };

const DRAFT = 'brandit.custom.draft';
const MAX_FILES = 5;
const todayYmd = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10); // Lagos is UTC+1

/** The request form. Everything but the photos is kept on this phone as you type, so a dropped connection costs nothing. */
export function CustomForm({ products, initialProduct, defaults, replyHours, whatsapp }: Props) {
  const router = useRouter();
  const [f, setF] = useState({
    product: products.some((p) => p.slug === initialProduct) ? initialProduct : '',
    title: '', details: '', quantity: '', size: '', budget: '', need_by: '',
    name: defaults.name, phone: defaults.phone, email: defaults.email, website: '',
  });
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState<Err | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT) ?? 'null');
      if (saved && typeof saved === 'object') setF((x) => ({ ...x, title: saved.title ?? x.title, details: saved.details ?? x.details, quantity: saved.quantity ?? x.quantity, size: saved.size ?? x.size, budget: saved.budget ?? x.budget, name: x.name || saved.name || '', phone: x.phone || saved.phone || '', email: x.email || saved.email || '' }));
    } catch { /* no saved draft */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(DRAFT, JSON.stringify({ title: f.title, details: f.details, quantity: f.quantity, size: f.size, budget: f.budget, name: f.name, phone: f.phone, email: f.email })); } catch { /* storage unavailable */ }
  }, [f.title, f.details, f.quantity, f.size, f.budget, f.name, f.phone, f.email]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const bad = (field: string) => err?.field === field;

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files, ...Array.from(list)].slice(0, MAX_FILES);
    setFiles(next);
    if (files.length + list.length > MAX_FILES) setErr({ message: `You can attach up to ${MAX_FILES} files. We kept the first ${MAX_FILES}.`, field: 'files' });
    if (pick.current) pick.current.value = '';
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    for (const [k, v] of Object.entries(f)) fd.append(k, v);
    files.forEach((x) => fd.append('files', x));
    try {
      const res = await fetch('/api/custom-requests', { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.token) {
        try { localStorage.removeItem(DRAFT); } catch { /* fine */ }
        router.push(j.token === 'thanks' ? '/' : `/custom-order/${j.token}?sent=1`);
        return;
      }
      setErr({ message: j.error ?? 'We could not send your request. Check your connection and try again.', field: j.field });
      if (j.field) document.getElementById(`c-${j.field}`)?.focus();
    } catch {
      setErr({ message: 'We could not send your request. Check your connection and try again. What you typed is still here.' });
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      <section className="card p-5 grid gap-4" aria-labelledby="c-what">
        <h2 id="c-what" className="text-[22px]">What do you need?</h2>
        {products.length > 0 && (
          <div>
            <label className="label" htmlFor="c-product">Is it like one of our products?</label>
            <select id="c-product" className="field" value={f.product} onChange={set('product')}>
              <option value="">Something else</option>
              {products.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
            </select>
          </div>
        )}
        <div><label className="label" htmlFor="c-title">In a few words</label><input id="c-title" className="field" maxLength={80} placeholder="Branded tote bags for our wedding" value={f.title} onChange={set('title')} aria-invalid={bad('title')} /></div>
        <div>
          <label className="label" htmlFor="c-details">Tell us more</label>
          <textarea id="c-details" className="field !py-3 min-h-[140px]" maxLength={2000} placeholder="What is it for? What colours? What paper or material? Anything we should know?" value={f.details} onChange={set('details')} aria-invalid={bad('details')} />
          <p className="mt-1 text-[13px] text-muted">The more you tell us, the closer our first price is.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="c-quantity">How many? <span className="font-normal">(optional)</span></label><input id="c-quantity" className="field" maxLength={80} placeholder="200 pieces" value={f.quantity} onChange={set('quantity')} /></div>
          <div><label className="label" htmlFor="c-size">Size <span className="font-normal">(optional)</span></label><input id="c-size" className="field" maxLength={80} placeholder="A5, or 40 × 30 cm" value={f.size} onChange={set('size')} /></div>
          <div><label className="label" htmlFor="c-budget">Your budget in ₦ <span className="font-normal">(optional)</span></label><input id="c-budget" className="field" inputMode="numeric" placeholder="150000" value={f.budget} onChange={(e) => setF((x) => ({ ...x, budget: e.target.value.replace(/[^\d]/g, '') }))} aria-invalid={bad('budget')} /></div>
          <div><label className="label" htmlFor="c-need_by">Needed by <span className="font-normal">(optional)</span></label><input id="c-need_by" type="date" className="field" min={todayYmd()} value={f.need_by} onChange={set('need_by')} aria-invalid={bad('need_by')} /></div>
        </div>
      </section>

      <section className="card p-5 grid gap-3" aria-labelledby="c-files">
        <h2 id="c-files" className="text-[22px]">Photos or examples <span className="text-[16px] font-normal text-muted">(optional)</span></h2>
        <p className="text-[15px] text-muted">A sketch, a logo, a picture of something similar. Up to {MAX_FILES} files, JPG, PNG, WebP or PDF.</p>
        <input ref={pick} id="c-file-input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple className="sr-only" onChange={(e) => addFiles(e.target.files)} />
        <div className="flex flex-wrap gap-2">
          <label htmlFor="c-file-input" className={`btn-secondary btn-sm cursor-pointer ${files.length >= MAX_FILES ? 'opacity-60 pointer-events-none' : ''}`}>{files.length ? 'Add another file' : 'Choose files'}</label>
        </div>
        {files.length > 0 && (
          <ul className="grid gap-2">
            {files.map((x, i) => (
              <li key={`${x.name}-${i}`} className="flex items-center justify-between gap-3 rounded-sm2 bg-paper2 px-3 py-2 min-h-[44px]">
                <span className="min-w-0 truncate text-[15px]">{x.name} <span className="text-muted">({(x.size / 1_000_000).toFixed(1)} MB)</span></span>
                <button type="button" className="btn-ghost btn-sm shrink-0" aria-label={`Remove ${x.name}`} onClick={() => setFiles((all) => all.filter((_, n) => n !== i))}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5 grid gap-4" aria-labelledby="c-you">
        <h2 id="c-you" className="text-[22px]">Where do we send your price?</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="c-name">Your name</label><input id="c-name" className="field" autoComplete="name" value={f.name} onChange={set('name')} aria-invalid={bad('name')} /></div>
          <div><label className="label" htmlFor="c-phone">WhatsApp number</label><PhoneField id="c-phone" value={f.phone} onChange={(v) => setF((x) => ({ ...x, phone: v }))} invalid={bad('phone')} /></div>
        </div>
        <div><label className="label" htmlFor="c-email">Email <span className="font-normal">(optional)</span></label><input id="c-email" type="email" className="field" autoComplete="email" value={f.email} onChange={set('email')} aria-invalid={bad('email')} /></div>
        {/* Real people never see this field. Bots fill it, and then nothing is saved. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label htmlFor="c-website">Website</label><input id="c-website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></div>
      </section>

      <div id="c-error" aria-live="polite">{err && <Notice tone="bad">{err.message}</Notice>}</div>
      <div className="grid gap-2 sm:max-w-[420px]">
        <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Send my request'}</button>
        <p className="text-[14px] text-muted">Free to ask. We reply within {replyHours} hours, and you pay nothing until you accept a price.</p>
        {whatsapp && <a className="link text-[15px]" href={`https://wa.me/${whatsapp}?text=${encodeURIComponent('Hi Brandit, I need something custom printed.')}`}>Prefer to chat? Message us on WhatsApp</a>}
      </div>
    </form>
  );
}
