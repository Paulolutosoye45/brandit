import { headers } from 'next/headers';
import { requireStaff } from '@/lib/session';
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

export default async function Setup() {
  await requireStaff('see_setup');
  const { checks, problems, warnings } = await setupChecks();
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
