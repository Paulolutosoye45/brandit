import { notFound } from 'next/navigation';
import { getTracker } from '@/lib/tracker';
import { Notice } from '@/components/Bits';
import { TrackerLive } from './TrackerLive';
import { getCustomer } from '@/lib/session';
import { one } from '@/lib/db';
import { referralSummary } from '@/lib/referrals';
import { InviteCard } from '@/components/InviteCard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your order' };

export default async function TrackPage(
  props: { params: Promise<{ token: string }>; searchParams: Promise<{ reported?: string; reviewed?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const t = await getTracker(params.token);
  if (!t) notFound();
  // After a delivery, the signed-in owner of the order is invited to share their code.
  let invite = null;
  if (t.delivered) {
    const me = await getCustomer().catch(() => null);
    const o = me ? await one<{ customer_id: string | null }>('select customer_id from orders where public_token = $1', [params.token]) : null;
    if (me && o?.customer_id === me.id) invite = await referralSummary(me.id);
  }
  return (
    <>
      <div className="mx-auto max-w-[760px] px-5 pt-8 pb-5 grid gap-3">
        <h1 className="text-[28px] sm:text-[34px]">Your order</h1>
        {searchParams.reported && <Notice tone="good">Thank you. We have your report and a person will look at it today. We will message you.</Notice>}
        {searchParams.reviewed && <Notice tone="good">{searchParams.reviewed === 'photo' ? 'Thank you. A person checks your photo before anyone else sees it.' : 'Thank you for your review.'}</Notice>}
      </div>
      <TrackerLive initial={t} whatsapp={process.env.NEXT_PUBLIC_WHATSAPP ?? null} />
      {invite && <div className="mx-auto max-w-[760px] px-5 pb-12"><InviteCard r={invite} compact /></div>}
    </>
  );
}
