import { NextResponse } from 'next/server';
import { createEventPlan } from '@/lib/eventPlan';
import { MAX_REF_FILES } from '@/lib/custom';
import { getCustomer } from '@/lib/session';
import { ipOf, limited } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** A customer sends an event plan: one request that becomes one price. Public, so it is rate-limited. */
export async function POST(req: Request) {
  if (limited(`plan:${ipOf(req)}`, 6, 10 * 60_000)) return NextResponse.json({ ok: false, error: 'You have sent a few plans just now. Please wait a few minutes, or message us on WhatsApp.' }, { status: 429 });
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: 'The plan did not arrive in one piece. Check your connection and send it again.' }, { status: 400 }); }
  if (String(form.get('website') ?? '').trim()) return NextResponse.json({ ok: true, token: 'thanks' });
  const str = (k: string) => String(form.get(k) ?? '');
  let items: unknown = [];
  try { items = JSON.parse(str('items') || '[]'); } catch { return NextResponse.json({ ok: false, error: 'That did not send properly. Reload the page and try again.' }, { status: 400 }); }
  const files = form.getAll('files').filter((f): f is File => typeof f !== 'string' && f.size > 0);
  if (files.length > MAX_REF_FILES) return NextResponse.json({ ok: false, error: `You can attach up to ${MAX_REF_FILES} files.`, field: 'files' }, { status: 422 });
  const customer = await getCustomer().catch(() => null);
  const r = await createEventPlan(
    { type: str('type'), date: str('date'), guests: str('guests'), items, extra: str('extra'), notes: str('notes') },
    { name: str('name'), phone: str('phone'), email: str('email') },
    await Promise.all(files.map(async (f) => ({ name: f.name || 'file', buf: Buffer.from(await f.arrayBuffer()) }))),
    customer?.id ?? null,
  );
  if (!r.ok) return NextResponse.json(r, { status: 422 });
  return NextResponse.json({ ok: true, token: r.token, code: r.code });
}
