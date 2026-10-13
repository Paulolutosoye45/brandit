'use server';
import { redirect } from 'next/navigation';
import { getCustomer } from '@/lib/session';
import { reorder } from '@/lib/orders';
import { revalidatePath } from 'next/cache';
import { query } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { isLang, setLangCookie } from '@/lib/lang';

export async function sameAgain(fd: FormData) {
  const c = await getCustomer();
  if (!c) redirect('/signin?next=/account');
  const r = await reorder(String(fd.get('token')), c.id);
  if ('error' in r) redirect(`/account?e=${encodeURIComponent(r.error)}`);
  redirect(`/checkout/${r.id}`);
}

/** Reminders and wording. Saved on the account, and the wording is also remembered on this phone. */
export async function savePreferences(fd: FormData) {
  const c = await getCustomer();
  if (!c) redirect('/signin?next=/account');
  const lang = String(fd.get('lang') ?? '');
  const s = await getSettings();
  const next = s.pidgin_enabled && isLang(lang) ? lang : c.lang;
  await query('update customers set nudge_ok = $2, lang = $3 where id = $1', [c.id, fd.get('nudge_ok') === 'on', next]);
  await setLangCookie(next);
  revalidatePath('/', 'layout');
  redirect('/account?saved=1');
}
