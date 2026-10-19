'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { query, one } from '@/lib/db';
import { audit } from '@/lib/audit';
import { isPolicySlug, restoreVersion, revertPage, savePage } from '@/lib/contentPages';

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '');
const refresh = () => { revalidatePath('/faq'); revalidatePath('/legal', 'layout'); };

// ---------- Policy pages ----------
function pageBack(slug: string, m: { e?: string; ok?: string }): never {
  revalidatePath(`/console/pages/${slug}`);
  redirect(`/console/pages/${slug}?${m.e ? `e=${encodeURIComponent(m.e)}` : `ok=${encodeURIComponent(m.ok ?? 'Saved.')}`}`);
}
export async function savePageAction(fd: FormData) {
  const staff = await requireStaff('manage_content');
  const slug = s(fd, 'slug');
  if (!isPolicySlug(slug)) redirect('/console/pages');
  const r = await savePage({ id: staff.id, name: staff.name }, slug, { title: s(fd, 'title'), body: s(fd, 'body'), note: s(fd, 'note') });
  if (!r.ok) pageBack(slug, { e: r.error });
  refresh();
  pageBack(slug, { ok: 'Published. The site now shows your version. The earlier one is kept in the history below.' });
}
export async function revertPageAction(fd: FormData) {
  const staff = await requireStaff('manage_content');
  const slug = s(fd, 'slug');
  if (!isPolicySlug(slug)) redirect('/console/pages');
  await revertPage({ id: staff.id, name: staff.name }, slug);
  refresh();
  pageBack(slug, { ok: 'The site shows the built-in version again. Your versions are still in the history.' });
}
export async function restoreVersionAction(fd: FormData) {
  const staff = await requireStaff('manage_content');
  const slug = s(fd, 'slug');
  if (!isPolicySlug(slug)) redirect('/console/pages');
  const r = await restoreVersion({ id: staff.id, name: staff.name }, slug, Number(s(fd, 'version')));
  if (!r.ok) pageBack(slug, { e: r.error });
  refresh();
  pageBack(slug, { ok: 'That version is live again.' });
}

// ---------- FAQ ----------
function faqBack(m: { e?: string; ok?: string }, hash = ''): never {
  revalidatePath('/console/pages/faq');
  redirect(`/console/pages/faq?${m.e ? `e=${encodeURIComponent(m.e)}` : `ok=${encodeURIComponent(m.ok ?? 'Saved.')}`}${hash}`);
}
const clean = (v: string, n: number) => v.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, n);

/** Change the wording of a built-in answer, or an answer the team added. */
export async function saveFaqAction(fd: FormData) {
  const staff = await requireStaff('manage_content');
  const who = { id: staff.id, name: staff.name };
  const key = s(fd, 'key'), rowId = s(fd, 'row');
  const question = clean(s(fd, 'question'), 200), answer = clean(s(fd, 'answer'), 1500);
  if (question.length < 5 || answer.length < 5) return faqBack({ e: 'Both the question and the answer need some words.' }, `#q-${key}`);
  if (rowId) {
    const r = await one<{ id: string }>('update faq_items set question = $2, answer = $3, hidden = false, updated_at = now(), updated_by = $4 where id = $1 returning id', [rowId, question, answer, staff.name]);
    if (!r) return faqBack({ e: 'That question was not found.' });
  } else {
    await query(
      `insert into faq_items (key, group_id, question, answer, updated_by) values ($1, $2, $3, $4, $5)
       on conflict (key) where key is not null do update set question = excluded.question, answer = excluded.answer, hidden = false, updated_at = now(), updated_by = excluded.updated_by`,
      [key, s(fd, 'group') || 'ordering', question, answer, staff.name],
    );
  }
  await audit(who, { area: 'content', action: 'faq_saved', target: question, summary: 'Changed a FAQ answer' });
  refresh();
  faqBack({ ok: 'Saved. The FAQ page shows it now.' }, `#q-${key}`);
}

export async function hideFaqAction(fd: FormData) {
  const staff = await requireStaff('manage_content');
  const key = s(fd, 'key'), hide = s(fd, 'hide') === '1';
  const q = clean(s(fd, 'question'), 200);
  await query(
    `insert into faq_items (key, group_id, question, answer, hidden, updated_by) values ($1, $2, '', '', $3, $4)
     on conflict (key) where key is not null do update set hidden = excluded.hidden, updated_at = now(), updated_by = excluded.updated_by`,
    [key, s(fd, 'group') || 'ordering', hide, staff.name],
  );
  await audit({ id: staff.id, name: staff.name }, { area: 'content', action: hide ? 'faq_hidden' : 'faq_shown', target: q, summary: hide ? 'Hid a FAQ question' : 'Showed a FAQ question again' });
  refresh();
  faqBack({ ok: hide ? 'Hidden from the FAQ page.' : 'Showing on the FAQ page again.' }, `#q-${key}`);
}

/** Put a built-in answer back to the wording in the code. */
export async function resetFaqAction(fd: FormData) {
  const staff = await requireStaff('manage_content');
  await query('delete from faq_items where key = $1', [s(fd, 'key')]);
  await audit({ id: staff.id, name: staff.name }, { area: 'content', action: 'faq_reset', target: s(fd, 'key'), summary: 'Put a FAQ answer back to the built-in wording' });
  refresh();
  faqBack({ ok: 'Back to the built-in wording.' }, `#q-${s(fd, 'key')}`);
}

export async function addFaqAction(fd: FormData) {
  const staff = await requireStaff('manage_content');
  const question = clean(s(fd, 'question'), 200), answer = clean(s(fd, 'answer'), 1500);
  if (question.length < 5 || answer.length < 5) return faqBack({ e: 'Write both the question and the answer.' }, '#add');
  const n = (await one<{ n: number }>('select coalesce(max(position), 0)::int + 1 as n from faq_items'))?.n ?? 1;
  await query('insert into faq_items (key, group_id, question, answer, position, updated_by) values (null, $1, $2, $3, $4, $5)', [s(fd, 'group') || 'ordering', question, answer, n, staff.name]);
  await audit({ id: staff.id, name: staff.name }, { area: 'content', action: 'faq_added', target: question, summary: 'Added a FAQ question' });
  refresh();
  faqBack({ ok: 'Added to the FAQ page.' }, '#add');
}

export async function deleteFaqAction(fd: FormData) {
  const staff = await requireStaff('manage_content');
  const r = await one<{ question: string }>('delete from faq_items where id = $1 and key is null returning question', [s(fd, 'row')]);
  if (r) await audit({ id: staff.id, name: staff.name }, { area: 'content', action: 'faq_deleted', target: r.question, summary: 'Deleted a FAQ question the team had added' });
  refresh();
  faqBack({ ok: 'Deleted.' });
}

