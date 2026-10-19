import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { POLICY_PAGES, isPolicySlug, pageOverride, pageVersions, PLACEHOLDERS } from '@/lib/contentPages';
import { describeWhen } from '@/lib/time';
import { Notice } from '@/components/Bits';
import { restoreVersionAction, revertPageAction, savePageAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit page' };

export default async function EditPage(props: { params: Promise<{ slug: string }>; searchParams: Promise<{ e?: string; ok?: string }> }) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  await requireStaff('manage_content');
  if (!isPolicySlug(slug)) notFound();
  const meta = POLICY_PAGES.find((p) => p.slug === slug)!;
  const [mine, versions] = await Promise.all([pageOverride(slug), pageVersions(slug)]);
  return (
    <div className="grid max-w-[860px] gap-6">
      <div><Link href="/console/pages" className="inline-flex min-h-[44px] items-center text-[15px] font-bold text-muted hover:text-ink">← FAQ and policies</Link></div>
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-[34px]">{meta.title}</h1><p className="text-muted">{mine ? `Your version is live (saved ${describeWhen(new Date(mine.updated_at))} by ${mine.updated_by}).` : 'The built-in version is live. Nothing here changes until you press Publish.'}</p></div><Link href={meta.path} target="_blank" className="btn-secondary btn-sm">View on the site</Link></div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      <form action={savePageAction} className="card grid gap-4 p-6">
        <input type="hidden" name="slug" value={slug} />
        <div><label className="label" htmlFor="title">Page title</label><input id="title" name="title" defaultValue={mine?.title ?? meta.title} maxLength={120} className="field" required /></div>
        <div>
          <label className="label" htmlFor="body">The page</label>
          <textarea id="body" name="body" rows={22} defaultValue={mine?.body ?? ''} className="field py-3 font-mono text-[15px] leading-relaxed" placeholder={'## 1. Who we are\n\nWrite the first section here.\n\n- A short list\n- Looks like this\n\n## 2. The next section'} required />
          <details className="mt-2 text-[14px] text-muted"><summary className="min-h-[44px] cursor-pointer font-bold">How to write it</summary>
            <ul className="mt-2 grid list-disc gap-1 pl-5"><li><code>## Heading</code> starts a numbered section; <code>### Smaller heading</code> for a sub-heading.</li><li>A line starting <code>- </code> is a bullet; <code>1. </code> a numbered step. A blank line starts a new paragraph.</li><li><code>**bold**</code>, <code>*italic*</code>, <code>[link words](/faq)</code> or <code>[link words](https://…)</code>.</li><li>These fill in from Business details: {PLACEHOLDERS.map((p) => <code key={p} className="mr-1">{`{{${p}}}`}</code>)}</li></ul>
          </details>
        </div>
        <div><label className="label" htmlFor="note">What changed (kept in the history)</label><input id="note" name="note" maxLength={140} placeholder="For example: wording from our lawyer, 20 Oct" className="field" /></div>
        <button className="btn-primary self-start">Publish this version</button>
      </form>
      {mine && (
        <form action={revertPageAction} className="card flex flex-wrap items-center justify-between gap-3 p-5"><input type="hidden" name="slug" value={slug} /><p className="max-w-[460px] text-[15px] text-muted">Show the built-in version again. Your versions stay in the history, so you can put one back.</p><button className="btn-secondary btn-sm">Go back to the built-in version</button></form>
      )}
      <section className="grid gap-3"><h2 className="text-[22px]">History</h2>
        {versions.length === 0 ? <p className="text-muted">Nothing published yet.</p> : (
          <ul className="card divide-y divide-line">
            {versions.map((v, i) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div><p className="font-bold">{describeWhen(new Date(v.saved_at))} · {v.saved_by}{i === 0 && mine ? ' · live now' : ''}</p><p className="text-[14px] text-muted">{v.note || `${v.body.length.toLocaleString('en-NG')} letters`}</p></div>
                {!(i === 0 && mine && mine.body === v.body) && <form action={restoreVersionAction}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="version" value={v.id} /><button className="btn-secondary btn-sm">Put this one back</button></form>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
