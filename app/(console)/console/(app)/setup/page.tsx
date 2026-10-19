import { headers } from 'next/headers';
import { requireStaff } from '@/lib/session';
import { Notice } from '@/components/Bits';
import { testEmailAction, testStorageAction, testPaystackAction, testAlertAction, backupNowAction, restoreTestAction, previewLaunchAction, loadLaunchAction } from './actions';
import { launchState } from '@/lib/launchPrices';
import { clientIp } from '@/lib/clientip';
import { setupChecks, type Check } from '@/lib/setup';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Setup' };

const LOOK: Record<Check['status'], [string, string]> = {
  ok: ['bg-good-tint text-good', 'Ready'],
  warn: ['bg-warn-tint text-warn', 'Check this'],
  bad: ['bg-bad-tint text-bad', 'Fix before launch'],
  info: ['bg-placeholder text-ink', 'For your information'],
};

export default async function Setup(props: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const me = await requireStaff('see_setup');
  const sp = await props.searchParams;
  const { checks, problems, warnings } = await setupChecks();
  const launched = await launchState().catch(() => null);
  const groups = [...new Set(checks.map((c) => c.group))];
  const chain = (await headers()).get('x-forwarded-for');
  const hops = process.env.TRUSTED_PROXY_HOPS ?? '';
  return (
    <div className="grid max-w-[900px] gap-6">
      <div><h1 className="text-[34px]">Setup</h1><p className="text-muted">What is switched on, and what is still missing. Work from the top; anything marked &ldquo;Fix before launch&rdquo; stops customers from ordering or paying.</p></div>
      <div className={`rounded-md2 px-5 py-4 ${problems ? 'bg-bad-tint' : warnings ? 'bg-warn-tint' : 'bg-good-tint'}`} role="status">
        <p className="font-display text-[24px] font-extrabold leading-tight">{problems ? `${problems} thing${problems > 1 ? 's' : ''} to fix before launch` : warnings ? `Ready to launch, with ${warnings} thing${warnings > 1 ? 's' : ''} to check` : 'Everything checks out'}</p>
        <p className="text-[15px]">Settings are read when the server starts, so restart after changing any of them.</p>
      </div>
      {groups.map((g) => (
        <section key={g} className="grid gap-3" aria-label={g}>
          <h2 className="text-[22px]">{g}</h2>
          <ul className="card divide-y divide-line">
            {checks.filter((c) => c.group === g).map((c) => {
              const [cls, word] = LOOK[c.status];
              return (
                <li key={c.id} className="grid gap-1 p-4 sm:grid-cols-[220px_1fr] sm:gap-4">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-bold">{c.label}</span><span className={`pill ${cls}`}>{word}</span></div>
                  <div className="text-[15px]"><p>{c.detail}</p>{c.fix && <p className="mt-1 text-muted">{c.fix}</p>}</div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <section id="tests" className="grid gap-3 scroll-mt-6" aria-label="Test the connections">
        <h2 className="text-[22px]">Test the connections</h2>
        <p className="text-muted">A setting can look right and still not work. These press the real button for you and say in plain words what to change.</p>
        {sp.e && <Notice tone="bad">{sp.e}</Notice>}
        {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
        <div className="card divide-y divide-line">
          <form action={testEmailAction} className="grid gap-2 p-4 sm:grid-cols-[220px_1fr] sm:gap-4">
            <div className="font-bold">Email</div>
            <div className="grid gap-2">
              <label className="label" htmlFor="to">Send a test email to</label>
              <div className="flex flex-wrap gap-2"><input id="to" name="to" type="email" defaultValue={me.email} className="field min-w-[260px] flex-1" autoComplete="email" /><button className="btn-secondary btn-sm">Send a test email</button></div>
              <p className="text-[13px] text-muted">Uses the same sender as sign-in codes and receipts. Waits up to 12 seconds for Resend to say whether it arrived. Check the inbox and the spam folder too.</p>
            </div>
          </form>
          <form action={testStorageAction} className="grid gap-2 p-4 sm:grid-cols-[220px_1fr] sm:gap-4">
            <div className="font-bold">Artwork storage</div>
            <div className="flex flex-wrap items-center gap-3"><button className="btn-secondary btn-sm">Test file storage</button><span className="text-[13px] text-muted">Saves a tiny file in the bucket, reads it back and deletes it.</span></div>
          </form>
          <form action={testPaystackAction} className="grid gap-2 p-4 sm:grid-cols-[220px_1fr] sm:gap-4">
            <div className="font-bold">Paystack</div>
            <div className="flex flex-wrap items-center gap-3"><button className="btn-secondary btn-sm">Test Paystack</button><span className="text-[13px] text-muted">Proves the key is accepted, says whether it is a live or test key, and starts one N100 payment that it leaves unpaid (one "abandoned" entry appears in Paystack). No money moves.</span></div>
          </form>
          <form action={testAlertAction} className="grid gap-2 p-4 sm:grid-cols-[220px_1fr] sm:gap-4">
            <div className="font-bold">Alerts</div>
            <div className="flex flex-wrap items-center gap-3"><button className="btn-secondary btn-sm">Send a test alert</button><span className="text-[13px] text-muted">Sends one harmless test error to Sentry and one test message to the alert number, so you see both arrive before a real one is needed.</span></div>
          </form>
          <form action={backupNowAction} className="grid gap-2 p-4 sm:grid-cols-[220px_1fr] sm:gap-4">
            <div className="font-bold">Backup</div>
            <div className="flex flex-wrap items-center gap-3"><button className="btn-secondary btn-sm">Back up now</button><span className="text-[13px] text-muted">Copies the whole database to the bucket and reads it back to prove it is whole. Do this before any big change.</span></div>
          </form>
          <form action={restoreTestAction} className="grid gap-2 p-4 sm:grid-cols-[220px_1fr] sm:gap-4">
            <div className="font-bold">Restore test</div>
            <div className="flex flex-wrap items-center gap-3"><button className="btn-secondary btn-sm">Test a restore</button><span className="text-[13px] text-muted">Rebuilds the newest backup in a scratch database and checks every row and the money. Changes nothing live. Takes about a minute.</span></div>
          </form>
        </div>
      </section>
      <section id="launch" className="grid gap-3 scroll-mt-6" aria-label="Launch price book">
        <h2 className="text-[22px]">Launch price book</h2>
        <div className="card grid gap-3 p-4 text-[15px]">
          <p>{launched ? 'The launch price book is already loaded. Your own changes in Products are the truth now, so it will not load again by itself.' : 'Customers see only prices that are confirmed. This loads the price book that came with Brandit in one go: your numbers, plus the gaps filled from what other Lagos printers publish. Each line in Products, Price sheet shows which is which. Preview first, then load.'}</p>
          <div className="flex flex-wrap gap-2">
            <form action={previewLaunchAction}><button className="btn-secondary btn-sm">Preview what it would change</button></form>
            {!launched && <form action={loadLaunchAction}><button className="btn-primary btn-sm">Load the launch price book</button></form>}
          </div>
        </div>
      </section>
      <section className="grid gap-3" aria-label="Your address">
        <h2 className="text-[22px]">Your address</h2>
        <div className="card grid gap-2 p-4 text-[15px]">
          <p>Open this page from your own phone on mobile data, then compare. The server reads your address like this:</p>
          <dl className="grid gap-1 sm:grid-cols-[220px_1fr]">
            <dt className="font-bold">Address list it received</dt><dd className="break-all">{chain ?? 'none'}</dd>
            <dt className="font-bold">TRUSTED_PROXY_HOPS</dt><dd>{hops || 'not set (uses the first address)'}</dd>
            <dt className="font-bold">Address it uses for limits</dt><dd className="font-bold">{clientIp(chain)}</dd>
          </dl>
          <p className="text-muted">If that is not your address, set TRUSTED_PROXY_HOPS to the number of proxies in front of the server and restart. Render on its own is usually 2, and 3 once Cloudflare&apos;s orange cloud is on. Raise it one at a time until your own address shows.</p>
        </div>
      </section>
    </div>
  );
}
