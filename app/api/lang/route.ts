import { NextResponse } from 'next/server';
import { getCustomer } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import { isLang, setLangCookie } from '@/lib/lang';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Remember the language a visitor chose: on this phone, and on their account if they are signed in. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const s = await getSettings();
  if (!s.pidgin_enabled || !isLang(body?.lang)) return NextResponse.json({ ok: false }, { status: 400 });
  await setLangCookie(body.lang);
  const me = await getCustomer().catch(() => null);
  if (me) await query('update customers set lang = $2 where id = $1', [me.id, body.lang]);
  return NextResponse.json({ ok: true });
}
