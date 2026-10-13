import { NextResponse } from 'next/server';
import { addAsset, KitError } from '@/lib/brandKit';
import { getCustomer } from '@/lib/session';
import { ipOf, limited } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Add a logo or design to the signed-in customer's brand kit. */
export async function POST(req: Request) {
  if (limited(`kitup:${ipOf(req)}`, 20, 10 * 60_000)) return NextResponse.json({ ok: false, error: 'Too many uploads. Wait a few minutes.' }, { status: 429 });
  const me = await getCustomer();
  if (!me) return NextResponse.json({ ok: false, error: 'Sign in to add files to your brand kit.' }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ ok: false, error: 'Choose a file first.' }, { status: 400 });
  try {
    const a = await addAsset(me.id, String(form?.get('kind') ?? 'logo') as any, String(form?.get('title') ?? ''), { name: file.name || 'file', buf: Buffer.from(await file.arrayBuffer()) });
    return NextResponse.json({ ok: true, asset: a });
  } catch (e) {
    if (e instanceof KitError) return NextResponse.json({ ok: false, error: e.message }, { status: 422 });
    throw e;
  }
}
