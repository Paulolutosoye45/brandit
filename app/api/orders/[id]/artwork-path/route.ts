import { NextResponse } from 'next/server';
import { getOrder, setArtworkPath } from '@/lib/orders';
import { getCustomer } from '@/lib/session';
import { brandSnapshot } from '@/lib/brandKit';

export const dynamic = 'force-dynamic';

/** The customer chooses "Design it for me" (or "Fix it for me") and sends the brief. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const o = await getOrder(params.id);
  if (!o || !['draft', 'awaiting_payment'].includes(o.status)) return NextResponse.json({ error: 'This order can no longer be changed.' }, { status: 409 });
  const b = await req.json().catch(() => null);
  const clean = (v: unknown, n = 600) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const brief = {
    purpose: clean(b?.purpose),
    wording: clean(b?.wording, 1500),
    colours: clean(b?.colours),
    examples: clean(b?.examples),
    logo_note: clean(b?.logo_note),
    reference_file_ids: Array.isArray(b?.reference_file_ids) ? b.reference_file_ids.filter((x: unknown) => typeof x === 'string').slice(0, 5) : [],
    fix: !!b?.fix,
  };
  if (!brief.purpose || !brief.wording) return NextResponse.json({ error: 'Tell us what it is for and the exact words to use.' }, { status: 400 });
  // "Use my brand kit": a text copy of the kit goes into the brief, and the designer opens the logo files from the job page.
  let withKit: Record<string, unknown> = brief;
  if (b?.use_kit) {
    const me = await getCustomer().catch(() => null);
    const kit = me ? await brandSnapshot(me.id) : null;
    if (kit) withKit = { ...brief, colours: brief.colours || kit.colours, logo_note: brief.logo_note || 'Use the logo and colours from the customer\'s brand kit.', brand_kit: kit };
  }
  await setArtworkPath(params.id, 'design', withKit);
  return NextResponse.json({ ok: true, next: `/checkout/${params.id}` });
}
