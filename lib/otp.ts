import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { query, one, isDemo } from './db';
import { normalizePhone } from './phone';
import { sendDirectSms, smsOn, appUrl } from './messages';
import { codeEmail, emailOn, sendEmail } from './email';
import { limited } from './ratelimit';

export type Channel = 'email' | 'phone';

export const cleanEmail = (s: string) => String(s ?? '').trim().toLowerCase();
export const isEmail = (s: string) => s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

/** Turn what the person typed into the one form we store, or say why it is not usable. */
export function normalizeIdentifier(channel: Channel, raw: string): { ok: true; id: string } | { ok: false; error: string } {
  if (channel === 'email') {
    const e = cleanEmail(raw);
    return isEmail(e) ? { ok: true, id: e } : { ok: false, error: 'Enter a full email address, like name@example.com.' };
  }
  const p = normalizePhone(raw);
  return p ? { ok: true, id: p } : { ok: false, error: 'Enter a Nigerian mobile number, like 0803 123 4567.' };
}

const secret = () => process.env.SESSION_SECRET ?? 'demo';
const hash = (channel: Channel, id: string, code: string) => createHash('sha256').update(`${channel}:${id}:${code}:${secret()}`).digest('hex');
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const channelOn = (c: Channel) => (c === 'email' ? emailOn() : smsOn());

export type IssueResult = { ok: true; identifier: string; demoCode?: string } | { ok: false; error: string };

/** Send a six-digit code. With no provider set up, demo mode returns the code so it can be shown on screen. */
export async function issueCode(channel: Channel, raw: string, ip = 'local'): Promise<IssueResult> {
  const n = normalizeIdentifier(channel, raw);
  if (!n.ok) return n;
  const id = n.id;
  if (limited(`code:${ip}`, 12, 10 * 60_000)) return { ok: false, error: 'Too many codes requested from this device. Wait a few minutes and try again.' };
  const recent = await one("select 1 as x from login_codes where channel = $1 and identifier = $2 and created_at > now() - interval '30 seconds'", [channel, id]);
  if (recent) return { ok: false, error: 'We just sent a code. Wait 30 seconds before asking for another.' };

  const live = channelOn(channel);
  if (!live && !isDemo()) return { ok: false, error: channel === 'email' ? 'Email sign-in is not set up yet. Use Google or your phone number.' : 'Phone sign-in is not set up yet. Use Google or your email.' };

  const code = String(randomInt(100000, 1000000));
  await query(
    `insert into login_codes (channel, identifier, code_hash, expires_at, attempts, created_at) values ($1,$2,$3, now() + interval '10 minutes', 0, now())
     on conflict (channel, identifier) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = now()`,
    [channel, id, hash(channel, id, code)],
  );
  if (!live) return { ok: true, identifier: id, demoCode: code };
  try {
    if (channel === 'email') await sendEmail({ to: id, ...codeEmail(code) });
    else {
      // The last line lets Android fill the code in for the person (the web OTP format).
      const host = new URL(appUrl()).host;
      await sendDirectSms(id, `Your Brandit code is ${code}. It works for 10 minutes. Do not share it.\n\n@${host} #${code}`);
    }
  } catch {
    return { ok: false, error: 'We could not send the code. Try again in a minute.' };
  }
  return { ok: true, identifier: id };
}

export async function checkCode(channel: Channel, raw: string, code: string): Promise<{ ok: true; identifier: string } | { ok: false; error: string }> {
  const n = normalizeIdentifier(channel, raw);
  if (!n.ok) return n;
  const id = n.id;
  const r = await one<any>('select * from login_codes where channel = $1 and identifier = $2', [channel, id]);
  if (!r || new Date(r.expires_at) < new Date()) return { ok: false, error: 'That code has expired. Ask for a new one.' };
  if (r.attempts >= 5) return { ok: false, error: 'Too many tries. Ask for a new code.' };
  if (!same(r.code_hash, hash(channel, id, String(code).trim()))) {
    await query('update login_codes set attempts = attempts + 1 where channel = $1 and identifier = $2', [channel, id]);
    return { ok: false, error: 'That code is not right. Check it and try again.' };
  }
  await query('delete from login_codes where channel = $1 and identifier = $2', [channel, id]);
  return { ok: true, identifier: id };
}
