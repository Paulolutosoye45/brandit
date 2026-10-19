import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { clientIp } from '@/lib/clientip';
import { completeStaffReset, issueStaffReset } from '@/lib/staffReset';
import { Notice } from '@/components/Bits';
import { Logo } from '@/components/Logo';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Forgot PIN' };

async function ask(fd: FormData) {
  'use server';
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  const ip = clientIp((await headers()).get('x-forwarded-for'));
  const r = await issueStaffReset(email, ip);
  if (!r.ok) redirect(`/console/forgot?e=${encodeURIComponent(r.error)}`);
  // Only the demo (no email service) shows the code on screen. A live site never does.
  redirect(`/console/forgot?step=code&email=${encodeURIComponent(email)}${r.demoCode ? `&demo=${r.demoCode}` : ''}`);
}

async function finish(fd: FormData) {
  'use server';
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  const r = await completeStaffReset(email, String(fd.get('code') ?? ''), String(fd.get('pin') ?? ''), String(fd.get('pin2') ?? ''));
  if (!r.ok) redirect(`/console/forgot?step=code&email=${encodeURIComponent(email)}&e=${encodeURIComponent(r.error)}`);
  redirect('/console/login?ok=Your+PIN+is+changed.+Sign+in+with+it.');
}

export default async function Forgot(props: { searchParams: Promise<{ step?: string; email?: string; e?: string; demo?: string }> }) {
  const sp = await props.searchParams;
  const codeStep = sp.step === 'code' && !!sp.email;
  return (
    <main className="grid min-h-screen place-items-center px-5 py-10">
      <div className="grid w-full max-w-[420px] gap-5">
        <div className="grid justify-items-center gap-2 text-center"><Logo variant="stacked" className="h-auto w-[240px]" /><h1 className="text-[20px] font-bold text-muted">Forgot your PIN?</h1></div>
        {codeStep ? (
          <form action={finish} className="card grid gap-4 p-6 shadow-press-sm">
            <p>If <strong>{sp.email}</strong> is on the team, we sent a six-digit code to it. It works for 15 minutes.</p>
            {sp.demo && <Notice tone="warn">Demo only: the code is <strong>{sp.demo}</strong>. A live site emails it and never shows it here.</Notice>}
            {sp.e && <Notice tone="bad">{sp.e}</Notice>}
            <input type="hidden" name="email" value={sp.email} />
            <div><label className="label" htmlFor="code">Code from the email</label><input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="field" required /></div>
            <div><label className="label" htmlFor="pin">New PIN (6 to 12 digits)</label><input id="pin" name="pin" type="password" inputMode="numeric" autoComplete="new-password" className="field" required /></div>
            <div><label className="label" htmlFor="pin2">New PIN again</label><input id="pin2" name="pin2" type="password" inputMode="numeric" autoComplete="new-password" className="field" required /></div>
            <button className="btn-primary">Save my new PIN</button>
            <Link href="/console/forgot" className="text-center text-[15px] underline">Send a new code</Link>
          </form>
        ) : (
          <form action={ask} className="card grid gap-4 p-6 shadow-press-sm">
            <p>Type your work email. We send you a six-digit code to set a new PIN.</p>
            {sp.e && <Notice tone="bad">{sp.e}</Notice>}
            <div><label className="label" htmlFor="email">Work email</label><input id="email" name="email" type="email" autoComplete="username" className="field" required /></div>
            <button className="btn-primary">Send me a code</button>
          </form>
        )}
        <Link href="/console/login" className="text-center text-[15px] font-bold underline">Back to sign in</Link>
      </div>
    </main>
  );
}
