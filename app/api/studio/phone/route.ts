import { checkCode, issueCode } from '@/lib/otp';
import { linkVerifiedPhone } from '@/lib/studio/limits';
import { ipOf, limited } from '@/lib/ratelimit';
import { bad, customerOr401, good, jsonBody } from '@/lib/studio/route';

export const dynamic = 'force-dynamic';

/**
 * Free sketches are counted per verified phone number, so the number has to be proven once.
 * Step 1 sends a code. Step 2 checks it and puts the number on the account.
 */
export async function POST(req: Request) {
  const who = await customerOr401(req, 'phone', 20, 10 * 60_000);
  if ('res' in who) return who.res;
  const b = await jsonBody(req);
  if (!b) return bad('Something went wrong. Try again.');
  const phone = String(b.phone ?? '');
  if (who.c.phone) return good({ done: true });
  if (b.code) {
    if (limited(`studio:phonecheck:${who.c.id}`, 10, 10 * 60_000)) return bad('Too many tries. Wait a few minutes.', 429);
    const r = await checkCode('phone', phone, String(b.code));
    if (!r.ok) return bad(r.error, 422);
    const l = await linkVerifiedPhone(who.c.id, r.identifier);
    return l.ok ? good({ done: true }) : bad(l.error, 422);
  }
  const r = await issueCode('phone', phone, ipOf(req));
  if (!r.ok) return bad(r.error, 422);
  return good({ sent: true, demoCode: r.demoCode ?? null });
}
