import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { Notice } from '@/components/Bits';
import { query } from '@/lib/db';
import { createTemplateAction } from '../actions';
import { TemplateFields } from '../TemplateFields';
import { templateProductChoices } from '@/lib/templates';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Add a template' };

export default async function NewTemplate(props: { searchParams: Promise<{ e?: string }> }) {
  const sp = await props.searchParams;
  await requireStaff('manage_templates');
  const products = await templateProductChoices();
  const cats = (await query<{ category: string }>("select distinct category from templates where category <> '' order by category")).map((c) => c.category);
  return (
    <div className="grid max-w-[760px] gap-6">
      <div><Link href="/console/templates" className="text-[14px] underline text-muted">All templates</Link><h1 className="text-[34px]">Add a template</h1><p className="text-muted">Choose the product, write the questions, and pick how the preview looks. It stays hidden until you switch it on.</p></div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      <form action={createTemplateAction} className="card grid gap-5 p-5">
        <TemplateFields products={products} categories={cats} />
        <div className="flex flex-wrap gap-3"><button className="btn-primary">Create and continue</button><Link href="/console/templates" className="btn-ghost">Cancel</Link></div>
      </form>
    </div>
  );
}
