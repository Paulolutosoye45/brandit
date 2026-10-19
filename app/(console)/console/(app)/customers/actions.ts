'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { addNote, deleteNote } from '@/lib/customers';

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '');
const back = (id: string, m: { e?: string; ok?: string }): never => {
  revalidatePath(`/console/customers/${id}`);
  redirect(`/console/customers/${id}?${m.e ? `e=${encodeURIComponent(m.e)}` : `ok=${encodeURIComponent(m.ok ?? 'Saved.')}`}#notes`);
};

export async function addNoteAction(fd: FormData) {
  const staff = await requireStaff('see_customers');
  const id = s(fd, 'id');
  const r = await addNote(id, { id: staff.id, name: staff.name }, s(fd, 'body'));
  if (!r.ok) back(id, { e: r.error });
  back(id, { ok: 'Note saved. Customers never see notes.' });
}

export async function deleteNoteAction(fd: FormData) {
  const staff = await requireStaff('see_customers');
  await deleteNote(s(fd, 'note'), { id: staff.id, name: staff.name });
  back(s(fd, 'id'), { ok: 'Note deleted.' });
}
