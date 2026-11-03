'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { query } from '@/lib/db';
import { OPTIONAL } from '@/lib/outbox';

const n = (fd: FormData, k: string) => Number(String(fd.get(k) ?? ''));
const done = (m: { e?: string; ok?: string }): never => {
  revalidatePath('/console', 'layout');
  redirect(`/console/whatsapp?${m.e ? `e=${encodeURIComponent(m.e)}` : `ok=${encodeURIComponent(m.ok ?? 'Done.')}`}`);
};

const who = async () => (await requireStaff('see_contact')).name.split(' (')[0];

/** Called the moment someone taps "Send on WhatsApp": WhatsApp is open in front of them, so the message is theirs now. */
export async function markOpenedAction(id: number): Promise<void> {
  const name = await who();
  await query("update messages set status = 'sent', sent_at = now(), handled_by = $2 where id = $1 and channel = 'whatsapp_manual' and status = 'to_send'", [Number(id), name]);
  revalidatePath('/console', 'layout');
}

/** "I already sent that one" (for example from the phone, or from the chat the customer started). */
export async function alreadySentAction(fd: FormData) {
  const name = await who();
  const r = await query("update messages set status = 'sent', sent_at = now(), handled_by = $2 where id = $1 and channel = 'whatsapp_manual' and status = 'to_send' returning id", [n(fd, 'id'), name]);
  done(r.length ? { ok: 'Marked as sent.' } : { e: 'That message is not waiting any more.' });
}

export async function skipAction(fd: FormData) {
  const name = await who();
  const r = await query("update messages set status = 'dismissed', sent_at = now(), handled_by = $2 where id = $1 and channel = 'whatsapp_manual' and status = 'to_send' returning id", [n(fd, 'id'), name]);
  done(r.length ? { ok: 'Skipped. It will not be sent.' } : { e: 'That message is not waiting any more.' });
}

export async function skipOptionalAction() {
  const name = await who();
  const r = await query("update messages set status = 'dismissed', sent_at = now(), handled_by = $2 where audience = 'customer' and channel = 'whatsapp_manual' and status = 'to_send' and template = any($1::text[]) returning id", [[...OPTIONAL], name]);
  done({ ok: r.length ? `Skipped ${r.length} reminder${r.length === 1 ? '' : 's'} and offer${r.length === 1 ? '' : 's'}.` : 'Nothing to skip.' });
}

/** Undo: it was marked sent or skipped by mistake. */
export async function putBackAction(fd: FormData) {
  await who();
  const r = await query("update messages set status = 'to_send', sent_at = null, handled_by = null where id = $1 and channel = 'whatsapp_manual' and status in ('sent','dismissed') and created_at > now() - interval '3 days' returning id", [n(fd, 'id')]);
  done(r.length ? { ok: 'Put back in the list.' } : { e: 'That one is too old to send now.' });
}
