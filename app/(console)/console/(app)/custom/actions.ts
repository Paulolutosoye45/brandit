'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { declineRequest, quoteRequest } from '@/lib/custom';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');
const back = (id: string, msg: { e?: string; ok?: string }): never => {
  revalidatePath('/console/custom');
  revalidatePath(`/console/custom/${id}`);
  redirect(`/console/custom/${id}?${msg.e ? `e=${encodeURIComponent(msg.e)}` : `ok=${encodeURIComponent(msg.ok ?? 'Saved.')}`}`);
};

export async function quoteAction(fd: FormData) {
  const staff = await requireStaff('quote_custom');
  const id = str(fd, 'id');
  const r = await quoteRequest(id, staff.id, { price: str(fd, 'price'), days: str(fd, 'days'), validDays: str(fd, 'valid_days'), note: str(fd, 'note') });
  back(id, r.ok ? { ok: 'Price sent. The customer has a message with a link to accept it.' } : { e: r.error });
}

export async function declineAction(fd: FormData) {
  await requireStaff('quote_custom');
  const id = str(fd, 'id');
  const r = await declineRequest(id, str(fd, 'reason'));
  back(id, r.ok ? { ok: 'Declined. The customer has been told why.' } : { e: r.error });
}
