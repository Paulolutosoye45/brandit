'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { announceBasket } from '@/components/builder/basketBus';

/*
 * The sample pack has nothing to choose and no artwork: one button puts it in the basket.
 * The delivery area and the payment are the same as for any other order.
 */
export function SamplePackCard({ slug, price, preview }: { slug: string; price: string | null; preview?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/basket/lines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, quantity: 1, config: {}, startedFrom: 'product' }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? 'Something went wrong. Please try again.'); setBusy(false); return; }
      if (typeof j.view?.count === 'number') announceBasket(j.view.count);
      router.push('/basket');
    } catch {
      setErr('We could not reach Brandit. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-[1160px] px-5 pb-6" aria-label="Order the sample pack">
      <div className="card grid gap-4 border-2 border-accent p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[24px]">Try our work before you order</h2>
          {price && <p className="font-display text-[30px] font-extrabold leading-none tabular">{price}</p>}
        </div>
        <ol className="grid gap-2 text-[17px]">
          <li className="flex gap-3"><span className="font-extrabold">1.</span>We send you a small box of real Brandit prints.</li>
          <li className="flex gap-3"><span className="font-extrabold">2.</span>When it leaves us, we send you a code for the same amount.</li>
          <li className="flex gap-3"><span className="font-extrabold">3.</span>Use the code on your first order. The sample pack costs you nothing in the end.</li>
        </ol>
        {err && <p role="alert" className="rounded-md2 bg-bad-tint px-4 py-3 font-bold text-bad">{err}</p>}
        {preview ? <p className="rounded-md2 bg-warn-tint px-4 py-3 text-[15px]">Staff preview. Orders cannot be placed from here.</p> : (
          <button type="button" className="btn-primary self-start" onClick={add} disabled={busy}>{busy ? 'Adding…' : 'Add the sample pack to my basket'}</button>
        )}
        <p className="text-[14px] text-muted">No artwork to upload. Delivery is charged the same as any order, and you see it before you pay.</p>
      </div>
    </section>
  );
}
