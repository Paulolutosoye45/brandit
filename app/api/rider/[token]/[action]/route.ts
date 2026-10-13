import { NextResponse } from 'next/server';
import { markNearby, recordPing, startTrip, submitCode, validRiderToken, type Result } from '@/lib/rider';
import { ipOf, limited } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/** The rider page talks to these four endpoints. The private token in the address is the only key, so every call is rate-limited. */
export async function POST(req: Request, props: { params: Promise<{ token: string; action: string }> }) {
  const { token, action } = await props.params;
  if (!validRiderToken(token)) return NextResponse.json({ ok: false, error: 'This link is not valid.' }, { status: 404 });
  if (limited(`rider:${token}`, action === 'ping' ? 40 : 15, 60_000) || limited(`riderip:${ipOf(req)}`, 120, 60_000)) return NextResponse.json({ ok: false, error: 'Slow down for a moment and try again.' }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  let r: Result;
  switch (action) {
    case 'start': r = await startTrip(token); break;
    case 'ping': r = await recordPing(token, body); break;
    case 'nearby': r = await markNearby(token); break;
    case 'code': r = await submitCode(token, String(body?.code ?? '')); break;
    default: return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  }
  return NextResponse.json(r, { status: r.ok ? 200 : 422 });
}
