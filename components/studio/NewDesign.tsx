'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Notice } from '@/components/Bits';

type P = { slug: string; name: string; mode: string; sizes: { key: string; label: string }[]; staffOnly: boolean };
type O = { id: string; label: string; blurb: string; products: string[] };

export function NewDesign({ products, occasions, initialOccasion, initialProduct, orderId }: { products: P[]; occasions: O[]; initialOccasion: string | null; initialProduct: string | null; orderId: string | null }) {
  const router = useRouter();
  const occ0 = occasions.find((o) => o.id === initialOccasion)?.id ?? '';
  const [occasion, setOccasion] = useState(occ0);
  const first = (o: string) => occasions.find((x) => x.id === o)?.products.find((slug) => products.some((p) => p.slug === slug)) ?? '';
  const [slug, setSlug] = useState(products.some((p) => p.slug === initialProduct) ? initialProduct! : occ0 ? first(occ0) : '');
  const prod = products.find((p) => p.slug === slug) ?? null;
  const [sizeKey, setSizeKey] = useState('');
  const [w, setW] = useState('4');
  const [h, setH] = useState('3');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isStaff = occasion === 'staff_id';
  const list = useMemo(() => products.filter((p) => (isStaff ? p.slug === 'id-cards' : !p.staffOnly)), [products, isStaff]);
  const suggested = occasions.find((o) => o.id === occasion)?.products ?? [];

  function pickOccasion(id: string) {
    setOccasion(id);
    if (id === 'staff_id') setSlug('id-cards');
    else if (!prod || prod.staffOnly || !suggested.includes(prod.slug)) setSlug(first(id) || slug);
  }

  async function go() {
    setErr(null);
    if (!occasion) return setErr('Choose what this is for.');
    if (!prod) return setErr('Choose what you are printing.');
    setBusy(true);
    try {
      const res = await fetch('/api/studio/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productSlug: prod.slug, sizeKey: sizeKey || prod.sizes[0]?.key || null, widthFt: prod.mode === 'area' ? Number(w) : null, heightFt: prod.mode === 'area' ? Number(h) : null, occasion, orderId }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) { router.push(`/signin?next=${encodeURIComponent('/studio/new')}`); return; }
      if (j.next) { router.push(j.next); return; }
      setErr(j.error ?? 'Something went wrong. Try again.');
    } catch { setErr('Check your connection and try again.'); }
    setBusy(false);
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); go(); }} className="grid gap-6">
      <fieldset className="card grid gap-3 p-5 sm:p-6">
        <legend className="text-[20px] font-bold">1. What is it for?</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Occasion">
          {occasions.map((o) => (
            <label key={o.id} className={`cursor-pointer rounded-md2 border-2 p-3 ${occasion === o.id ? 'border-ink bg-paper2' : 'border-line-control hover:border-ink'}`}>
              <input type="radio" name="occasion" value={o.id} checked={occasion === o.id} onChange={() => pickOccasion(o.id)} className="sr-only" />
              <span className="block font-bold leading-tight">{o.label}</span>
              <span className="mt-0.5 block text-[13px] text-muted">{o.blurb}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="card grid gap-3 p-5 sm:p-6">
        <legend className="text-[20px] font-bold">2. What are you printing?</legend>
        {isStaff && <Notice>Staff ID cards in Studio are for your own company&apos;s staff. They cannot look like a government or school ID.</Notice>}
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Product">
          {list.map((p) => (
            <label key={p.slug} className={`inline-flex min-h-[44px] cursor-pointer items-center rounded-full border-2 px-4 font-bold ${slug === p.slug ? 'border-ink bg-ink text-white' : 'border-line-control bg-surface hover:border-ink'}`}>
              <input type="radio" name="product" value={p.slug} checked={slug === p.slug} onChange={() => { setSlug(p.slug); setSizeKey(''); }} className="sr-only" />
              {p.name}{suggested.includes(p.slug) && slug !== p.slug ? <span className="ml-2 text-[12px] font-bold text-muted">suggested</span> : null}
            </label>
          ))}
        </div>
        {prod && prod.mode === 'size' && prod.sizes.length > 1 && (
          <div>
            <label className="label" htmlFor="size">Size</label>
            <select id="size" className="field" value={sizeKey || prod.sizes[0].key} onChange={(e) => setSizeKey(e.target.value)}>
              {prod.sizes.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
        )}
        {prod && prod.mode === 'area' && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="w">Width (feet)</label><input id="w" className="field" inputMode="decimal" value={w} onChange={(e) => setW(e.target.value)} /></div>
            <div><label className="label" htmlFor="h">Height (feet)</label><input id="h" className="field" inputMode="decimal" value={h} onChange={(e) => setH(e.target.value)} /></div>
          </div>
        )}
      </fieldset>

      {err && <Notice tone="bad">{err}</Notice>}
      <button className="btn-primary self-start" disabled={busy}>{busy ? 'One moment…' : 'Next: type your words'}</button>
    </form>
  );
}
