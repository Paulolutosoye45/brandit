import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { Notice } from '@/components/Bits';
import { query } from '@/lib/db';
import { TemplatePreview } from '@/components/TemplatePreview';
import { getTemplateById, templatePrice, templateProductChoices } from '@/lib/templates';
import { naira } from '@/lib/money';
import { saveTemplateAction, setTemplateActiveAction, clearTemplateImageAction, deleteTemplateAction } from '../actions';
import { TemplateFields } from '../TemplateFields';
import { TemplatePicture } from '../TemplatePicture';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit template' };

export default async function EditTemplate(props: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; ok?: string }> }) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireStaff('manage_templates');
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await getTemplateById(id);
  if (!t) notFound();
  const products = await templateProductChoices();
  const cats = (await query<{ category: string }>("select distinct category from templates where category <> '' order by category")).map((c) => c.category);
  const price = await templatePrice(t).catch(() => null);
  const used = (await query<{ n: number }>('select count(*)::int as n from orders where template_id = $1', [id]))[0]?.n ?? 0;
  return (
    <div className="grid max-w-[760px] gap-6">
      <div>
        <Link href="/console/templates" className="text-[14px] underline text-muted">All templates</Link>
        <h1 className="text-[34px]">{t.title}</h1>
        <p className="flex flex-wrap items-center gap-2 text-muted">
          <span className={`pill ${t.active ? 'bg-good-tint text-good' : 'bg-placeholder text-ink'}`}>{t.active ? 'Live' : 'Hidden'}</span>
          {price ? `${naira(price.printKobo + price.designKobo)} with design` : 'No price yet. Check the product has a price for this quantity.'} · started {used} time{used === 1 ? '' : 's'}
        </p>
      </div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}

      <section className="card grid gap-4 p-5 sm:grid-cols-[160px_1fr]" id="picture">
        <div className="aspect-[4/5] overflow-hidden rounded-md2 bg-paper2">
          {t.image_key
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={`/api/template-images/${t.id}`} alt={`${t.title} sample`} className="h-full w-full object-cover" />
            : <TemplatePreview look={t.look} title={t.title} />}
        </div>
        <div className="grid content-start gap-3">
          <h2 className="text-[20px]">Preview picture</h2>
          <TemplatePicture id={t.id} hasImage={!!t.image_key} />
          {t.image_key && <form action={clearTemplateImageAction}><input type="hidden" name="id" value={t.id} /><button className="btn-ghost btn-sm">Remove picture</button></form>}
        </div>
      </section>

      <form action={saveTemplateAction} className="card grid gap-5 p-5">
        <input type="hidden" name="id" value={t.id} />
        <input type="hidden" name="slug" value={t.slug} />
        <TemplateFields t={t} products={products} categories={cats} />
        <div className="flex flex-wrap gap-3"><button className="btn-primary">Save changes</button>
          <Link href={`/templates/${t.slug}`} className="btn-secondary" target="_blank" rel="noopener">See it as a customer</Link></div>
      </form>

      <section className="card grid gap-3 p-5">
        <h2 className="text-[20px]">{t.active ? 'Hide this template' : 'Make this template live'}</h2>
        <p className="text-muted">{t.active ? 'Customers will no longer see it. Orders already started are not affected.' : 'Customers will see it in the gallery and on the home page.'}</p>
        <form action={setTemplateActiveAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="on" value={t.active ? '0' : '1'} /><input type="hidden" name="back" value="edit" /><button className={t.active ? 'btn-secondary' : 'btn-primary'}>{t.active ? 'Hide' : 'Make live'}</button></form>
      </section>

      <section className="card grid gap-3 p-5">
        <h2 className="text-[20px]">Delete this template</h2>
        <p className="text-muted">This cannot be undone. Hiding it is usually enough.</p>
        <form action={deleteTemplateAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={t.id} />
          <div><label className="label" htmlFor="confirm">Type delete to confirm</label><input id="confirm" name="confirm" className="field" autoComplete="off" /></div>
          <button className="btn-secondary">Delete template</button>
        </form>
      </section>
    </div>
  );
}
