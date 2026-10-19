import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { priceHistory } from '@/lib/priceAdmin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Price history' };

const when = (d: string | Date) => new Date(d).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const KIND: Record<string, string> = { prices: 'Prices', options: 'Options and packages', catalogue: 'Catalogue', confirm: 'Confirmed' };

export default async function History(props: { searchParams: Promise<{ n?: string }> }) {
  const sp = await props.searchParams;
  await requireStaff('manage_catalog');
  const n = Math.min(500, Math.max(25, Math.trunc(Number(sp.n)) || 100));
  const rows = await priceHistory({ limit: n });
  return (
    <div className="grid max-w-[900px] gap-6">
      <div>
        <Link href="/console/products" className="text-[14px] text-muted underline">All products</Link>
        <h1 className="mt-1 text-[34px]">Who changed what</h1>
        <p className="text-muted">Every change to a price, an option or a package, newest first. It is a record, so nothing here can be edited.</p>
      </div>
      {rows.length === 0 ? <p className="text-muted">No changes yet.</p> : (
        <ul className="grid gap-2">
          {rows.map((h) => (
            <li key={h.id} className="card p-3">
              <p className="flex flex-wrap items-center gap-2 text-[14px] text-muted"><span>{when(h.at)}</span><span>·</span><span>{h.actor}</span><span className="pill bg-placeholder text-ink">{KIND[h.kind] ?? h.kind}</span></p>
              <p className="font-bold">{h.product_id ? <Link className="hover:underline" href={`/console/products/${h.product_id}/prices`}>{h.summary}</Link> : h.summary}</p>
              {Array.isArray(h.detail?.cells) && h.detail.cells.length > 0 && (
                <details className="mt-1 text-[14px]"><summary className="cursor-pointer text-muted">See the changes</summary>
                  <ul className="mt-1 grid gap-0.5">{h.detail.cells.slice(0, 60).map((c: any, i: number) => <li key={i}>{c.where}: {c.was} → {c.now}</li>)}</ul>
                  {h.detail.cells.length > 60 && <p className="text-muted">and {h.detail.cells.length - 60} more</p>}
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows.length >= n && n < 500 && <Link className="btn-secondary btn-sm self-start" href={`/console/products/history?n=${Math.min(500, n * 2)}`}>Show more</Link>}
    </div>
  );
}
