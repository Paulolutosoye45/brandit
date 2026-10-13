import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { listTemplates, templatePrice } from '@/lib/templates';
import { Notice } from '@/components/Bits';
import { TemplatePreview } from '@/components/TemplatePreview';
import { naira } from '@/lib/money';
import { setTemplateActiveAction, moveTemplateAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Templates' };

export default async function Templates(props: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const sp = await props.searchParams;
  await requireStaff('manage_templates');
  const rows = await listTemplates({ all: true });
  const prices = await Promise.all(rows.map((t) => templatePrice(t).catch(() => null)));
  const live = rows.filter((t) => t.active).length;
  return (
    <div className="grid max-w-[980px] gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[34px]">Templates</h1>
          <p className="text-muted">{live} live, {rows.length - live} hidden. A template is a ready-made starting point: the customer answers a few questions, and a designer makes the real design from the answers.</p>
        </div>
        <Link href="/console/templates/new" className="btn-primary">Add a template</Link>
      </div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      <ul className="grid gap-3">
        {rows.map((t, i) => {
          const p = prices[i];
          const blocked = t.active && !t.product_active;
          return (
            <li key={t.id} className="card flex flex-wrap items-center gap-3 p-3 sm:gap-4 sm:p-4">
              <Link href={`/console/templates/${t.id}`} className="grid h-24 w-[72px] shrink-0 place-items-center overflow-hidden rounded-sm2 bg-paper2" aria-label={`Edit ${t.title}`}>
                {t.image_key
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={`/api/template-images/${t.id}`} alt="" width={72} height={96} className="h-full w-full object-cover" loading="lazy" />
                  : <TemplatePreview look={t.look} title={t.title} />}
              </Link>
              <div className="min-w-0 flex-1 basis-48">
                <Link href={`/console/templates/${t.id}`} className="block text-[19px] font-bold leading-tight hover:underline">{t.title}</Link>
                <p className="text-[14px] text-muted">{t.category || 'No group'} · {t.product_name}{p ? ` · ${naira(p.printKobo + p.designKobo)} with design` : ' · price not available'}</p>
                <p className="mt-1 flex flex-wrap gap-2">
                  <span className={`pill ${t.active ? 'bg-good-tint text-good' : 'bg-placeholder text-ink'}`}>{t.active ? 'Live' : 'Hidden'}</span>
                  {blocked && <span className="pill bg-warn-tint text-warn">Product is hidden, so customers cannot see this</span>}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/console/templates/${t.id}`} className="btn-secondary btn-sm">Edit</Link>
                <form action={setTemplateActiveAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="on" value={t.active ? '0' : '1'} /><button className="btn-ghost btn-sm">{t.active ? 'Hide' : 'Make live'}</button></form>
                <form action={moveTemplateAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="dir" value="up" /><button className="btn-ghost btn-sm" aria-label={`Move ${t.title} earlier`} disabled={i === 0}>↑ Up</button></form>
                <form action={moveTemplateAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="dir" value="down" /><button className="btn-ghost btn-sm" aria-label={`Move ${t.title} later`} disabled={i === rows.length - 1}>↓ Down</button></form>
              </div>
            </li>
          );
        })}
        {rows.length === 0 && <li className="card p-8 text-center text-muted">No templates yet. Add the first one.</li>}
      </ul>
      <p className="text-[13px] text-muted">The order here is the order customers see.</p>
    </div>
  );
}
