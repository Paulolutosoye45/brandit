import { requireStaff } from '@/lib/session';
import { stockList } from '@/lib/stock';
import { Notice } from '@/components/Bits';
import { stockAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Stock' };

export default async function Stock(props: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const sp = await props.searchParams;
  await requireStaff('manage_catalog');
  const products = await stockList();
  return (
    <div className="grid max-w-[900px] gap-6">
      <div><h1 className="text-[34px]">Stock</h1><p className="text-muted">Out of black tees in XL? Tap it off and customers stop seeing it, straight away. Tap it on when it is back. Brandit does not count items: this is an on/off switch for each colour, size or paper.</p></div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      {products.length === 0 && <p className="text-muted">No product has a colour, size or paper choice yet.</p>}
      {products.map((p) => (
        <section key={p.id} id={`p-${p.id}`} className="card grid gap-4 p-5">
          <h2 className="flex flex-wrap items-center gap-3 text-[22px]">{p.name}{p.outCount > 0 && <span className="pill bg-warn-tint text-warn">{p.outCount} switched off</span>}</h2>
          {p.options.map((o) => (
            <div key={o.key} className="grid gap-2">
              <p className="label !mb-0">{o.label}</p>
              <ul className="flex flex-wrap gap-2">
                {o.choices.map((c) => (
                  <li key={c.value}>
                    <form action={stockAction}>
                      <input type="hidden" name="product" value={p.id} /><input type="hidden" name="option" value={o.key} /><input type="hidden" name="value" value={c.value} /><input type="hidden" name="on" value={c.inStock ? '0' : '1'} />
                      <button aria-pressed={c.inStock} title={c.waitingForPrice ? 'Still waiting for a price, so customers cannot pick it yet' : undefined} className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border-2 px-4 font-bold ${c.inStock ? 'border-[#9BD3B3] bg-good-tint text-good' : 'border-line-control bg-paper2 text-muted line-through'}`}>
                        <span aria-hidden="true">{c.inStock ? '●' : '○'}</span>{c.label}<span className="sr-only">{c.inStock ? ', on sale. Press to switch off.' : ', switched off. Press to switch on.'}</span>{c.waitingForPrice && <span className="pill bg-warn-tint text-warn no-underline">needs a price</span>}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
