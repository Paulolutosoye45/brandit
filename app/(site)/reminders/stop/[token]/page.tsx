import Link from 'next/link';
import { reminderByToken, WEEKDAYS } from '@/lib/reminders';
import { Notice, PageHead } from '@/components/Bits';
import { stopReminders } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Stop reminders', robots: { index: false, follow: false } };

export default async function StopPage(props: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await props.params;
  const { done } = await props.searchParams;
  const r = await reminderByToken(token);

  if (!r || done === 'bad') {
    return (
      <>
        <PageHead title="We could not find that reminder" sub="It may already be switched off." />
        <div className="mx-auto grid max-w-[620px] gap-4 px-5 pb-12">
          <Notice tone="warn">If messages from us keep coming, sign in and switch reminders off under Messages and language on your account page.</Notice>
          <Link href="/account" className="btn-secondary self-start">My account</Link>
        </div>
      </>
    );
  }
  if (done === 'all' || done === 'one') {
    return (
      <>
        <PageHead title="Done. No more reminders." sub={done === 'all' ? 'We will not send you any more reorder reminders.' : 'That reminder is switched off.'} />
        <div className="mx-auto grid max-w-[620px] gap-4 px-5 pb-12">
          <p className="text-muted">You can still order any time, and we will still message you about orders you place. You can switch reminders back on under Messages and language on your account page.</p>
          <Link href="/" className="btn-secondary self-start">Visit Brandit</Link>
        </div>
      </>
    );
  }
  return (
    <>
      <PageHead title="Stop reminders?" sub={r.kind === 'weekly' && r.weekday ? `You asked us to remind you every ${WEEKDAYS[r.weekday - 1]} morning.` : 'We sent you a reminder that you might be running low.'} />
      <div className="mx-auto grid max-w-[620px] gap-3 px-5 pb-12">
        {r.kind === 'weekly' && r.active && (
          <form action={stopReminders}><input type="hidden" name="token" value={token} /><button className="btn-primary w-full sm:w-auto">Stop this weekly reminder</button></form>
        )}
        <form action={stopReminders}><input type="hidden" name="token" value={token} /><input type="hidden" name="all" value="1" /><button className={r.kind === 'weekly' && r.active ? 'btn-secondary w-full sm:w-auto' : 'btn-primary w-full sm:w-auto'}>Stop all reorder reminders</button></form>
        <p className="text-[14px] text-muted">We will still send messages about orders you place.</p>
      </div>
    </>
  );
}
