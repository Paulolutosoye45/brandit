import { THEMES } from '@/lib/campaignCore';
import type { Campaign } from '@/lib/campaigns';

export type Choice = { slug: string; name: string };

/** The form shared by "Add a seasonal page" and "Edit a seasonal page". */
export function CampaignFields({ c, products, templates }: { c?: Campaign; products: Choice[]; templates: Choice[] }) {
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label" htmlFor="title">Name</label><input id="title" name="title" required maxLength={60} defaultValue={c?.title} className="field" placeholder="Wedding season" /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="headline">Big line at the top</label><input id="headline" name="headline" required maxLength={90} defaultValue={c?.headline} className="field" placeholder="Print for the big day, all in one place." /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="intro">A few sentences under it</label><textarea id="intro" name="intro" rows={3} maxLength={500} defaultValue={c?.intro} className="field" placeholder="Invitations, programmes, banners and T-shirts…" /></div>
        <div><label className="label" htmlFor="startsOn">First day</label><input id="startsOn" name="startsOn" type="date" defaultValue={c?.starts_on ?? ''} className="field" /></div>
        <div><label className="label" htmlFor="endsOn">Last day</label><input id="endsOn" name="endsOn" type="date" defaultValue={c?.ends_on ?? ''} className="field" /></div>
        <p className="text-[13px] text-muted sm:col-span-2">The page shows to customers from the first day to the end of the last day (Lagos time). Leave both empty to show it whenever it is switched on.</p>
        <div><label className="label" htmlFor="theme">Colours</label>
          <select id="theme" name="theme" defaultValue={c?.theme ?? 'ink'} className="field">{Object.entries(THEMES).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select></div>
        <div><label className="label" htmlFor="couponCode">Coupon code to offer (optional)</label><input id="couponCode" name="couponCode" maxLength={30} defaultValue={c?.coupon_code ?? ''} className="field uppercase" placeholder="WEDDING10" /><p className="mt-1 text-[13px] text-muted">Must already exist in Coupons.</p></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="note">Order-in-time note</label><input id="note" name="note" maxLength={300} defaultValue={c?.last_order_note} className="field" placeholder="Order by 12 December for delivery before Christmas week." /></div>
      </div>
      <fieldset className="grid gap-2 rounded-md2 border-2 border-line p-4">
        <legend className="px-1 font-bold">Products to feature</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {products.map((p) => <label key={p.slug} className="flex min-h-[44px] items-center gap-3"><input type="checkbox" name="products" value={p.slug} defaultChecked={c?.product_slugs.includes(p.slug)} className="h-5 w-5 accent-[#0B1F33]" />{p.name}</label>)}
        </div>
      </fieldset>
      <fieldset className="grid gap-2 rounded-md2 border-2 border-line p-4">
        <legend className="px-1 font-bold">Templates to feature</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {templates.length === 0 && <p className="text-muted">No templates yet.</p>}
          {templates.map((t) => <label key={t.slug} className="flex min-h-[44px] items-center gap-3"><input type="checkbox" name="templates" value={t.slug} defaultChecked={c?.template_slugs.includes(t.slug)} className="h-5 w-5 accent-[#0B1F33]" />{t.name}</label>)}
        </div>
      </fieldset>
      <label className="flex min-h-[44px] items-center gap-3"><input type="checkbox" name="showOnHome" defaultChecked={c ? c.show_on_home : true} className="h-5 w-5 accent-[#0B1F33]" /><span><span className="block font-bold">Show a banner on the home page while it is live</span><span className="block text-[14px] text-muted">If two pages are live, the first one in the list wins.</span></span></label>
    </>
  );
}
