import { PALETTES, LAYOUTS, LAYOUT_LABEL, fieldsToLines } from '@/lib/templateCore';
import type { Template } from '@/lib/templates';

export type ProductChoice = { id: string; name: string; pricing_mode: string; sizes: { key: string; label: string }[] };

/** The form shared by "Add a template" and "Edit a template". */
export function TemplateFields({ t, products, categories }: { t?: Template; products: ProductChoice[]; categories: string[] }) {
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label" htmlFor="title">Template name</label><input id="title" name="title" required maxLength={70} defaultValue={t?.title} className="field" placeholder="Church programme" /></div>
        <div>
          <label className="label" htmlFor="category">Group</label>
          <input id="category" name="category" list="tpl-cats" maxLength={40} defaultValue={t?.category} className="field" placeholder="Church and funerals" />
          <datalist id="tpl-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div><label className="label" htmlFor="includes">What they get</label><input id="includes" name="includes" maxLength={100} defaultValue={t?.includes} className="field" placeholder="100 programmes, A5, both sides" /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="blurb">One line for the card</label><input id="blurb" name="blurb" maxLength={200} defaultValue={t?.blurb} className="field" placeholder="Order of service, hymns and announcements, ready for Sunday." /></div>
      </div>

      <fieldset className="grid gap-4 rounded-md2 border-2 border-line p-4 sm:grid-cols-2">
        <legend className="px-1 font-bold">What it prints on</legend>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="productId">Product</label>
          <select id="productId" name="productId" required defaultValue={t?.product_id} className="field">
            <option value="">Choose a product</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div><label className="label" htmlFor="quantity">Starting quantity</label><input id="quantity" name="quantity" inputMode="numeric" required defaultValue={t?.quantity ?? 100} className="field" /></div>
        <div>
          <label className="label" htmlFor="sizeKey">Size (for products priced by size)</label>
          <select id="sizeKey" name="sizeKey" defaultValue={t?.size_key ?? ''} className="field">
            <option value="">First size</option>
            {products.flatMap((p) => p.sizes.map((s) => <option key={`${p.id}-${s.key}`} value={s.key}>{p.name}: {s.label}</option>))}
          </select>
        </div>
        <div><label className="label" htmlFor="widthFt">Width in feet (banners)</label><input id="widthFt" name="widthFt" inputMode="decimal" defaultValue={t?.width_ft ?? ''} className="field" placeholder="6" /></div>
        <div><label className="label" htmlFor="heightFt">Height in feet (banners)</label><input id="heightFt" name="heightFt" inputMode="decimal" defaultValue={t?.height_ft ?? ''} className="field" placeholder="3" /></div>
        <p className="text-[13px] text-muted sm:col-span-2">Only fill in the size that matches the product: a size for products priced by size, width and height for banners. Customers can change the quantity but not the product.</p>
      </fieldset>

      <div>
        <label className="label" htmlFor="fields">Questions we ask the customer</label>
        <textarea id="fields" name="fields" required rows={8} defaultValue={t ? fieldsToLines(t.fields) : ''} className="field font-mono text-[14px]" placeholder={'Church name* | Full name as it should appear\nDate of service* | | date\nOrder of service | One item per line | long'} spellCheck={false} />
        <p className="mt-1 text-[13px] text-muted">One question per line: <strong>Question* | Hint | long or date</strong>. A star makes it required. Leave the last part off for a short answer. Up to 12 questions.</p>
      </div>
      <div><label className="label" htmlFor="purpose">Short name for the designer</label><input id="purpose" name="purpose" maxLength={80} defaultValue={t?.purpose} className="field" placeholder="Church programme" /><p className="mt-1 text-[13px] text-muted">Shown to the designer as the purpose of the design.</p></div>

      <fieldset className="grid gap-4 rounded-md2 border-2 border-line p-4 sm:grid-cols-2">
        <legend className="px-1 font-bold">Drawn preview</legend>
        <div>
          <label className="label" htmlFor="layout">Shape</label>
          <select id="layout" name="layout" defaultValue={t?.look.layout ?? 'flyer'} className="field">{LAYOUTS.map((l) => <option key={l} value={l}>{LAYOUT_LABEL[l]}</option>)}</select>
        </div>
        <div>
          <label className="label" htmlFor="palette">Colours</label>
          <select id="palette" name="palette" defaultValue={t?.look.palette ?? 'ink'} className="field">{Object.entries(PALETTES).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="lines">Sample words in the preview</label>
          <textarea id="lines" name="lines" rows={4} defaultValue={t?.look.lines.join('\n')} className="field" placeholder={'Grace Community Church\nSunday Service\n14 December'} />
          <p className="mt-1 text-[13px] text-muted">One line each, up to 8. If you add a real picture below, the picture is shown instead.</p>
        </div>
      </fieldset>
    </>
  );
}
