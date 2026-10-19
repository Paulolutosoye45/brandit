'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { naira } from '@/lib/money';
import { ProductVisual } from '@/components/ProductVisual';
import { announceBasket } from '@/components/builder/basketBus';
import { proofLabel } from '@/lib/lines';
import type { LineView } from '@/lib/basket';
import { NamesPanel } from './NamesPanel';

type Line = LineView & { cover: string | null };

/** The products in the basket, each with what the customer chose, where its artwork stands, and ways to change or remove it. */
export function BasketLines({ orderId, lines }: { orderId: string; lines: Line[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function remove(l: Line) {
    setBusy(l.id); setErr(null);
    const res = await fetch(`/api/basket/lines/${l.id}`, { method: 'DELETE' });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setErr(j.error ?? 'Something went wrong. Please try again.'); return; }
    announceBasket(j.left ?? 0);
    router.refresh();
  }

  return (
    <div className="grid gap-4" data-order={orderId}>
      {err && <p role="alert" className="rounded-md2 bg-bad-tint px-4 py-3 font-bold text-bad">{err}</p>}
      <ul className="grid gap-4">
        {lines.map((l) => {
          const edit = `/products/${l.slug}?line=${l.id}`;
          return (
            <li key={l.id} className="card grid grid-cols-[88px_1fr] gap-x-4 gap-y-3 p-4 sm:grid-cols-[120px_1fr_auto] sm:items-start sm:p-5" data-line={l.id}>
              <div className="aspect-square w-[88px] overflow-hidden rounded-md2 bg-paper2 sm:aspect-[4/3] sm:w-[120px]"><ProductVisual cover={l.cover} alt="" slug={l.slug} name={l.name} className="h-full w-full" /></div>
              <div className="grid min-w-0 gap-1.5">
                <p className="text-[20px] font-bold leading-tight">{l.name}</p>
                <p className="text-[16px] text-muted">{l.quantity.toLocaleString('en-US')}{l.sizeLabel ? ` · ${l.sizeLabel}` : ''}</p>
                {l.choices.length > 0 && <p className="text-[14px] text-muted">{l.choices.join(' · ')}</p>}
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[14px]">
                  <span className={`pill ${l.ready ? 'bg-good-tint text-good' : 'bg-warn-tint text-warn'}`}>{l.ready ? proofLabel(l.proof) : l.artworkPath === 'studio' ? 'Choose your Studio design' : proofLabel('needs_file')}</span>
                  {l.artworkName && <span className="truncate text-muted">{l.artworkName}</span>}
                  {l.checkStatus === 'warn' && <span className="text-warn">{l.checkHeadline}</span>}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-[15px]">
                  {l.proof !== 'sample' && <Link href={edit} className={l.ready ? 'link font-bold' : 'btn-primary btn-sm'}>{l.ready ? 'Change' : l.artworkPath === 'studio' ? 'Choose your design' : l.proof === 'checked' ? 'Check and approve' : 'Add your file'}</Link>}
                  <button type="button" className="link font-bold text-bad" disabled={busy === l.id} onClick={() => remove(l)} aria-label={`Remove ${l.name}`}>{busy === l.id ? 'Removing…' : 'Remove'}</button>
                </div>
              </div>
              <div className="col-span-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line pt-3 sm:col-span-1 sm:block sm:border-0 sm:pt-0 sm:text-right">
                <p className="font-display text-[26px] font-extrabold leading-none tabular">{naira(l.priceKobo + l.designKobo)}</p>
                {l.designKobo > 0 && <p className="text-[13px] text-muted sm:mt-1">includes {naira(l.designKobo)} design fee</p>}
              </div>
              {l.personalise && <NamesPanel itemId={l.id} productName={l.name} names={l.names} quantity={l.quantity} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
