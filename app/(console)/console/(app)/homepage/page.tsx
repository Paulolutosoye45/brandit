import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { getHome, foundingCount } from '@/lib/homeContent';
import { listCatalog } from '@/lib/catalog';
import { Notice } from '@/components/Bits';
import { saveHomeAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Homepage' };

export default async function HomeEditor(props: { searchParams: Promise<{ e?: string; ok?: string; field?: string }> }) {
  const sp = await props.searchParams;
  await requireStaff('manage_content');
  const [home, catalog, taken] = await Promise.all([getHome(), listCatalog(), foundingCount()]);
  const pos = (slug: string) => { const i = home.featured.indexOf(slug); return i >= 0 ? i + 1 : ''; };
  const bad = (k: string) => (sp.field === k ? { 'aria-invalid': true as const } : {});
  return (
    <div className="grid max-w-[820px] gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-[34px]">Homepage</h1><p className="text-muted">The words at the top, the bar across every page, and which products come first. Leave a box empty to use our usual wording.</p></div><Link href="/" target="_blank" className="btn-secondary btn-sm">Open the homepage</Link></div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      <form action={saveHomeAction} className="grid gap-6">
        <section className="card grid gap-4 p-6">
          <h2 className="text-[22px]">The big words</h2>
          <div><label className="label" htmlFor="headline">Headline</label><input id="headline" name="headline" defaultValue={home.headline} maxLength={70} placeholder="Printing without the hassle." className="field" /><p className="mt-1 text-[14px] text-muted">Short beats clever. Up to 70 letters. Shown in English only: the Pidgin switch keeps our own wording when this is empty.</p></div>
          <div><label className="label" htmlFor="subline">Line under it</label><textarea id="subline" name="subline" rows={3} defaultValue={home.subline} maxLength={220} placeholder="See your price and your delivery time before you pay. Upload a file or let us design it. We check it, print it and bring it to you." className="field py-3" /></div>
        </section>

        <section className="card grid gap-4 p-6">
          <h2 className="text-[22px]">Announcement bar</h2>
          <label className="flex min-h-[44px] items-center gap-3"><input type="checkbox" name="announce_on" defaultChecked={home.announce.on} className="h-5 w-5" /><span className="font-bold">Show a bar across the top of every page</span></label>
          <div><label className="label" htmlFor="announce_text">What it says</label><input id="announce_text" name="announce_text" defaultValue={home.announce.text} maxLength={140} placeholder="Last orders for Christmas cards: Friday 12 December." className="field" {...bad('announce_text')} /></div>
          <div><label className="label" htmlFor="announce_link">Where it goes (optional)</label><input id="announce_link" name="announce_link" defaultValue={home.announce.link} placeholder="/products or https://…" className="field" {...bad('announce_link')} /></div>
        </section>

        <section className="card grid gap-4 p-6">
          <h2 className="text-[22px]">Founding customers counter</h2>
          <p className="text-muted">{taken} {taken === 1 ? 'person has' : 'people have'} ordered and paid so far (each person counts once). When this is on, the homepage shows how many places are left.</p>
          <label className="flex min-h-[44px] items-center gap-3"><input type="checkbox" name="founding_on" defaultChecked={home.founding.on} className="h-5 w-5" /><span className="font-bold">Show the counter on the homepage</span></label>
          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <div><label className="label" htmlFor="founding_limit">Places</label><input id="founding_limit" name="founding_limit" inputMode="numeric" defaultValue={home.founding.limit} className="field" {...bad('founding_limit')} /></div>
            <div><label className="label" htmlFor="founding_perk">What founding customers get</label><input id="founding_perk" name="founding_perk" defaultValue={home.founding.perk} maxLength={140} placeholder="Use code FOUNDING for 10% off." className="field" /></div>
          </div>
        </section>

        <section className="card grid gap-3 p-6">
          <h2 className="text-[22px]">Featured products</h2>
          <p className="text-muted">Tick the products to show first and give each a position (1 is the big tile). Leave all unticked to show them in the usual order.</p>
          <ul className="grid gap-2">
            {catalog.map(({ product: p }) => (
              <li key={p.slug} className="flex flex-wrap items-center gap-3 rounded-md2 border border-line px-3 py-2">
                <label className="flex min-h-[44px] flex-1 items-center gap-3"><input type="checkbox" name="show" value={p.slug} defaultChecked={home.featured.includes(p.slug)} className="h-5 w-5" /><span className="font-medium">{p.name}</span></label>
                <label className="flex items-center gap-2 text-[14px] text-muted">Position<input name={`pos_${p.slug}`} inputMode="numeric" defaultValue={pos(p.slug)} aria-label={`Position of ${p.name}`} className="field !min-h-[40px] w-[72px] !px-3" /></label>
              </li>
            ))}
          </ul>
        </section>
        <button className="btn-primary self-start">Save the homepage</button>
      </form>
    </div>
  );
}
