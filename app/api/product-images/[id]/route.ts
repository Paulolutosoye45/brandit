import { NextResponse } from 'next/server';
import { readImage } from '@/lib/productImages';

export const dynamic = 'force-dynamic';

/**
 * Catalogue photos are public: they are on the product pages. An image id never changes what it shows
 * (a replaced photo gets a new id), so browsers and Cloudflare may keep it for a year.
 */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse('Not found', { status: 404 });
  const size = new URL(req.url).searchParams.get('size') === 'full' ? 'full' : 'thumb';
  const img = await readImage(id, size);
  if (!img) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(new Uint8Array(img.buf), {
    headers: {
      'Content-Type': img.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
