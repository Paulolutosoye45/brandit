import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { one, query, isDemo } from './db';
import { hashPin } from './password';
import { validatePin } from './team';
import { emailOn, sendEmail } from './email';
import { limited } from './ratelimit';
import { audit } from './audit';
import { appUrl } from './messages';

/*
 * "Forgot PIN" for the team. A six-digit code goes to the staff member's own email. It works for 15 minutes and for five
 * tries. The answer is the same whether or not the email belongs to someone on the team, so the page cannot be used to
 * find out who works here. The code is never shown on screen on a live site.
 */
const secret = () => process.env.SESSION_SECRET ?? 'demo';
const hash = (staffId: string, code: string) => createHash('sha256').update(`staff:${staffId}:${code}:${secret()}`).digest('hex');
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cleanEmail = (s: string) => String(s ?? '').trim().toLowerCase();
const isEmail = (s: string) => s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export type IssueResult = { ok: true; demoCode?: string } | { ok: false; error: string };

export async function issueStaffReset(rawEmail: string, ip = 'local'): Promise<IssueResult> {
  const email = cleanEmail(rawEmail);
  if (!isEmail(email)) return { ok: false, error: 'Enter your full work email address.' };
  if (limited(`staffreset:${ip}`, 8, 15 * 60_000) || limited(`staffreset-email:${email}`, 4, 15 * 60_000)) return { ok: false, error: 'Too many tries. Wait 15 minutes, or ask another admin to reset your PIN in Team.' };
  const live = emailOn();
  if (!live && !isDemo()) return { ok: false, error: 'Email is not set up on this site, so a code cannot be sent. Ask another admin to reset your PIN in Team, or run "npm run admin -- set" (see DEPLOY.md).' };
  const s = await one<{ id: string; name: string }>('select id, name from staff where lower(email) = $1 and active', [email]);
  if (!s) return { ok: true }; // the same answer, so nobody can test which emails work here
  const code = String(randomInt(100000, 1000000));
  await query(
    `insert into staff_reset_codes (staff_id, code_hash, expires_at, attempts, created_at) values ($1,$2, now() + interval '15 minutes', 0, now())
     on conflict (staff_id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = now()`,
    [s.id, hash(s.id, code)],
  );
  await audit({ id: s.id, name: s.name }, { area: 'security', action: 'pin_reset_requested', target: email, summary: 'A PIN reset code was requested' });
  if (!live) return { ok: true, demoCode: code };
  try {
    await sendEmail({
      to: email,
      subject: `${code} is your Brandit console reset code`,
      text: `Your Brandit console reset code is ${code}.\n\nIt works for 15 minutes. If you did not ask for it, ignore this email: your PIN has not changed.\n\n${appUrl()}/console/login`,
      html: `<p style="font-family:Arial,sans-serif;font-size:16px">Your Brandit console reset code is</p><p style="font-family:Arial,sans-serif;font-size:36px;font-weight:800;letter-spacing:8px">${esc(code)}</p><p style="font-family:Arial,sans-serif;font-size:14px;color:#3D5166">It works for 15 minutes. If you did not ask for it, ignore this email: your PIN has not changed.</p>`,
    });
  } catch {
    return { ok: false, error: 'We could not send the email. Try again in a minute, or ask another admin to reset your PIN in Team.' };
  }
  return { ok: true };
}

export async function completeStaffReset(rawEmail: string, code: string, pin: string, pin2: string): Promise<{ ok: true } | { ok: false; error: string; field?: 'code' | 'pin' }> {
  const email = cleanEmail(rawEmail);
  if (pin !== pin2) return { ok: false, error: 'The two PINs are not the same.', field: 'pin' };
  const bad = validatePin(pin);
  if (bad) return { ok: false, error: bad, field: 'pin' };
  const s = await one<{ id: string; name: string }>('select id, name from staff where lower(email) = $1 and active', [email]);
  const r = s ? await one<{ code_hash: string; expires_at: string; attempts: number }>('select * from staff_reset_codes where staff_id = $1', [s.id]) : null;
  if (!s || !r || new Date(r.expires_at) < new Date()) return { ok: false, error: 'That code has expired or was not asked for. Ask for a new one.', field: 'code' };
  if (r.attempts >= 5) return { ok: false, error: 'Too many wrong tries. Ask for a new code.', field: 'code' };
  if (!same(r.code_hash, hash(s.id, String(code).trim()))) {
    await query('update staff_reset_codes set attempts = attempts + 1 where staff_id = $1', [s.id]);
    return { ok: false, error: 'That code is not right. Check it and try again.', field: 'code' };
  }
  await query('update staff set pin_hash = $2 where id = $1', [s.id, hashPin(pin)]);
  await query('delete from staff_reset_codes where staff_id = $1', [s.id]);
  await audit({ id: s.id, name: s.name }, { area: 'security', action: 'pin_reset', target: email, summary: 'PIN changed using an emailed code' });
  return { ok: true };
}
