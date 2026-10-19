'use server';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { changeOwnPin } from '@/lib/team';
import { limited } from '@/lib/ratelimit';
import { trail } from '@/lib/trail';

export async function changePinAction(fd: FormData) {
  const me = await requireStaff();
  if (limited(`pin:${me.id}`, 6, 15 * 60_000)) redirect('/console/me?e=Too+many+tries.+Wait+15+minutes.');
  const next = String(fd.get('next') ?? '');
  if (next !== String(fd.get('again') ?? '')) redirect('/console/me?e=The+two+new+PINs+do+not+match.');
  const r = await changeOwnPin(me.id, String(fd.get('current') ?? ''), next);
  if (!r.ok) redirect(`/console/me?e=${encodeURIComponent(r.error)}`);
  await trail({ area: 'security', action: 'pin_changed', target: me.name, summary: `${me.name} changed their own PIN` });
  redirect('/console/me?ok=Your+PIN+is+changed.+Use+it+next+time+you+sign+in.');
}
