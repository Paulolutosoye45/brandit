import { cache } from 'react';
import { cookies } from 'next/headers';
import type { Lang } from '../content/messages';
import { getCustomer } from './session';
import { query } from './db';
import { getSettings } from './settings';

/*
 * The wording of the site and of the messages: English (default) or Nigerian Pidgin.
 * The choice is remembered in a small cookie on the device ("bl"), and on the customer's account when they are signed in,
 * so messages to their phone use it too. Nothing else about the site changes.
 */
export const LANG_COOKIE = 'bl';
export const isLang = (v: unknown): v is Lang => v === 'en' || v === 'pcm';

/** The language for this request. A switch that has been turned off in the console always gives English. */
export const getLang = cache(async (): Promise<Lang> => {
  const s = await getSettings().catch(() => null);
  if (s && !s.pidgin_enabled) return 'en';
  const c = (await cookies()).get(LANG_COOKIE)?.value;
  if (isLang(c)) return c;
  const me = await getCustomer().catch(() => null);
  return me && isLang((me as any).lang) ? ((me as any).lang as Lang) : 'en';
});

export async function setLangCookie(lang: Lang) {
  (await cookies()).set(LANG_COOKIE, lang, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', httpOnly: false });
}

/** The cookie as a visitor chose it, or null when they never chose. Used to remember the choice on a new account. */
export async function chosenLang(): Promise<Lang | null> {
  const c = (await cookies()).get(LANG_COOKIE)?.value;
  return isLang(c) ? c : null;
}

/**
 * A visitor who picked a language and then signs in or checks out: remember it on their account, so the messages
 * we send to their phone use the same wording. Nothing happens if they never chose, or the switch is turned off.
 */
export async function rememberLangFor(customerId: string | null | undefined): Promise<void> {
  if (!customerId) return;
  try {
    const s = await getSettings();
    if (!s.pidgin_enabled) return;
    const l = await chosenLang();
    if (l) await query('update customers set lang = $2 where id = $1 and lang <> $2', [customerId, l]);
  } catch { /* the choice is a convenience: never block a sign-in or an order on it */ }
}
