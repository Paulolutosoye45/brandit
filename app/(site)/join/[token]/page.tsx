import Link from 'next/link';
import { getCustomer } from '@/lib/session';
import { joinPreview } from '@/lib/businessAccounts';
import { Notice, PageHead } from '@/components/Bits';
import { joinAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Join a company account', robots: { index: false, follow: false } };

/** A company owner sends this link to their people. It shows the company's name and nothing about the other members. */
export default async function JoinPage(props: { params: Promise<{ token: string }>; searchParams: Promise<{ e?: string }> }) {
  const { token } = await props.params;
  const sp = await props.searchParams;
  const [b, me] = await Promise.all([joinPreview(token), getCustomer()]);
  if (!b) {
    return (
      <>
        <PageHead title="This join link does not work" sub="It may have been replaced." />
        <div className="mx-auto grid max-w-[620px] gap-4 px-5 pb-12">
          <Notice tone="warn">Ask the person who sent it for a new link.</Notice>
          <Link href="/" className="btn-secondary self-start">Visit Brandit</Link>
        </div>
      </>
    );
  }
  return (
    <>
      <PageHead title={`Join ${b.name} on Brandit`} sub={`${b.owner} invited you to order for the company.`} />
      <div className="mx-auto grid max-w-[620px] gap-4 px-5 pb-16">
        {sp.e && <Notice tone="bad">{sp.e}</Notice>}
        <section className="card grid gap-3 p-6">
          <ul className="grid gap-2 text-[16px]">
            <li>Your orders carry the company name, so receipts and invoices are in its name.</li>
            <li>You use the company&apos;s logo and colours when you ask us to design something.</li>
            <li>You see your own orders. {b.owner} sees all of the company&apos;s orders and the monthly statement.</li>
          </ul>
          {me ? (
            <form action={joinAction}>
              <input type="hidden" name="token" value={token} />
              <button className="btn-primary w-full sm:w-auto">Join {b.name}</button>
            </form>
          ) : (
            <Link href={`/signin?next=${encodeURIComponent(`/join/${token}`)}`} className="btn-primary w-full sm:w-auto">Sign in to join</Link>
          )}
        </section>
      </div>
    </>
  );
}
