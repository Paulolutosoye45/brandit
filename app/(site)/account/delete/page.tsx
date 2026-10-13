import Link from 'next/link';
import type { Metadata } from 'next';
import { requireCustomer } from '@/lib/session';
import { Notice } from '@/components/Bits';
import { deleteMyAccount } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Delete my account' };

export default async function DeleteAccount(props: { searchParams: Promise<{ e?: string }> }) {
  const sp = await props.searchParams;
  await requireCustomer('/account/delete');
  return (
    <div className="mx-auto grid max-w-[560px] gap-6 px-5 py-10">
      <h1 className="text-[38px] leading-[1.05]">Delete my account</h1>
      <div className="grid gap-3 text-[17px]">
        <p className="font-bold">What happens</p>
        <ul className="grid list-disc gap-2 pl-5">
          <li>Your name, email, phone numbers, saved area and sign-in links are erased.</li>
          <li>Delivery addresses and the files you uploaded are erased.</li>
          <li>Order and invoice records stay, because the law requires us to keep accounts. They no longer point to you.</li>
          <li>You cannot undo this. You can sign up again later as a new customer.</li>
        </ul>
        <p className="text-muted">Want a copy first? <a className="link" href="/api/account/export">Download my data</a>.</p>
      </div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      <form action={deleteMyAccount} className="card grid gap-4 p-5">
        <div><label className="label" htmlFor="c">Type DELETE to confirm</label><input id="c" name="confirm" className="field" autoComplete="off" autoCapitalize="characters" required /></div>
        <button className="btn bg-bad text-white hover:brightness-110 active:translate-y-px">Delete my account for good</button>
        <Link href="/account" className="btn-ghost btn-sm justify-self-start">Keep my account</Link>
      </form>
    </div>
  );
}
