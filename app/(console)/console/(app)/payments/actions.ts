'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { consoleRefund, reconcilePayment } from '@/lib/paymentsAdmin';
import { parseNaira } from '@/lib/custom';

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '');

/** Where to go back to: the payments list, or the order page the button was on. Only our own console paths are allowed. */
function dest(fd: FormData, m: { e?: string; ok?: string }): string {
  const raw = s(fd, 'return');
  const base = /^\/console\/(payments|orders\/[A-Za-z0-9-]{3,40})$/.test(raw) ? raw : '/console/payments';
  return `${base}?${m.e ? `e=${encodeURIComponent(m.e)}` : `ok=${encodeURIComponent(m.ok ?? 'Done.')}`}${base.startsWith('/console/orders') ? '#money' : ''}`;
}

export async function refundAction(fd: FormData) {
  const staff = await requireStaff('refund');
  const kobo = parseNaira(s(fd, 'amount'));
  const r = kobo == null ? { ok: false as const, error: 'Enter the amount in naira, like 2,500.' } : await consoleRefund({ id: staff.id, name: staff.name, role: staff.role }, { paymentId: s(fd, 'payment'), amountKobo: kobo, reason: s(fd, 'reason'), note: s(fd, 'note') });
  revalidatePath('/console/payments');
  redirect(dest(fd, r.ok ? { ok: r.message } : { e: r.error }));
}

export async function reconcileAction(fd: FormData) {
  const staff = await requireStaff('see_payments');
  const r = await reconcilePayment({ id: staff.id, name: staff.name }, s(fd, 'payment'));
  revalidatePath('/console/payments');
  redirect(dest(fd, r.ok ? { ok: r.message } : { e: r.error }));
}
