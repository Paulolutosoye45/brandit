import { NextResponse } from 'next/server';
import { submitReview } from '@/lib/reviewPhotos';
import { ipOf, limited } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** A customer sends a review, with an optional photo (a route, because a phone photo is bigger than a server action may carry). */
export async function POST(req: Request, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (limited(`review:${ipOf(req)}`, 10, 10 * 60_000)) return NextResponse.json({ ok: false, error: 'Too many tries. Wait a few minutes.' }, { status: 429 });
  if (!/^[\w-]{8,40}$/.test(token)) return NextResponse.json({ ok: false, error: 'We could not find that order.' }, { status: 404 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: 'That did not send. Check your connection and try again.' }, { status: 400 });
  const f = form.get('photo');
  const photo = f instanceof File && f.size > 0 ? { name: f.name || 'photo', buf: Buffer.from(await f.arrayBuffer()) } : null;
  const r = await submitReview({ token, rating: form.get('rating'), body: form.get('body'), publicOk: form.get('public_ok') === 'on', photoOk: form.get('photo_ok') === 'on', photo });
  return NextResponse.json(r, { status: r.ok ? 200 : 422 });
}
