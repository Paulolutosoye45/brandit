import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { Notice } from '@/components/Bits';
import { listProducts } from '@/lib/catalog';
import { listTemplates } from '@/lib/templates';
import { createCampaignAction } from '../actions';
import { CampaignFields } from '../CampaignFields';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Add a seasonal page' };

export default async function NewCampaign(props: { searchParams: Promise<{ e?: string }> }) {
  const sp = await props.searchParams;
  await requireStaff('manage_campaigns');
  const [products, templates] = await Promise.all([listProducts(), listTemplates({ all: true })]);
  return (
    <div className="grid max-w-[760px] gap-6">
      <div><Link href="/console/campaigns" className="text-[14px] underline text-muted">All seasonal pages</Link><h1 className="text-[34px]">Add a seasonal page</h1><p className="text-muted">It stays switched off until you are ready.</p></div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      <form action={createCampaignAction} className="card grid gap-5 p-5">
        <CampaignFields products={products.map((p) => ({ slug: p.slug, name: p.name }))} templates={templates.map((t) => ({ slug: t.slug, name: t.title }))} />
        <div className="flex flex-wrap gap-3"><button className="btn-primary">Create and continue</button><Link href="/console/campaigns" className="btn-ghost">Cancel</Link></div>
      </form>
    </div>
  );
}
