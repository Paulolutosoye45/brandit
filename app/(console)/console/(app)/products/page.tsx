import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { listCatalog, imageUrl } from '@/lib/catalog';
import { Notice } from '@/components/Bits';
import { setActiveAction, moveProductAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Products' };

export default async function Products(props: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const sp = await props.searchParams;
  await requireStaff('manage_catalog');
  const cards = await listCatalog(true);
  const live = cards.filter((c) => c.product.active).length;
  return (
    <div className="grid gap-6 max-w-[980px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[34px]">Products</h1>
          <p className="text-muted">{live} on sale, {cards.length - live} hidden. Add products, change photos, descriptions, options and prices. Customers see changes straight away.</p>
        </div>
        <Link href="/console/products/new" className="btn-primary">Add a product</Link>
      </div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      <ul className="grid gap-3">
        {cards.map(({ product: p, from, cover, coverAlt }, i) => (
          <li key={p.id} className="card p-3 sm:p-4 flex flex-wrap items-center gap-3 sm:gap-4">
            <Link href={`/console/products/${p.id}`} className="shrink-0 grid h-20 w-24 place-items-center overflow-hidden rounded-sm2 bg-paper2" aria-label={`Edit ${p.name}`}>
              {cover ? <img src={imageUrl(cover)} alt={coverAlt} width={96} height={80} className="h-full w-full object-cover" loading="lazy" /> : <span className="px-2 text-center text-[12px] text-muted">No photo yet</span>}
            </Link>
            <div className="min-w-0 flex-1 basis-48">
              <Link href={`/console/products/${p.id}`} className="block text-[19px] font-bold leading-tight hover:underline">{p.name}</Link>
              <p className="text-[14px] text-muted">{p.category || 'No category'} · {from}</p>
              <p className="mt-1"><span className={`pill ${p.active ? 'bg-good-tint text-good' : 'bg-placeholder text-ink'}`}>{p.active ? 'On sale' : 'Hidden'}</span></p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/console/products/${p.id}`} className="btn-secondary btn-sm">Edit</Link>
              <form action={setActiveAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="on" value={p.active ? '0' : '1'} /><button className="btn-ghost btn-sm">{p.active ? 'Hide' : 'Put on sale'}</button></form>
              <form action={moveProductAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="dir" value="up" /><button className="btn-ghost btn-sm" aria-label={`Move ${p.name} earlier`} disabled={i === 0} title="Show earlier">↑ Up</button></form>
              <form action={moveProductAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="dir" value="down" /><button className="btn-ghost btn-sm" aria-label={`Move ${p.name} later`} disabled={i === cards.length - 1} title="Show later">↓ Down</button></form>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[13px] text-muted">The order here is the order customers see. The first product is shown biggest on the home page.</p>
    </div>
  );
}
