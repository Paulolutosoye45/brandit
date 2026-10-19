'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { normalizePhone } from '@/lib/phone';
import { sendStaffNow, flushMessages } from '@/lib/messages';
import { query } from '@/lib/db';
import { limited } from '@/lib/ratelimit';
import { audit } from '@/lib/audit';
import { TEMPLATES, type TemplateKey } from '@/content/messages';
import { sampleVars } from '@/lib/messageCatalog';

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '');
const back = (m: { e?: string; ok?: string }, hash = ''): never => {
  revalidatePath('/console/messages');
  redirect(`/console/messages?${m.e ? `e=${encodeURIComponent(m.e)}` : `ok=${encodeURIComponent(m.ok ?? 'Done.')}`}${hash}`);
};

export async function testMessageAction(fd: FormData) {
  const staff = await requireStaff('manage_content');
  const key = s(fd, 'template') as TemplateKey;
  if (!TEMPLATES[key]) return back({ e: 'That message was not found.' });
  const phone = normalizePhone(s(fd, 'phone'));
  if (!phone) return back({ e: 'Enter your own mobile number, like 0803 123 4567.' }, `#t-${key}`);
  if (limited(`msgtest:${staff.id}`, 6, 10 * 60_000)) return back({ e: 'That is enough tests for now. Wait a few minutes.' }, `#t-${key}`);
  const r = await sendStaffNow(phone, key, sampleVars(key));
  await audit({ id: staff.id, name: staff.name }, { area: 'settings', action: 'message_test', target: key, summary: `Sent a test of “${key.replace(/_/g, ' ')}”${r.ok ? ` by ${r.channel}` : ' (it did not send)'}` });
  if (r.ok) return back({ ok: `Sent by ${r.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} to ${phone}.${r.error ? ` Note: ${r.error}` : ''}` }, `#t-${key}`);
  return back({ e: `Not sent: ${r.error ?? 'unknown problem'}. ${r.error?.includes('Neither') ? 'Connect WhatsApp or SMS first (Connections).' : ''}` }, `#t-${key}`);
}

export async function retryMessageAction(fd: FormData) {
  const staff = await requireStaff('manage_content');
  const id = Number(s(fd, 'id'));
  const r = await query<{ id: number }>("update messages set status = 'queued', error = null where id = $1 and status = 'failed' returning id", [id]);
  if (!r.length) return back({ e: 'That message is not waiting to be retried.' }, '#log');
  await flushMessages();
  await audit({ id: staff.id, name: staff.name }, { area: 'order', action: 'message_retry', target: String(id), summary: 'Retried a message that failed' });
  back({ ok: 'Tried again. Look at its status in the list.' }, '#log');
}
