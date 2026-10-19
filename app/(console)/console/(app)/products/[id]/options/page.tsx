import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { getProductById } from '@/lib/catalog';
import { optionsToInput, packagesToInput } from '@/lib/optionsForm';
import { Notice } from '@/components/Bits';
import { saveOptionsAction, savePackagesAction, saveQuantityAction, saveSizesAction } from '../../actions';
import { OptionsEditor, PackagesEditor, SizesEditor } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Options and packages' };

export default async function OptionsPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; ok?: string }> }) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireStaff('manage_catalog');
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const p = await getProductById(id);
  if (!p) notFound();
  const options = optionsToInput(p.options);
  const sizes = p.sizes.map((s) => ({ key: s.key, label: s.label }));
  const waiting = p.options.reduce((n, o) => n + o.choices.filter((c) => c.unpriced).length, 0);

  return (
    <div className="grid max-w-[980px] gap-6">
      <div>
        <Link href={`/console/products/${id}`} className="text-[14px] text-muted underline">{p.name}</Link>
        <h1 className="mt-1 text-[34px]">Options and packages for {p.name}</h1>
        <p className="text-muted">What customers can choose, what each choice costs them, and the one-tap packages. Customers see changes the moment you save. Orders already placed keep the price they were placed at.</p>
      </div>

      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      {waiting > 0 && <Notice tone="neutral"><b>{waiting} add-on{waiting === 1 ? ' is' : 's are'} waiting for a price.</b> Customers cannot see {waiting === 1 ? 'it' : 'them'} until you give {waiting === 1 ? 'it' : 'each'} a price (or tick &ldquo;no charge&rdquo;). Open the option below and type the amount.</Notice>}

      {p.pricing_mode === 'size' && (
        <section id="sizes" className="card grid gap-4 scroll-mt-6 p-5">
          <div><h2 className="text-[22px]">Sizes</h2><p className="text-[15px] text-muted">Prices for each size go in the <Link className="underline" href={`/console/products/${id}/prices`}>price grid</Link>.</p></div>
          <SizesEditor id={id} initial={p.sizes.map((s) => ({ key: s.key, label: s.label, w: String(s.w_in), h: String(s.h_in) }))} action={saveSizesAction} />
        </section>
      )}

      {p.pricing_mode === 'tier' && (
        <section id="quantity" className="card grid gap-4 scroll-mt-6 p-5">
          <div>
            <h2 className="text-[22px]">Quantities between your steps</h2>
            <p className="text-[15px] text-muted">The steps themselves (100, 250, 500…) are the columns of the <Link className="underline" href={`/console/products/${id}/prices`}>price grid</Link>. Here you decide whether a customer may also type a quantity that is not a step, and the smallest and largest order you take online. A quantity between two steps is priced at the per-piece price of the step below, and never costs more than the next step up. This needs at least two steps with prices.</p>
          </div>
          <form action={saveQuantityAction} className="grid gap-4 sm:max-w-[620px]">
            <input type="hidden" name="id" value={id} />
            <label className="flex min-h-[44px] items-center gap-3"><input type="checkbox" name="custom" defaultChecked={p.qty_custom} className="h-5 w-5 accent-[#0B1F33]" /><span><span className="font-bold">Let customers type their own quantity</span></span></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="label" htmlFor="q-min">Smallest order (optional)</label><input id="q-min" name="min" inputMode="numeric" className="field" defaultValue={p.qty_min ?? ''} placeholder="No minimum" /></div>
              <div><label className="label" htmlFor="q-max">Largest online order (optional)</label><input id="q-max" name="max" inputMode="numeric" className="field" defaultValue={p.qty_max ?? ''} placeholder="No limit" /></div>
            </div>
            <button className="btn-primary btn-sm self-start">Save</button>
          </form>
        </section>
      )}

      <section id="options" className="card grid gap-4 scroll-mt-6 p-5">
        <div><h2 className="text-[22px]">Options customers choose</h2><p className="text-[15px] text-muted">Finish, paper, sides, corners, add-ons and so on. Each choice can add to the price: a fixed amount, an amount per piece, per square foot, per foot, per position, a percentage, or a different amount for each quantity step or size. Open an option to edit it.</p></div>
        <OptionsEditor id={id} initial={options} mode={p.pricing_mode} sizes={sizes} action={saveOptionsAction} />
      </section>

      <section id="packages" className="card grid gap-4 scroll-mt-6 p-5">
        <div><h2 className="text-[22px]">Packages: Standard, Premium, Luxury</h2><p className="text-[15px] text-muted">One-tap bundles of choices. A customer taps one and every choice in it is set; the price shown is worked out from the choices, so it can never drift from the price grid.</p></div>
        <PackagesEditor id={id} initial={packagesToInput(p.packages ?? [])} options={options} action={savePackagesAction} />
      </section>
    </div>
  );
}
