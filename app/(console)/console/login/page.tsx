import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { one, isDemo } from '@/lib/db';
import { checkPin } from '@/lib/password';
import { setStaffSession, getStaff } from '@/lib/session';
import { tooManyStaffLoginTries } from '@/lib/loginGuard';
import { clientIp } from '@/lib/clientip';
import { Notice } from '@/components/Bits';
import { Logo } from '@/components/Logo';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Team sign-in' };

async function login(fd: FormData) {
  'use server';
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  const ip = clientIp((await headers()).get('x-forwarded-for'));
  if (tooManyStaffLoginTries(email, ip)) redirect('/console/login?e=Too+many+tries.+Wait+15+minutes.');
  const s = await one<any>('select * from staff where email = $1 and active', [email]);
  if (!s || !checkPin(String(fd.get('pin') ?? ''), s.pin_hash)) redirect('/console/login?e=That+email+and+PIN+do+not+match.');
  await setStaffSession(s.id);
  redirect('/console/queue');
}

export default async function Login(props: { searchParams: Promise<{ e?: string }> }) {
  const searchParams = await props.searchParams;
  if (await getStaff()) redirect('/console/queue');
  return (
    <main className="min-h-screen grid place-items-center px-5 py-10">
      <div className="w-full max-w-[420px] grid gap-5">
        <div className="grid justify-items-center gap-2 text-center"><Logo variant="stacked" className="h-auto w-[280px]" /><h1 className="text-[20px] font-bold text-muted">Team console</h1></div>
        <form action={login} className="card p-6 grid gap-4 shadow-press-sm">
          {searchParams.e && <Notice tone="bad">{searchParams.e}</Notice>}
          <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" className="field" autoComplete="username" required /></div>
          <div><label className="label" htmlFor="pin">PIN</label><input id="pin" name="pin" type="password" inputMode="numeric" className="field" autoComplete="current-password" required /></div>
          <button className="btn-primary">Sign in</button>
        </form>
        {isDemo() && (
          <div className="card p-4 text-[14px] grid gap-1">
            <p className="font-bold">Demo accounts (PIN 1234)</p>
            {['admin', 'lead', 'files', 'support', 'dispatch', 'press'].map((n) => <p key={n} className="text-muted">{n}@brandit.test</p>)}
          </div>
        )}
      </div>
    </main>
  );
}
