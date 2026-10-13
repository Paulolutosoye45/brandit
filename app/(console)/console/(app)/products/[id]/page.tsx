import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { query, one } from '@/lib/db';
import { getProductById } from '@/lib/catalog';
import { readiness, MAX_IMAGES } from '@/lib/productAdmin';
import { listImages } from '@/lib/productImages';
import { imageUrl } from '@/lib/catalog';
import { Notice } from '@/components/Bits';
import {
  saveDetailsAction, saveOptionsAction, saveSizesAction, saveTiersAction, saveAreaAction, save24hAction,
  setActiveAction, deleteImageAction, coverImageAction, altImageAction, deleteProductAction,
} from '../actions';
import { OptionsEditor, SizesEditor, TiersEditor, ImageUploader } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit product' };

const MODE_TEXT = { tier: 'Priced by quantity', size: 'Priced by size', area: 'Priced by the square foot' } as const;
const k2n = (k: number | null | undefined) => (k == null ? '' : String(k / 100));

export default async function EditProduct(props: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; ok?: string }> }) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireStaff('manage_catalog');
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const p = await getProductById(id);
  if (!p) notFound();
  const [ready, images, rules, promise, cats, used] = await Promise.all([
    readiness(id),
    listImages(id),
    query<any>('select * from price_rules where product_id = $1 and active order by quantity nulls last, size_key', [id]),
    one<any>('select * from promise_rules where product_id = $1', [id]),
    query<{ category: string }>("select distinct category from products where category <> '' and not system order by category"),
    one<{ n: number }>('select (select count(*) from order_items where product_id = $1)::int as n', [id]),
  ]);
  const area = rules.find((r) => r.rate_per_sqft_kobo != null);
  const sizeRows = p.sizes.map((s) => ({ key: s.key, label: s.label, w: String(s.w_in), h: String(s.h_in), price: k2n(rules.find((r) => r.size_key === s.key)?.price_kobo) }));
  const tierRows = rules.filter((r) => r.quantity != null).map((r) => ({ quantity: String(r.quantity), price: k2n(r.price_kobo) }));
  const hasPlaceholder = (await one<{ n: number }>('select count(*)::int as n from price_rules where product_id = $1 and provisional', [id]))!.n > 0;

  return (
    <div className="grid gap-6 max-w-[900px]">
      <div>
        <Link href="/console/products" className="text-[14px] underline text-muted">All products</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-[34px]">{p.name}</h1>
          <span className={`pill ${p.active ? 'bg-good-tint text-good' : 'bg-placeholder text-ink'}`}>{p.active ? 'On sale' : 'Hidden'}</span>
        </div>
        <p className="text-muted">{MODE_TEXT[p.pricing_mode]}. {p.active && <Link className="underline" href={`/products/${p.slug}`} target="_blank">See it in the shop</Link>}</p>
      </div>

      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}

      <section className="card p-5 grid gap-3" aria-labelledby="ready-h">
        <h2 id="ready-h" className="text-[22px]">{p.active ? 'This product is on sale' : ready.ready ? 'Ready to go on sale' : 'Not ready yet'}</h2>
        {ready.missing.length > 0 && <div><p className="font-bold">Needed before it can go on sale</p><ul className="list-disc pl-5 text-[15px]">{ready.missing.map((m) => <li key={m}>{m}</li>)}</ul></div>}
        {ready.tips.length > 0 && <div><p className="font-bold">Worth doing</p><ul className="list-disc pl-5 text-[15px] text-muted">{ready.tips.map((m) => <li key={m}>{m}</li>)}</ul></div>}
        {hasPlaceholder && <Notice tone="warn">Some prices on this product are still placeholders. Save the prices below once you have checked them.</Notice>}
        <form action={setActiveAction} className="flex flex-wrap gap-3">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="on" value={p.active ? '0' : '1'} />
          <button className={p.active ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'} disabled={!p.active && !ready.ready}>{p.active ? 'Hide from the shop' : 'Put on sale'}</button>
        </form>
      </section>

      <section id="photos" className="card p-5 grid gap-4 scroll-mt-6">
        <div><h2 className="text-[22px]">Photos</h2><p className="text-muted text-[15px]">The first photo is the main one on the shop page and in WhatsApp link previews. Show the real product: hold it up in good light.</p></div>
        {images.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {images.map((im, i) => (
              <li key={im.id} className="rounded-md2 border border-line p-2 grid gap-2">
                <div className="relative aspect-[4/3] overflow-hidden rounded-sm2 bg-paper2">
                  <img src={imageUrl(im.id)} alt={im.alt} className="h-full w-full object-cover" loading="lazy" />
                  {i === 0 && <span className="pill absolute left-2 top-2 bg-accent text-ink">Main photo</span>}
                </div>
                <form action={altImageAction} className="grid gap-1">
                  <input type="hidden" name="id" value={id} /><input type="hidden" name="image" value={im.id} />
                  <label className="sr-only" htmlFor={`alt-${im.id}`}>What the photo shows</label>
                  <input id={`alt-${im.id}`} name="alt" defaultValue={im.alt} maxLength={120} className="field !min-h-[40px] !text-[14px]" placeholder="What the photo shows" />
                  <button className="btn-ghost btn-sm">Save description</button>
                </form>
                <div className="flex flex-wrap gap-1">
                  {i > 0 && <form action={coverImageAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="image" value={im.id} /><button className="btn-secondary btn-sm">Make main</button></form>}
                  <form action={deleteImageAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="image" value={im.id} /><button className="btn-ghost btn-sm !text-bad">Remove</button></form>
                </div>
              </li>
            ))}
          </ul>
        )}
        <ImageUploader productId={id} count={images.length} max={MAX_IMAGES} />
      </section>

      <section id="details" className="card p-5 grid gap-4 scroll-mt-6">
        <h2 className="text-[22px]">Name and description</h2>
        <form action={saveDetailsAction} className="grid gap-4">
          <input type="hidden" name="id" value={id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="label" htmlFor="d-name">Product name</label><input id="d-name" name="name" required maxLength={60} className="field" defaultValue={p.name} /></div>
            <div>
              <label className="label" htmlFor="d-cat">Category</label>
              <input id="d-cat" name="category" list="cats" maxLength={40} className="field" defaultValue={p.category} />
              <datalist id="cats">{cats.map((c) => <option key={c.category} value={c.category} />)}</datalist>
            </div>
          </div>
          <div><label className="label" htmlFor="d-blurb">One line for the product card</label><input id="d-blurb" name="blurb" maxLength={160} className="field" defaultValue={p.blurb} /></div>
          <div><label className="label" htmlFor="d-desc">About this product</label><textarea id="d-desc" name="description" maxLength={4000} className="field !py-3 min-h-[140px]" defaultValue={p.description} placeholder="What it is, what it is good for, what paper or material it uses." /><p className="text-[13px] text-muted mt-1">Write the way you would explain it to a customer on WhatsApp. Leave a blank line between paragraphs. Only say things that are true for every order.</p></div>
          <div><label className="label" htmlFor="d-hi">Good to know (one point per line, up to 8)</label><textarea id="d-hi" name="highlights" className="field !py-3 min-h-[110px]" defaultValue={p.highlights.join('\n')} placeholder={'Full colour on both sides\nUpload your design or we design it'} /></div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="d-class">Sharpness check</label>
              <select id="d-class" name="check_class" className="field" defaultValue={p.check_class}>
                <option value="print">Standard print (300 dpi)</option>
                <option value="photo">Photo print</option>
                <option value="large">Large format (banners)</option>
              </select>
            </div>
            {p.pricing_mode === 'tier' && (
              <>
                <div><label className="label" htmlFor="d-w">Print width (in)</label><input id="d-w" name="print_w_in" inputMode="decimal" className="field" defaultValue={p.print_w_in ?? ''} placeholder="3.5" /></div>
                <div><label className="label" htmlFor="d-h">Print height (in)</label><input id="d-h" name="print_h_in" inputMode="decimal" className="field" defaultValue={p.print_h_in ?? ''} placeholder="2" /></div>
              </>
            )}
          </div>
          <label className="flex items-center gap-3 min-h-[44px]"><input type="checkbox" name="allow_custom" defaultChecked={p.allow_custom} className="h-5 w-5 accent-[#0B1F33]" /><span><span className="font-bold">Show &ldquo;Need it different?&rdquo;</span> Customers can ask for a custom quote on this product.</span></label>
          <button className="btn-primary btn-sm self-start">Save details</button>
        </form>
      </section>

      <section id="prices" className="card p-5 grid gap-4 scroll-mt-6">
        <div><h2 className="text-[22px]">{p.pricing_mode === 'tier' ? 'Quantities and prices' : p.pricing_mode === 'size' ? 'Sizes and prices' : 'Price per square foot'}</h2></div>
        {p.pricing_mode === 'tier' && <TiersEditor id={id} initial={tierRows} action={saveTiersAction} />}
        {p.pricing_mode === 'size' && <SizesEditor id={id} initial={sizeRows} action={saveSizesAction} />}
        {p.pricing_mode === 'area' && (
          <form action={saveAreaAction} className="grid gap-3 sm:max-w-[520px]">
            <input type="hidden" name="id" value={id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="a-rate">Rate per square foot (₦)</label><input id="a-rate" name="rate" inputMode="numeric" className="field" defaultValue={k2n(area?.rate_per_sqft_kobo)} placeholder="1500" /></div>
              <div><label className="label" htmlFor="a-min">Smallest area charged (sq ft)</label><input id="a-min" name="min_area" inputMode="decimal" className="field" defaultValue={area?.min_area_sqft ?? ''} placeholder="6" /></div>
            </div>
            <button className="btn-primary btn-sm self-start">Save price</button>
          </form>
        )}
        <p className="text-[13px] text-muted">Prices are what a customer pays before VAT settings, delivery and any coupon. {used?.n ? `This product has ${used.n} order${used.n === 1 ? '' : 's'}; changing a price never changes an order that is already placed.` : ''}</p>
      </section>

      <section id="options" className="card p-5 grid gap-4 scroll-mt-6">
        <div><h2 className="text-[22px]">Options customers choose</h2><p className="text-muted text-[15px]">Finish, paper, sides, corners and so on. Each choice can add to the price.</p></div>
        <OptionsEditor id={id} initial={p.options as any} mode={p.pricing_mode} action={saveOptionsAction} />
      </section>

      <section id="delivery" className="card p-5 grid gap-4 scroll-mt-6">
        <div><h2 className="text-[22px]">Delivery speed</h2><p className="text-muted text-[15px]">When a job is small enough to print the same day, customers can choose 24-hour delivery. Set the largest job you can do that way.</p></div>
        <form action={save24hAction} className="grid gap-4">
          <input type="hidden" name="id" value={id} />
          <label className="flex items-center gap-3 min-h-[44px]"><input type="checkbox" name="eligible" defaultChecked={promise?.eligible_24h ?? false} className="h-5 w-5 accent-[#0B1F33]" />This product can be 24-hour</label>
          <div className="grid gap-4 sm:grid-cols-3">
            {p.pricing_mode === 'tier' && <div><label className="label" htmlFor="x-q">Most pieces for 24-hour</label><input id="x-q" name="max_quantity" type="number" min={1} className="field" defaultValue={promise?.max_quantity ?? ''} placeholder="No limit" /></div>}
            {p.pricing_mode === 'area' && <div><label className="label" htmlFor="x-a">Most square feet for 24-hour</label><input id="x-a" name="max_area" inputMode="decimal" className="field" defaultValue={promise?.max_area_sqft ?? ''} placeholder="No limit" /></div>}
            {p.pricing_mode === 'size' && (
              <div>
                <label className="label" htmlFor="x-s">Largest size for 24-hour</label>
                <select id="x-s" name="max_size_rank" className="field" defaultValue={promise?.max_size_rank ?? ''}>
                  <option value="">No limit</option>
                  {p.sizes.map((s, i) => <option key={s.key} value={i}>{s.label}</option>)}
                </select>
              </div>
            )}
            {p.pricing_mode !== 'tier' && <input type="hidden" name="max_quantity" value={promise?.max_quantity ?? ''} />}
            {p.pricing_mode !== 'area' && <input type="hidden" name="max_area" value={promise?.max_area_sqft ?? ''} />}
            {p.pricing_mode !== 'size' && <input type="hidden" name="max_size_rank" value={promise?.max_size_rank ?? ''} />}
            <div><label className="label" htmlFor="x-d">Standard delivery takes (working days)</label><input id="x-d" name="standard_days" type="number" min={1} max={30} className="field" defaultValue={promise?.standard_days ?? 3} /></div>
          </div>
          <p className="text-[13px] text-muted">These are starting guesses. Time each product at its limit three times and keep a limit only if the job is packed in under five working hours.</p>
          <button className="btn-primary btn-sm self-start">Save delivery limits</button>
        </form>
      </section>

      <section id="remove" className="card p-5 grid gap-3 scroll-mt-6 border-bad/40">
        <h2 className="text-[22px]">Remove this product</h2>
        {used?.n ? (
          <p className="text-[15px] text-muted">This product has {used.n} order{used.n === 1 ? '' : 's'} behind it, so it cannot be deleted. Use &ldquo;Hide from the shop&rdquo; above and it disappears for customers while old invoices keep working.</p>
        ) : (
          <form action={deleteProductAction} className="grid gap-3 sm:max-w-[420px]">
            <input type="hidden" name="id" value={id} />
            <p className="text-[15px] text-muted">This deletes the product, its prices and its photos for good. If you may want it back, hide it instead.</p>
            <div><label className="label" htmlFor="del">Type <span className="font-mono">delete</span> to confirm</label><input id="del" name="confirm" autoComplete="off" className="field" /></div>
            <button className="btn-secondary btn-sm self-start !border-bad !text-bad">Delete this product</button>
          </form>
        )}
      </section>
    </div>
  );
}
