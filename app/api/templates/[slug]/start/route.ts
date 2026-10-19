import { NextResponse } from 'next/server';
import { startFromTemplate } from '@/lib/templates';
import { getCustomer } from '@/lib/session';
import { adoptBasket, currentBasket } from '@/lib/basket';
import { ipOf, limited } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** A filled-in template becomes an order. Public, so it is rate-limited and the files are small. */
export async function POST(req: Request, props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  if (limited(`template:${ipOf(req)}`, 15, 10 * 60_000)) return NextResponse.json({ ok: false, error: 'You have started a few orders just now. Wait a few minutes, or message us on WhatsApp.' }, { status: 429 });
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: 'The form did not arrive in one piece. Check your connection and try again.' }, { status: 400 }); }
  let answers: unknown = {};
  try { answers = JSON.parse(String(form.get('answers') ?? '{}')); } catch { /* treated as empty: the required questions will say what is missing */ }
  const files = form.getAll('files').filter((f): f is File => typeof f !== 'string' && f.size > 0).slice(0, 3);
  for (const f of files) if (f.size > 10_000_000) return NextResponse.json({ ok: false, error: `“${f.name}” is larger than 10 MB. Send a smaller copy.` }, { status: 422 });
  const me = await getCustomer().catch(() => null);
  const basket = await currentBasket().catch(() => null);
  const r = await startFromTemplate(slug, {
    answers,
    quantity: Number(form.get('quantity')) || undefined,
    colours: String(form.get('colours') ?? ''),
    files: await Promise.all(files.map(async (f) => ({ name: f.name || 'file', type: f.type, buf: Buffer.from(await f.arrayBuffer()) }))),
    customerId: me?.id ?? null,
    basketOrderId: basket?.id ?? null,
  });
  if (!r.ok) return NextResponse.json(r, { status: 422 });
  // The template order is now this phone's basket.
  await adoptBasket(r.orderId).catch(() => {});
  return NextResponse.json({ ok: true, orderId: r.orderId });
}
