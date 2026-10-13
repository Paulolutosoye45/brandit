import { NextResponse } from 'next/server';
import { createCustomRequest, MAX_REF_FILES } from '@/lib/custom';
import { getCustomer } from '@/lib/session';
import { ipOf, limited } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** A customer sends a custom request, with up to five photos or PDFs. Public, so it is rate-limited. */
export async function POST(req: Request) {
  const ip = ipOf(req);
  if (limited(`custom:${ip}`, 6, 10 * 60_000)) return NextResponse.json({ ok: false, error: 'You have sent a few requests just now. Please wait a few minutes, or message us on WhatsApp.' }, { status: 429 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'The request did not arrive in one piece. Check your connection and send it again.' }, { status: 400 });
  }
  // A hidden field real people never fill in. A bot that does gets a friendly "thanks" and nothing is saved.
  if (String(form.get('website') ?? '').trim()) return NextResponse.json({ ok: true, token: 'thanks' });
  const str = (k: string) => String(form.get(k) ?? '');
  const files = form.getAll('files').filter((f): f is File => typeof f !== 'string' && f.size > 0);
  if (files.length > MAX_REF_FILES) return NextResponse.json({ ok: false, error: `You can attach up to ${MAX_REF_FILES} files.`, field: 'files' }, { status: 422 });
  const customer = await getCustomer().catch(() => null);
  const r = await createCustomRequest(
    { productSlug: str('product'), name: str('name'), phone: str('phone'), email: str('email'), title: str('title'), details: str('details'), quantityText: str('quantity'), sizeText: str('size'), budget: str('budget'), needBy: str('need_by') },
    await Promise.all(files.map(async (f) => ({ name: f.name || 'file', buf: Buffer.from(await f.arrayBuffer()) }))),
    customer?.id ?? null,
  );
  if (!r.ok) return NextResponse.json(r, { status: 422 });
  return NextResponse.json({ ok: true, token: r.token, code: r.code });
}
