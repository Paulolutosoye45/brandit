import { NextResponse } from 'next/server';
import { readTemplateImage } from '@/lib/templates';

export const dynamic = 'force-dynamic';

/** Template pictures are public, like product photos. A new picture gets a new copy, so an hour of caching is safe. */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse('Not found', { status: 404 });
  const size = new URL(req.url).searchParams.get('size') === 'full' ? 'full' : 'thumb';
  const img = await readTemplateImage(id, size);
  if (!img) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(new Uint8Array(img.buf), { headers: { 'Content-Type': img.mime, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
}
