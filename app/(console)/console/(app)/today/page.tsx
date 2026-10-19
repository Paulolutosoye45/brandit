import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { can } from '@/lib/permissions';
import { todayView } from '@/lib/today';
import { setupChecks } from '@/lib/setup';
import { naira } from '@/lib/money';
import { describeWhen } from '@/lib/time';
import { STAGE_LABEL } from '@/lib/types';
import { AutoRefresh } from '@/components/AutoRefresh';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Today' };

const TONE = { bad: 'bg-bad-tint border-[#E8A98F]', warn: 'bg-warn-tint border-[#E5C766]', info: 'bg-surface border-line' } as const;
const dayName = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-NG', { weekday: 'short', timeZone: 'UTC' });
const delta = (now: number, before: number) => (before === 0 ? (now > 0 ? 'First sales in a while' : '') : `${now >= before ? '+' : '−'}${Math.abs(Math.round(((now - before) / before) * 100))}% on yesterday`);

export default async function Today() {
  const staff = await requireStaff();
  if (staff.role === 'partner_press') redirect('/console/queue');
  const money = can(staff.role, 'reports') || can(staff.role, 'see_payments');
  const v = await todayView(staff);
  const admin = can(staff.role, 'see_setup');
  const setup = admin ? await setupChecks().catch(() => null) : null;
  const greeting = (() => { const h = Number(new Date().toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Lagos' })); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; })();
  const max = Math.max(1, ...v.days.map((d) => d.kobo));
  const quiet = v.needs.length === 0 && v.risks.length === 0;
  return (
    <div className="grid max-w-[1100px] gap-7">
      <AutoRefresh seconds={60} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px]">{greeting}, {staff.name.split(' ')[0]}.</h1>
          <p className="text-muted">{new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Lagos' })}. This page updates itself every minute.</p>
        </div>
        <form action="/console/orders" className="flex w-full max-w-[420px] gap-2" role="search">
          <input name="q" className="field" placeholder="Find an order: BR-1042, name or phone" aria-label="Find an order" />
          <button className="btn-dark">Find</button>
        </form>
      </div>

      {setup && setup.problems > 0 && (
        <Link href="/console/setup" className="card flex flex-wrap items-center justify-between gap-3 border-[#E8A98F] bg-bad-tint p-4">
          <span><span className="font-bold">{setup.problems} thing{setup.problems === 1 ? '' : 's'} to fix before the site is fully ready.</span> <span className="text-muted">{setup.checks.filter((c) => c.status === 'bad').slice(0, 2).map((c) => c.label).join(', ')}{setup.problems > 2 ? '…' : ''}</span></span>
          <span className="btn-secondary btn-sm">Open Connections</span>
        </Link>
      )}

      <section aria-label="Needs a person" className="grid gap-3">
        <h2 className="text-[22px]">Needs you now</h2>
        {quiet ? (
          <div className="card flex items-center gap-3 border-[#9BD3B3] bg-good-tint p-5"><span aria-hidden="true" className="text-[26px]">✓</span><p className="font-bold">Nothing is waiting. Every file is checked and nothing is at risk.</p></div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {v.needs.map((n) => (
              <li key={n.key}><Link href={n.href} className={`flex min-h-[72px] items-center gap-4 rounded-md2 border p-4 hover:shadow-press-sm ${TONE[n.tone]}`}><span className="font-display text-[36px] font-extrabold leading-none tabular">{n.n}</span><span className="font-medium leading-snug">{n.label}</span></Link></li>
            ))}
          </ul>
        )}
      </section>

      {v.risks.length > 0 && (
        <section aria-label="Orders at risk" className="grid gap-3">
          <h2 className="text-[22px]">Late or about to be</h2>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[15px]">
              <tbody>
                {v.risks.map((r) => (
                  <tr key={r.jobId} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 font-bold">{r.code}</td>
                    <td className="px-4 py-3">{r.product}</td>
                    <td className="px-4 py-3 text-muted">{STAGE_LABEL[r.stage]}</td>
                    <td className="px-4 py-3"><span className={`pill ${r.status === 'late' ? 'bg-bad-tint text-bad' : 'bg-warn-tint text-warn'}`}>{r.status === 'late' ? 'Late' : 'At risk'}</span></td>
                    <td className="px-4 py-3 text-muted">{r.promisedAt ? `due ${describeWhen(new Date(r.promisedAt))}` : ''}</td>
                    <td className="px-4 py-2"><Link className="btn-secondary btn-sm" href={`/console/jobs/${r.jobId}`}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {money && (
        <section aria-label="How the shop is doing" className="grid gap-3">
          <h2 className="text-[22px]">How the shop is doing</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card p-4"><p className="text-[13px] font-bold text-muted">Paid today</p><p className="font-display text-[32px] font-extrabold leading-tight tabular">{naira(v.paidToday.kobo)}</p><p className="text-[14px] text-muted">{v.paidToday.orders} order{v.paidToday.orders === 1 ? '' : 's'}{delta(v.paidToday.kobo, v.paidYesterday.kobo) ? ` · ${delta(v.paidToday.kobo, v.paidYesterday.kobo)}` : ''}</p></div>
            <div className="card p-4"><p className="text-[13px] font-bold text-muted">Last 7 days</p><p className="font-display text-[32px] font-extrabold leading-tight tabular">{naira(v.week.kobo)}</p><p className="text-[14px] text-muted">{v.week.orders} orders{v.week.refundKobo > 0 ? ` · ${naira(v.week.refundKobo)} refunded` : ''}</p></div>
            <div className="card p-4"><p className="text-[13px] font-bold text-muted">Waiting to pay</p><p className="font-display text-[32px] font-extrabold leading-tight tabular">{v.baskets}</p><p className="text-[14px] text-muted">baskets with delivery details, last 24 hours</p></div>
            <div className="card p-4">
              <p className="text-[13px] font-bold text-muted">Last 14 days</p>
              <div className="mt-2 flex h-[64px] items-end gap-1" role="img" aria-label={`Money paid each day for 14 days, highest ${naira(max)}`}>
                {v.days.map((d) => <span key={d.ymd} title={`${dayName(d.ymd)} ${d.ymd}: ${naira(d.kobo)}`} style={{ height: `${Math.max(4, Math.round((d.kobo / max) * 100))}%` }} className={`flex-1 rounded-t-sm ${d.ymd === v.ymd ? 'bg-ink' : 'bg-accent'}`} />)}
              </div>
            </div>
          </div>
        </section>
      )}

      {v.recent.length > 0 && (
        <section aria-label="Latest paid orders" className="grid gap-3">
          <div className="flex items-end justify-between gap-3"><h2 className="text-[22px]">Latest paid orders</h2>{can(staff.role, 'see_contact') && <Link href="/console/orders" className="text-[15px] font-bold underline">All orders</Link>}</div>
          <ul className="card divide-y divide-line">
            {v.recent.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
                <span className="min-w-0"><span className="font-bold">{o.code}</span> <span className="text-muted">· {o.name ?? 'Customer'}</span><span className="block truncate text-[14px] text-muted">{o.summary}</span></span>
                <span className="text-right"><span className="block font-bold tabular">{naira(o.total_kobo)}</span><span className="text-[13px] text-muted">{describeWhen(new Date(o.paid_at))}</span></span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
