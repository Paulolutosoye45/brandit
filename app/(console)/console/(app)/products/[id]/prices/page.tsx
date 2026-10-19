import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { getProductById } from '@/lib/catalog';
import { loadGrid, priceHistory } from '@/lib/priceAdmin';
import { Notice } from '@/components/Bits';
import { saveGridAction, confirmPlaceholdersAction, removeStrayAction } from '../../actions';
import { PriceGrid } from './PriceGrid';
import { TryPrice } from './TryPrice';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Price grid' };

const when = (d: string | Date) => new Date(d).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default async function PricesPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; ok?: string }> }) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireStaff('manage_catalog');
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const p = await getProductById(id);
  if (!p) notFound();
  const [grid, history] = await Promise.all([loadGrid(id), priceHistory({ productId: id, limit: 12 })]);
  const placeholders = Object.values(grid.cells).filter((c) => c.placeholder).length + Object.values(grid.area ?? {}).filter((c) => c.placeholder).length + p.options.reduce((n, o) => n + o.choices.filter((c) => c.provisional).length, 0);
  const waiting = p.options.reduce((n, o) => n + o.choices.filter((c) => c.unpriced).length, 0);

  return (
    <div className="grid max-w-[1100px] gap-6">
      <div>
        <Link href={`/console/products/${id}`} className="text-[14px] text-muted underline">{p.name}</Link>
        <h1 className="mt-1 text-[34px]">Prices for {p.name}</h1>
        <p className="text-muted">
          {p.pricing_mode === 'tier' ? 'Each box is the price for the whole quantity at the top of the column, not for one piece.' : p.pricing_mode === 'size' ? 'Each box is the price for one piece of that size.' : 'Each row is a rate per square foot.'}{' '}
          Customers see changes the moment you save. Orders already placed keep the price they were placed at.
        </p>
      </div>

      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      {placeholders > 0 && (
        <Notice tone="warn">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span><b>{placeholders} price{placeholders === 1 ? ' here is' : 's here are'} a placeholder.</b> {placeholders === 1 ? 'It looks' : 'They look'} real to customers on a test site but are only an example. Type over a box to make it real, or confirm them all once you have checked them.</span>
            <form action={confirmPlaceholdersAction}><input type="hidden" name="id" value={id} /><button className="btn-secondary btn-sm">They are all real: confirm</button></form>
          </div>
        </Notice>
      )}
      {waiting > 0 && <Notice tone="neutral"><b>{waiting} add-on{waiting === 1 ? ' is' : 's are'} waiting for a price</b> and not shown to customers yet. Set them under <Link className="underline" href={`/console/products/${id}/options`}>Options and packages</Link>.</Notice>}

      <section className="card grid gap-4 p-5" aria-labelledby="grid-h">
        <h2 id="grid-h" className="text-[22px]">{p.pricing_mode === 'tier' ? 'Quantities and prices' : p.pricing_mode === 'size' ? 'Sizes and prices' : 'Price per square foot'}</h2>
        {grid.rows.length === 0 ? (
          <p className="text-muted">This product has no choices that change the price.</p>
        ) : (
          <PriceGrid id={id} mode={grid.mode} rows={grid.rows} cols={grid.cols} cells={grid.cells} area={grid.area} targetMarginPct={grid.targetMarginPct} customQuantity={grid.customQuantity} action={saveGridAction} />
        )}
        <p className="text-[13px] text-muted">
          Copy a block from Excel or Google Sheets and paste it into any box: it fills the boxes to the right and below. Costs are private and never shown to customers.{' '}
          {p.pricing_mode === 'tier' && p.qty_custom && 'Customers may also type a quantity between your steps; it is priced at the per-piece price of the step below, never more than the next step up.'}
        </p>
      </section>

      {grid.orphans.length > 0 && (
        <section className="card grid gap-3 border-warn/40 p-5" aria-labelledby="stray-h">
          <h2 id="stray-h" className="text-[20px]">Stray prices</h2>
          <p className="text-[15px] text-muted">These prices belong to a choice or size that is no longer in the grid, so you cannot see them above. They may still apply to customers as a fallback. Remove the ones you do not need.</p>
          <form action={removeStrayAction} className="grid gap-2">
            <input type="hidden" name="id" value={id} />
            {grid.orphans.map((o) => <label key={o.id} className="flex min-h-[40px] items-center gap-3 text-[15px]"><input type="checkbox" name="stray" value={o.id} defaultChecked className="h-5 w-5 accent-[#0B1F33]" /><span><b>{o.label}</b>: {o.detail}</span></label>)}
            <button className="btn-secondary btn-sm self-start">Remove the ticked prices</button>
          </form>
        </section>
      )}

      <section className="card grid gap-3 p-5" aria-labelledby="try-h">
        <h2 id="try-h" className="text-[22px]">Try a price</h2>
        <p className="text-[15px] text-muted">Choose things the way a customer would. This also shows add-ons that are not on sale yet, marked in the lists.</p>
        <TryPrice productId={id} mode={p.pricing_mode} options={p.options} sizes={p.sizes.map((s) => ({ key: s.key, label: s.label }))} targetMarginPct={grid.targetMarginPct} />
        <div className="flex flex-wrap gap-3 pt-1">
          {p.active ? <Link className="btn-secondary btn-sm" href={`/products/${p.slug}?preview=1`} target="_blank">Preview as a customer</Link> : <Link className="btn-secondary btn-sm" href={`/products/${p.slug}?preview=1`} target="_blank">Preview as a customer (hidden product)</Link>}
          <Link className="btn-ghost btn-sm" href={`/console/products/${id}/test`}>Run the price test</Link>
        </div>
      </section>

      <section className="card grid gap-3 p-5" aria-labelledby="hist-h">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="hist-h" className="text-[22px]">Who changed what</h2>
          <Link className="text-[14px] underline text-muted" href="/console/products/history">Every product&rsquo;s history</Link>
        </div>
        {history.length === 0 ? <p className="text-muted">No changes yet.</p> : (
          <ul className="grid gap-2">
            {history.map((h) => (
              <li key={h.id} className="rounded-sm2 border border-line p-3">
                <p className="text-[14px] text-muted">{when(h.at)} · {h.actor}</p>
                <p className="font-bold">{h.summary}</p>
                {Array.isArray(h.detail?.cells) && h.detail.cells.length > 0 && (
                  <details className="mt-1 text-[14px]"><summary className="cursor-pointer text-muted">See the changes</summary>
                    <ul className="mt-1 grid gap-0.5">{h.detail.cells.slice(0, 40).map((c: any, i: number) => <li key={i}>{c.where}: {c.was} → {c.now}</li>)}</ul>
                    {h.detail.cells.length > 40 && <p className="text-muted">and {h.detail.cells.length - 40} more</p>}
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
