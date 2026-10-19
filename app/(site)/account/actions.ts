'use server';
import { redirect } from 'next/navigation';
import { getCustomer } from '@/lib/session';
import { reorder } from '@/lib/orders';
import { adoptBasket } from '@/lib/basket';
import { revalidatePath } from 'next/cache';
import { query } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { isLang, setLangCookie } from '@/lib/lang';
import { startWeekly, stopByToken } from '@/lib/reminders';

export async function sameAgain(fd: FormData) {
  const c = await getCustomer();
  if (!c) redirect('/signin?next=/account');
  const r = await reorder(String(fd.get('token')), c.id);
  if ('error' in r) redirect(`/account?e=${encodeURIComponent(r.error)}`);
  // The repeat order becomes this phone's basket, so "Add another product" and the basket badge see it.
  await adoptBasket(r.id);
  redirect(`/checkout/${r.id}`);
}

/** Reminders and wording. Saved on the account, and the wording is also remembered on this phone. */
export async function savePreferences(fd: FormData) {
  const c = await getCustomer();
  if (!c) redirect('/signin?next=/account');
  const lang = String(fd.get('lang') ?? '');
  const s = await getSettings();
  const next = s.pidgin_enabled && isLang(lang) ? lang : c.lang;
  await query('update customers set nudge_ok = $2, lang = $3, reminders_ok = $4 where id = $1', [c.id, fd.get('nudge_ok') === 'on', next, fd.get('reminders_ok') === 'on']);
  if (fd.get('reminders_ok') !== 'on') await query('update reminders set active = false where customer_id = $1', [c.id]);
  await setLangCookie(next);
  revalidatePath('/', 'layout');
  redirect('/account?saved=1');
}

/** "Remind me every week to order this again." The reminder belongs to the order it was made from. */
export async function setWeeklyReminder(fd: FormData) {
  const c = await getCustomer();
  if (!c) redirect('/signin?next=/account');
  const r = await startWeekly(c.id, String(fd.get('token')), Number(fd.get('weekday')));
  revalidatePath('/account');
  redirect(r.ok ? '/account?reminder=1' : `/account?e=${encodeURIComponent(r.error)}`);
}

export async function stopWeeklyReminder(fd: FormData) {
  const c = await getCustomer();
  if (!c) redirect('/signin?next=/account');
  const own = await query<{ stop_token: string }>("select stop_token from reminders where id = $1 and customer_id = $2 and active", [String(fd.get('id')), c.id]);
  if (own[0]) await stopByToken(own[0].stop_token, false);
  revalidatePath('/account');
  redirect('/account?reminder=0');
}
