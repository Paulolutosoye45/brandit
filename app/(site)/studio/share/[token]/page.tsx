import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getProjectByShare, getVersion } from '@/lib/studio/projects';
import { occasionById } from '@/content/studio';
import { ShareFeedback } from '@/components/studio/ShareFeedback';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'A design to look at', robots: { index: false, follow: false }, referrer: 'no-referrer' };

/** What a family member or committee member sees. One preview, one form, no account. */
export default async function SharedDesign(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) notFound();
  const p = await getProjectByShare(token);
  const v = p?.shared_version_id ? await getVersion(p.shared_version_id) : null;
  if (!p || !v || v.status !== 'ready' || !v.preview_key) {
    return (
      <div className="mx-auto grid max-w-[560px] gap-3 px-5 py-14 text-center">
        <h1 className="text-[30px]">This link is not active</h1>
        <p className="text-muted">The person who shared it may have stopped sharing, or the design was finished. Ask them to send a new link.</p>
        <Link href="/" className="link">Brandit</Link>
      </div>
    );
  }
  const occ = occasionById(p.occasion);
  return (
    <div className="mx-auto grid max-w-[760px] gap-5 px-5 py-8">
      <div>
        <p className="text-[14px] font-bold uppercase tracking-wide text-muted">{occ.label}</p>
        <h1 className="text-[30px] leading-tight sm:text-[40px]">Someone wants your opinion</h1>
        <p className="mt-1 text-[17px] text-muted">Look at this design. Tell them if you like it, or what to change. You do not need to sign in.</p>
      </div>
      <div className="overflow-hidden rounded-md2 border border-line bg-paper2">
        <img src={`/api/studio/v/${v.id}?k=preview&s=${encodeURIComponent(token)}`} alt="The design to look at" className="mx-auto max-h-[78vh] w-full object-contain" />
      </div>
      <ShareFeedback token={token} />
      <p className="text-[13px] text-muted">Designed with Brandit Studio. Your name and comment are shown only to the person who shared this link.</p>
    </div>
  );
}
