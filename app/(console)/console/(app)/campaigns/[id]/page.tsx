import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { Notice } from '@/components/Bits';
import { listProducts } from '@/lib/catalog';
import { listTemplates } from '@/lib/templates';
import { getCampaignById, lagosToday } from '@/lib/campaigns';
import { phaseOf } from '@/lib/campaignCore';
import { saveCampaignAction, setCampaignActiveAction, deleteCampaignAction } from '../actions';
import { CampaignFields } from '../CampaignFields';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit seasonal page' };

export default async function EditCampaign(props: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; ok?: string }> }) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireStaff('manage_campaigns');
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const c = await getCampaignById(id);
  if (!c) notFound();
  const [products, templates] = await Promise.all([listProducts(), listTemplates({ all: true })]);
  const ph = phaseOf(c, lagosToday());
  return (
    <div className="grid max-w-[760px] gap-6">
      <div>
        <Link href="/console/campaigns" className="text-[14px] underline text-muted">All seasonal pages</Link>
        <h1 className="text-[34px]">{c.title}</h1>
        <p className="text-muted">{ph === 'live' ? 'Live now.' : ph === 'upcoming' ? 'Switched on. It goes live on its first day.' : ph === 'ended' ? 'Its dates have passed. Change the dates to run it again.' : 'Switched off. Customers cannot see it.'} Address: <code>/season/{c.slug}</code></p>
      </div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      <form action={saveCampaignAction} className="card grid gap-5 p-5">
        <input type="hidden" name="id" value={c.id} /><input type="hidden" name="slug" value={c.slug} />
        <CampaignFields c={c} products={products.map((p) => ({ slug: p.slug, name: p.name }))} templates={templates.map((t) => ({ slug: t.slug, name: t.title }))} />
        <div className="flex flex-wrap gap-3"><button className="btn-primary">Save changes</button><Link href={`/season/${c.slug}`} target="_blank" rel="noopener" className="btn-secondary">See it as a customer</Link></div>
      </form>
      <section className="card grid gap-3 p-5">
        <h2 className="text-[20px]">{c.active ? 'Switch this page off' : 'Switch this page on'}</h2>
        <p className="text-muted">{c.active ? 'Customers will not see it, even on its dates.' : 'Customers will see it on its dates.'}</p>
        <form action={setCampaignActiveAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="on" value={c.active ? '0' : '1'} /><input type="hidden" name="back" value="edit" /><button className={c.active ? 'btn-secondary' : 'btn-primary'}>{c.active ? 'Switch off' : 'Switch on'}</button></form>
      </section>
      <section className="card grid gap-3 p-5">
        <h2 className="text-[20px]">Delete this page</h2>
        <form action={deleteCampaignAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={c.id} />
          <div><label className="label" htmlFor="confirm">Type delete to confirm</label><input id="confirm" name="confirm" className="field" autoComplete="off" /></div>
          <button className="btn-secondary">Delete page</button>
        </form>
      </section>
    </div>
  );
}
