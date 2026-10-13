import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { isDemo } from '@/lib/db';
import { googleOn } from '@/lib/google';
import { safeNext } from '@/lib/safeNext';
import { DEMO_GOOGLE } from '@/lib/destination';
import { Avatar } from '@/components/Brand';
import { GoogleIcon } from '@/components/GoogleIcon';
import { chooseDemoGoogle } from '../../actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Choose an account' };

export default async function DemoGoogle(props: { searchParams: Promise<{ next?: string }> }) {
  const searchParams = await props.searchParams;
  if (!isDemo() || googleOn()) notFound();
  const next = safeNext(searchParams.next);
  return (
    <div className="grid w-full max-w-[420px] gap-6">
      <div className="grid gap-2">
        <GoogleIcon className="h-7 w-7" />
        <h1 className="text-[30px] leading-[1.1]">Choose an account</h1>
        <p className="text-[17px] text-muted">to continue to Brandit</p>
      </div>
      <ul className="card divide-y divide-line overflow-hidden">
        {DEMO_GOOGLE.map((a, i) => (
          <li key={a.sub}>
            <form action={chooseDemoGoogle.bind(null, i, next)}>
              <button className="flex w-full items-center gap-4 px-4 py-3.5 text-left hover:bg-paper">
                <Avatar name={a.name} className="h-10 w-10 text-[17px]" />
                <span className="min-w-0"><span className="block font-bold">{a.name}</span><span className="block truncate text-[15px] text-muted">{a.email}</span></span>
              </button>
            </form>
          </li>
        ))}
      </ul>
      <p className="rounded-md2 bg-warn-tint px-4 py-3 text-[14px]"><span className="font-bold">Demo mode.</span> In the live site this step is Google&apos;s own screen. These accounts are made up.</p>
      <Link href={`/signin?next=${encodeURIComponent(next)}`} className="link justify-self-start text-[15px]">Back to sign-in options</Link>
    </div>
  );
}
