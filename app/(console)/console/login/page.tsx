import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { one, isDemo } from '@/lib/db';
import { checkPin } from '@/lib/password';
import { setStaffSession, getStaff } from '@/lib/session';
import { tooManyStaffLoginTries } from '@/lib/loginGuard';
import { clientIp } from '@/lib/clientip';
import { Notice } from '@/components/Bits';
import { Logo } from '@/components/Logo';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Team sign-in' };

/** The people who run the shop open on Today. The people who work the floor open on the job queue. */
const landingFor = (role: string) => (['admin', 'production_lead', 'support'].includes(role) ? '/console/today' : '/console/queue');

async function login(fd: FormData) {
  'use server';
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  const ip = clientIp((await headers()).get('x-forwarded-for'));
  if (tooManyStaffLoginTries(email, ip)) redirect('/console/login?e=Too+many+tries.+Wait+15+minutes.');
  const s = await one<any>('select * from staff where email = $1 and active', [email]);
  if (!s || !checkPin(String(fd.get('pin') ?? ''), s.pin_hash)) redirect('/console/login?e=That+email+and+PIN+do+not+match.');
  await setStaffSession(s.id);
  await audit({ id: s.id, name: s.name }, { area: 'security', action: 'sign_in', target: s.email, summary: `${s.name} signed in` });
  redirect(landingFor(s.role));
}

export default async function Login(props: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const searchParams = await props.searchParams;
  const already = await getStaff();
  if (already) redirect(landingFor(already.role));
  const noAdmin = !isDemo() && ((await one<{ n: number }>("select count(*)::int as n from staff where role = 'admin' and active"))?.n ?? 0) === 0;
  return (
    <main className="min-h-screen grid place-items-center px-5 py-10">
      <div className="w-full max-w-[420px] grid gap-5">
        <div className="grid justify-items-center gap-2 text-center"><Logo variant="stacked" className="h-auto w-[280px]" /><h1 className="text-[20px] font-bold text-muted">Team console</h1></div>
        <form action={login} className="card p-6 grid gap-4 shadow-press-sm">
          {searchParams.ok && <Notice tone="good">{searchParams.ok}</Notice>}
          {searchParams.e && <Notice tone="bad">{searchParams.e}</Notice>}
          {noAdmin && (
            <Notice tone="warn">
              No team account exists yet. In your host&apos;s settings set ADMIN_EMAIL and ADMIN_PIN (6 to 12 digits, not one digit repeated and not a run like 123456), then redeploy. Or create it from your computer with <code>npm run admin -- set</code> (see DEPLOY.md).
            </Notice>
          )}
          <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" className="field" autoComplete="username" required /></div>
          <div><label className="label" htmlFor="pin">PIN</label><input id="pin" name="pin" type="password" inputMode="numeric" className="field" autoComplete="current-password" required /></div>
          <button className="btn-primary">Sign in</button>
          <a href="/console/forgot" className="inline-flex min-h-[44px] items-center justify-center text-[15px] font-bold underline">Forgot your PIN?</a>
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
