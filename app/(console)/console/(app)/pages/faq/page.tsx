import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import { getBusiness } from '@/lib/business';
import { builtInFaq, editableFaq, faqRows } from '@/lib/faqContent';
import { Notice } from '@/components/Bits';
import { addFaqAction, deleteFaqAction, hideFaqAction, resetFaqAction, saveFaqAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit the FAQ' };

export default async function FaqEditor(props: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const sp = await props.searchParams;
  await requireStaff('manage_content');
  const [s, c, rows] = await Promise.all([getSettings(), getBusiness(), faqRows()]);
  const groups = builtInFaq(s, c);
  const items = editableFaq(groups, rows);
  return (
    <div className="grid max-w-[860px] gap-6">
      <div><Link href="/console/pages" className="inline-flex min-h-[44px] items-center text-[15px] font-bold text-muted hover:text-ink">← FAQ and policies</Link></div>
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-[34px]">Questions and answers</h1><p className="text-muted">Change an answer, hide one you do not want, or add your own. Built-in answers that quote a fee or a time keep themselves up to date until you change their wording.</p></div><Link href="/faq" target="_blank" className="btn-secondary btn-sm">View the FAQ</Link></div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}

      <section id="add" className="card grid gap-3 p-6">
        <h2 className="text-[22px]">Add a question</h2>
        <form action={addFaqAction} className="grid gap-3">
          <div><label className="label" htmlFor="new-group">Where it goes</label><select id="new-group" name="group" className="field">{groups.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select></div>
          <div><label className="label" htmlFor="new-q">Question</label><input id="new-q" name="question" maxLength={200} className="field" required /></div>
          <div><label className="label" htmlFor="new-a">Answer</label><textarea id="new-a" name="answer" rows={3} maxLength={1500} className="field py-3" required /></div>
          <button className="btn-dark self-start">Add it</button>
        </form>
      </section>

      {groups.map((g) => (
        <section key={g.id} className="grid gap-2" aria-labelledby={`g-${g.id}`}>
          <h2 id={`g-${g.id}`} className="text-[22px]">{g.title}</h2>
          {items.filter((i) => i.groupId === g.id).map((i) => (
            <details key={i.key} id={`q-${i.key}`} className={`card group p-0 ${i.hidden ? 'opacity-70' : ''}`}>
              <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-bold [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">{i.q}{i.custom && <span className="pill ml-2 bg-accent-tint text-ink">Added by you</span>}{i.edited && <span className="pill ml-2 bg-warn-tint text-warn">Your wording</span>}{i.hidden && <span className="pill ml-2 bg-placeholder text-ink">Hidden</span>}</span>
                <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-paper2 text-[20px] leading-none group-open:rotate-45">+</span>
              </summary>
              <div className="grid gap-3 border-t border-line px-5 py-4">
                <form action={saveFaqAction} className="grid gap-3">
                  <input type="hidden" name="key" value={i.key} /><input type="hidden" name="row" value={i.custom ? (i.rowId ?? '') : (i.rowId ?? '')} /><input type="hidden" name="group" value={i.groupId} />
                  <div><label className="label" htmlFor={`q-in-${i.key}`}>Question</label><input id={`q-in-${i.key}`} name="question" defaultValue={i.q} maxLength={200} className="field" /></div>
                  <div><label className="label" htmlFor={`a-in-${i.key}`}>Answer</label><textarea id={`a-in-${i.key}`} name="answer" rows={4} defaultValue={i.a} maxLength={1500} className="field py-3" /></div>
                  <button className="btn-dark self-start">Save this answer</button>
                </form>
                <div className="flex flex-wrap gap-2">
                  {!i.custom && (
                    <form action={hideFaqAction}><input type="hidden" name="key" value={i.key} /><input type="hidden" name="group" value={i.groupId} /><input type="hidden" name="question" value={i.q} /><input type="hidden" name="hide" value={i.hidden ? '0' : '1'} /><button className="btn-secondary btn-sm">{i.hidden ? 'Show again' : 'Hide this question'}</button></form>
                  )}
                  {!i.custom && i.rowId && !i.hidden && <form action={resetFaqAction}><input type="hidden" name="key" value={i.key} /><button className="btn-secondary btn-sm">Back to the built-in wording</button></form>}
                  {i.custom && <form action={deleteFaqAction}><input type="hidden" name="row" value={i.rowId ?? ''} /><button className="btn-secondary btn-sm">Delete</button></form>}
                </div>
              </div>
            </details>
          ))}
        </section>
      ))}
    </div>
  );
}
