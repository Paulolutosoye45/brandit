import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { riderView, validRiderToken } from '@/lib/rider';
import { RiderApp } from './RiderApp';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Brandit delivery', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function RiderPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (!validRiderToken(token)) notFound();
  const v = await riderView(token);
  if (v.state === 'missing') notFound();
  return (
    <main className="mx-auto grid min-h-screen max-w-[520px] content-start gap-4 px-4 py-6">
      <p className="text-[14px] font-bold text-muted">Brandit delivery</p>
      <RiderApp token={token} view={v} />
    </main>
  );
}
