import { NextResponse } from 'next/server';
import { currentBasket, viewOf } from '@/lib/basket';
import { getItem } from '@/lib/orders';
import { clearNames, saveNames } from '@/lib/nameList';
import { readXlsx, looksLikeXlsx, XlsxError } from '@/lib/xlsxRead';
import { ipOf, limited } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

async function mine(itemId: string) {
  if (!/^[0-9a-f-]{36}$/.test(itemId)) return null;
  const b = await currentBasket();
  if (!b) return null;
  const item = await getItem(b.id, itemId);
  return item ? { basket: b, item } : null;
}

/**
 * Save the list of names for one line. The browser sends either the pasted text, or a file (a spreadsheet or a CSV).
 * The quantity and the price follow the list.
 */
export async function PUT(req: Request, props: { params: Promise<{ itemId: string }> }) {
  if (limited(`names:${ipOf(req)}`, 30)) return NextResponse.json({ error: 'Too many changes. Wait a moment.' }, { status: 429 });
  const { itemId } = await props.params;
  const m = await mine(itemId);
  if (!m) return NextResponse.json({ error: 'We could not find that product in your basket.' }, { status: 404 });
  let input: string | string[][] | null = null;
  const type = req.headers.get('content-type') ?? '';
  try {
    if (type.startsWith('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!file || typeof file === 'string' || file.size === 0) return NextResponse.json({ error: 'Choose a spreadsheet or CSV file first.' }, { status: 400 });
      if (file.size > 1_000_000) return NextResponse.json({ error: 'That file is too big for a list of names. Keep it under 1 MB.' }, { status: 413 });
      const buf = Buffer.from(await file.arrayBuffer());
      input = looksLikeXlsx(buf) ? readXlsx(buf, 'Names') : buf.toString('utf8').replace(/^﻿/, '');
    } else {
      const b = await req.json().catch(() => null);
      if (typeof b?.text === 'string') input = b.text.slice(0, 60_000);
    }
  } catch (e) {
    if (e instanceof XlsxError) return NextResponse.json({ error: e.message }, { status: 422 });
    return NextResponse.json({ error: 'We could not read that file. Save it as a spreadsheet (.xlsx) or a CSV and try again.' }, { status: 422 });
  }
  if (input == null) return NextResponse.json({ error: 'Send the list of names.' }, { status: 400 });
  const r = await saveNames(m.basket.id, itemId, input);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
  return NextResponse.json({ ok: true, total: r.total, warnings: r.warnings, quantityChanged: r.quantityChanged, view: await viewOf(m.basket.id) });
}

export async function DELETE(req: Request, props: { params: Promise<{ itemId: string }> }) {
  if (limited(`names:${ipOf(req)}`, 30)) return NextResponse.json({ error: 'Too many changes. Wait a moment.' }, { status: 429 });
  const { itemId } = await props.params;
  const m = await mine(itemId);
  if (!m) return NextResponse.json({ error: 'We could not find that product in your basket.' }, { status: 404 });
  await clearNames(m.basket.id, itemId);
  return NextResponse.json({ ok: true, view: await viewOf(m.basket.id) });
}
