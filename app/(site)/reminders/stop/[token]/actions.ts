'use server';
import { redirect } from 'next/navigation';
import { stopByToken } from '@/lib/reminders';

/** Stopping needs no sign-in: the link in the message is the proof. It takes a tap, so a link preview cannot stop it by accident. */
export async function stopReminders(fd: FormData) {
  const token = String(fd.get('token') ?? '');
  const all = fd.get('all') === '1';
  const r = await stopByToken(token, all);
  redirect(`/reminders/stop/${encodeURIComponent(token)}?done=${r.ok ? (all ? 'all' : 'one') : 'bad'}`);
}
