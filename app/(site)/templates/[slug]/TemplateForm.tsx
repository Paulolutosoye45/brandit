'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { naira } from '@/lib/money';
import { Notice } from '@/components/Bits';
import { useT } from '@/components/LangProvider';
import type { TemplateField } from '@/lib/templateCore';

type Props = {
  slug: string; productSlug: string; fields: TemplateField[]; quantities: number[]; defaultQuantity: number;
  quote: { slug: string; config: Record<string, string>; sizeKey?: string; widthFt?: number; heightFt?: number };
  initialPrintKobo: number | null; designKobo: number; hasKit: boolean; signedIn: boolean; unit: string;
};

export function TemplateForm({ slug, fields, quantities, defaultQuantity, quote, initialPrintKobo, designKobo, hasKit, signedIn, unit }: Props) {
  const tr = useT();
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(defaultQuantity);
  const [colours, setColours] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [print, setPrint] = useState<number | null>(initialPrintKobo);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ message: string; field?: string } | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (qty === defaultQuantity && initialPrintKobo != null) { setPrint(initialPrintKobo); return; }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const r = await fetch('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...quote, quantity: qty }) }).then((x) => x.json()).catch(() => null);
      if (mine === seq.current) setPrint(r?.ok ? r.priceKobo : null);
    }, 150);
    return () => clearTimeout(t);
  }, [qty, quote, defaultQuantity, initialPrintKobo]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const fd = new FormData();
    fd.set('answers', JSON.stringify(answers));
    fd.set('quantity', String(qty));
    fd.set('colours', colours);
    for (const f of files) fd.append('files', f);
    const res = await fetch(`/api/templates/${slug}/start`, { method: 'POST', body: fd });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.orderId) { router.push(`/checkout/${j.orderId}`); return; }
    setErr({ message: j.error ?? 'Something went wrong. Please try again.', field: j.field });
    setBusy(false);
    if (j.field) document.getElementById(`f-${j.field}`)?.focus();
  }

  const total = print != null ? print + designKobo : null;
  const bad = (k: string) => err?.field === k;

  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      <section className="card grid gap-4 p-5" aria-labelledby="qs">
        <div><h2 id="qs" className="text-[22px]">{tr('Tell us the details')}</h2><p className="text-[14px] text-muted">{tr('We copy these exactly. Skip anything that does not apply.')}</p></div>
        {fields.map((f) => (
          <div key={f.key}>
            <label className="label" htmlFor={`f-${f.key}`}>{f.label}{f.required ? '' : <span className="font-normal"> {tr('(optional)')}</span>}</label>
            {f.kind === 'long' ? (
              <textarea id={`f-${f.key}`} className="field !py-3 min-h-[110px]" value={answers[f.key] ?? ''} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })} aria-invalid={bad(f.key)} maxLength={900} />
            ) : (
              <input id={`f-${f.key}`} className="field" type={f.kind === 'date' ? 'date' : 'text'} value={answers[f.key] ?? ''} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })} aria-invalid={bad(f.key)} maxLength={120} />
            )}
            {f.hint && <p className="mt-1 text-[13px] text-muted">{f.hint}</p>}
          </div>
        ))}
        <div>
          <label className="label" htmlFor="f-colours">{tr('Colours you like')} <span className="font-normal">{tr('(optional)')}</span></label>
          <input id="f-colours" className="field" value={colours} onChange={(e) => setColours(e.target.value)} placeholder={hasKit ? tr('Leave empty to use your brand kit colours') : tr('For example: navy and gold')} maxLength={120} />
        </div>
        <div>
          <label className="label" htmlFor="f-files">{tr('Photo or logo')} <span className="font-normal">{tr('(optional, up to 3)')}</span></label>
          <input id="f-files" type="file" accept="image/jpeg,image/png,application/pdf" multiple className="field !py-2.5" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))} />
          {files.length > 0 && <p className="mt-1 text-[13px] text-muted">{files.map((f) => f.name).join(', ')}</p>}
        </div>
        {hasKit && <Notice tone="good">{tr('Your brand kit comes with this order: your logo files, colours and fonts go to the designer.')}</Notice>}
        {!hasKit && signedIn && <p className="text-[14px] text-muted">Tip: save your logo and colours once in your <Link href="/account/brand" className="link">brand kit</Link> and every order starts with them.</p>}
      </section>

      {quantities.length > 1 && (
        <section className="card grid gap-3 p-5" aria-labelledby="qty">
          <h2 id="qty" className="text-[22px]">{tr('How many?')}</h2>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quantity">
            {quantities.map((q) => <button key={q} type="button" className="choice" aria-pressed={qty === q} onClick={() => setQty(q)}>{q.toLocaleString('en-US')}{unit === 'banner' ? '' : ''}</button>)}
          </div>
        </section>
      )}

      <section className="card grid gap-3 p-5 lg:shadow-press" aria-label="Price">
        <dl className="grid gap-2 text-[16px] tabular">
          <div className="flex justify-between gap-3"><dt>{tr('Print')}{quantities.length > 1 ? ` (${qty.toLocaleString('en-US')})` : ''}</dt><dd>{print != null ? naira(print) : '—'}</dd></div>
          <div className="flex justify-between gap-3"><dt>{tr('Design by our team')}</dt><dd>{naira(designKobo)}</dd></div>
          <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3"><dt className="font-bold">{tr('Before delivery')}</dt><dd className="font-display text-[30px] font-extrabold leading-none">{total != null ? naira(total) : tr('Ask us')}</dd></div>
        </dl>
        <p className="text-[13px] text-muted">{tr('VAT is included. Delivery is added at checkout when you choose your area. You see a proof and approve it before anything prints, with two rounds of changes included.')}</p>
        {err && <div aria-live="polite"><Notice tone="bad">{err.message}</Notice></div>}
        <button type="submit" className="btn-primary hidden w-full lg:inline-flex" disabled={busy || print == null}>{busy ? tr('One moment…') : tr('Continue to checkout')}</button>
      </section>

      <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-[560px] items-center gap-3">
          <div className="min-w-0 flex-1"><p className="text-[12px] font-bold leading-none text-muted">{tr('Before delivery')}</p><p className="font-display text-[24px] font-extrabold leading-tight tabular">{total != null ? naira(total) : '—'}</p></div>
          <button type="submit" className="btn-primary shrink-0 !px-6" disabled={busy || print == null}>{busy ? tr('One moment…') : tr('Continue')}</button>
        </div>
      </div>
    </form>
  );
}
