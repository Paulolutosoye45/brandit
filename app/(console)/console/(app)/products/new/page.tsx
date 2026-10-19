import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { query } from '@/lib/db';
import { Notice } from '@/components/Bits';
import { createProductAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Add a product' };

const MODES = [
  { v: 'tier', t: 'By quantity', d: 'Customers pick 100, 250, 500… and each quantity has one price. Good for business cards, flyers, stickers.' },
  { v: 'size', t: 'By size', d: 'Customers pick a size and each size has one price. Good for frames, posters, mugs, T-shirts.' },
  { v: 'area', t: 'By square foot', d: 'Customers type a width and height and pay a rate per square foot. Good for banners and large prints.' },
];

export default async function NewProduct(props: { searchParams: Promise<{ e?: string }> }) {
  const sp = await props.searchParams;
  await requireStaff('manage_catalog');
  const cats = await query<{ category: string }>("select distinct category from products where category <> '' and not system order by category");
  return (
    <div className="grid gap-6 max-w-[720px]">
      <div><Link href="/console/products" className="text-[14px] underline text-muted">All products</Link><h1 className="text-[34px]">Add a product</h1><p className="text-muted">Start with the basics. On the next page you add photos, prices and options. The product stays hidden until you switch it on.</p></div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      <form action={createProductAction} className="card p-5 grid gap-5">
        <div><label className="label" htmlFor="n">Product name</label><input id="n" name="name" required maxLength={60} className="field" placeholder="Branded tote bags" /></div>
        <div><label className="label" htmlFor="b">One line for the product card</label><input id="b" name="blurb" maxLength={160} className="field" placeholder="Strong canvas totes with your logo, ready in 3 days." /></div>
        <div>
          <label className="label" htmlFor="c">Category</label>
          <input id="c" name="category" list="cats" maxLength={40} className="field" placeholder="Marketing prints" />
          <datalist id="cats">{cats.map((c) => <option key={c.category} value={c.category} />)}</datalist>
        </div>
        <fieldset>
          <legend className="label">How is it priced?</legend>
          <div className="grid gap-2">
            {MODES.map((m, i) => (
              <label key={m.v} className="flex items-start gap-3 rounded-md2 border-2 border-line p-4 cursor-pointer has-[:checked]:border-ink has-[:checked]:bg-paper2 min-h-[64px]">
                <input type="radio" name="mode" value={m.v} defaultChecked={i === 0} className="mt-1 h-5 w-5 accent-[#0B1F33]" />
                <span><span className="block font-bold">{m.t}</span><span className="block text-[14px] text-muted">{m.d}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-3"><button className="btn-primary">Create and continue</button><Link href="/console/products" className="btn-ghost">Cancel</Link></div>
      </form>
    </div>
  );
}
