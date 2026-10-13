import { NextResponse } from 'next/server';
import type { Customer } from '../identity';
import { getCustomer } from '../session';
import { ipOf, limited } from '../ratelimit';
import { getSettings } from '../settings';
import { accessFor } from './config';

/* Small helpers shared by the Studio API routes. */
export const bad = (error: string, status = 400, extra: Record<string, unknown> = {}) => NextResponse.json({ ok: false, error, ...extra }, { status });
export const good = (data: Record<string, unknown> = {}) => NextResponse.json({ ok: true, ...data });
export const STUDIO_ID = /^[0-9a-f-]{36}$/;

/** The signed-in customer, or a ready-made 401. Also applies a per-address rate limit. */
export async function customerOr401(req: Request, bucket: string, max = 60, windowMs = 60_000): Promise<{ c: Customer } | { res: NextResponse }> {
  if (limited(`studio:${bucket}:${ipOf(req)}`, max, windowMs)) return { res: bad('Too many requests. Wait a moment and try again.', 429) };
  const c = await getCustomer().catch(() => null);
  if (!c) return { res: bad('Sign in to use Brandit Studio.', 401, { code: 'signin' }) };
  return { c };
}

/** Studio switched off or not open to this person. */
export async function openOr403(c: Customer): Promise<NextResponse | null> {
  const s = await getSettings();
  const a = await accessFor(s, c as any);
  return a.ok ? null : bad(a.message, 403, { code: a.reason });
}

export async function jsonBody(req: Request): Promise<Record<string, any> | null> {
  const b = await req.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, any>) : null;
}
