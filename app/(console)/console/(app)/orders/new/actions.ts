'use server';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { buildOrderFromBasket, type LineFile } from '@/lib/staffOrder';
import { trail } from '@/lib/trail';

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '');

export async function buildOrderAction(fd: FormData) {
  const staff = await requireStaff('build_order');
  const files: Record<string, LineFile> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith('file_') && (v === 'later' || v === 'design')) files[k.slice(5)] = v;
  const keep = new URLSearchParams();
  for (const k of ['name', 'phone', 'email', 'area', 'address', 'note']) if (s(fd, k)) keep.set(k, s(fd, k));
  if (fd.get('pickup') === 'on') keep.set('pickup', '1');
  const r = await buildOrderFromBasket({ id: staff.id, name: staff.name }, {
    name: s(fd, 'name'), phone: s(fd, 'phone'), email: s(fd, 'email'), pickup: fd.get('pickup') === 'on', area: s(fd, 'area') || undefined, addressLine: s(fd, 'address'),
    files, designNote: s(fd, 'design_note'), note: s(fd, 'note'), send: fd.get('send') === 'on',
  });
  if (!r.ok) {
    keep.set('e', r.error);
    redirect(`/console/orders/new?${keep.toString()}`);
  }
  await trail({ area: 'order', action: 'order_built', target: r.code, summary: `Built order ${r.code} from a WhatsApp chat`, detail: { total_kobo: r.totalKobo } });
  redirect(`/console/orders/${r.code}?ok=${encodeURIComponent('Order built. Send the customer the pay link below. It starts the moment they pay.')}`);
}
