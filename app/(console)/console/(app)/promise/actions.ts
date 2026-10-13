'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { resolveClaim, type Resolution } from '@/lib/claims';

export async function decide(fd: FormData) {
  const staff = await requireStaff('claims');
  const resolution = String(fd.get('resolution')) as Resolution;
  const amount = String(fd.get('amount') ?? '').replace(/[^\d.]/g, '');
  let err: string | null = null;
  try {
    if (!['reprint', 'refund', 'rejected'].includes(resolution)) throw new Error('Choose what to do.');
    await resolveClaim(String(fd.get('id')), staff, { resolution, note: String(fd.get('note') ?? ''), amountKobo: amount ? Math.round(Number(amount) * 100) : undefined });
  } catch (e) {
    err = (e as Error).message;
  }
  revalidatePath('/console/promise');
  redirect(`/console/promise?${err ? `e=${encodeURIComponent(err)}` : 'ok=Decision recorded and the customer has been told.'}`);
}
