import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { listQueue, statusOf, type JobStatus } from '@/lib/jobs';
import { getSettings } from '@/lib/settings';
import { slotsUsedOn } from '@/lib/quote';
import { productionDay, describeWhen, describeDay, durationText } from '@/lib/time';
import { STAGE_LABEL, type Stage } from '@/lib/types';
import { effectiveWindow, windowText } from '@/lib/windows';
import { can } from '@/lib/permissions';
import { proofLabel, proofStateOf } from '@/lib/lines';
import { StatusPill } from '@/components/Bits';
import { AutoRefresh } from '@/components/AutoRefresh';
import { runChecks, togglePause } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Job queue' };

export default async function Queue() {
  const staff = await requireStaff();
  const now = new Date();
  const [rows, s] = await Promise.all([listQueue(staff), getSettings()]);
  const day = productionDay(now, s);
  const used = await slotsUsedOn(day);
  const jobs: (Record<string, any> & { status: JobStatus })[] = rows.map((r) => ({ ...r, status: statusOf({ stage: r.stage, clock_paused: r.clock_paused, promised_at: r.promised_at, at_risk: r.at_risk }, now) }));
  const count = (f: (j: (typeof jobs)[number]) => boolean) => jobs.filter(f).length;
  const stats = [
    { n: count((j) => j.stage === 'file_check' && !j.clock_paused), label: 'files waiting for a check' },
    { n: count((j) => j.stage === 'proof'), label: 'proofs waiting on customers' },
    { n: count((j) => j.status === 'at_risk'), label: 'jobs at risk', tone: 'warn' },
    { n: count((j) => j.status === 'late'), label: 'jobs late', tone: 'bad' },
  ];
  return (
    <div className="grid gap-6">
      <AutoRefresh seconds={15} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-[34px]">Job queue</h1><p className="text-muted">Sorted by time left on the promise. The most urgent job is first.</p></div>
        {staff.role !== 'partner_press' && (
          <div className="card p-4 flex flex-wrap items-center gap-4">
            <div>
              <p className="text-[13px] font-bold text-muted">24-hour slots for {describeDay(day, now)}</p>
              <p className="font-display font-extrabold text-[24px] leading-tight tabular">{used} of {s.daily_24h_slots} used</p>
              {s.slots_paused && <p className="text-[13px] font-bold text-bad">Paused: customers see standard delivery</p>}
            </div>
            {can(staff.role, 'edit_rules') && (
              <form action={togglePause}><input type="hidden" name="pause" value={s.slots_paused ? '0' : '1'} /><button className="btn-secondary btn-sm">{s.slots_paused ? 'Resume 24-hour slots' : 'Pause 24-hour slots'}</button></form>
            )}
          </div>
        )}
      </div>

      {staff.role !== 'partner_press' && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {stats.map((st) => (
            <div key={st.label} className={`rounded-md2 border p-4 flex items-baseline gap-3 ${st.tone === 'warn' && st.n ? 'bg-warn-tint border-[#E5C766]' : st.tone === 'bad' && st.n ? 'bg-bad-tint border-[#E8A98F]' : 'bg-surface border-line'}`}>
              <span className="font-display font-extrabold text-[32px] leading-none tabular">{st.n}</span><span className="font-medium text-[15px]">{st.label}</span>
            </div>
          ))}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[960px] text-left text-[15px]">
          <thead><tr className="text-[13px] text-muted border-b border-line">
            {['Job', 'Product', 'Stage', 'Proof', 'Promised', 'Time left', 'Status', ''].map((h) => <th key={h} scope="col" className="px-4 py-3 font-bold">{h}</th>)}
          </tr></thead>
          <tbody>
            {jobs.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-muted">Nothing in production. New paid orders appear here the moment they are paid.</td></tr>}
            {jobs.map((j) => {
              const left = j.promised_at ? new Date(j.promised_at).getTime() - now.getTime() : null;
              return (
                <tr key={j.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-bold whitespace-nowrap"><Link className="underline" href={`/console/jobs/${j.id}`}>{j.code}</Link>{j.line_count > 1 && <span className="ml-2 text-[13px] font-normal text-muted">{j.line_no} of {j.line_count}</span>}{j.speed === '24h' && <span className="pill bg-ink text-white ml-2">24h</span>}</td>
                  <td className="px-4 py-3">{j.quantity.toLocaleString('en-US')} × {j.product_name}{j.width_ft ? ` ${j.width_ft}×${j.height_ft} ft` : ''}{j.reprint_count > 0 && <span className="pill bg-warn-tint text-warn ml-2">Reprint</span>}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{STAGE_LABEL[j.stage as Stage]}{j.artwork_path === 'studio' ? ' (Studio)' : j.artwork_path === 'design' && j.stage === 'file_check' ? ' (design)' : ''}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-[14px]">{proofLabel(proofStateOf(j as any, { stage: j.stage }))}{j.proof_status === 'changes_requested' && <span className="block text-[13px] text-bad">changes asked for</span>}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{j.promised_at ? describeWhen(new Date(j.promised_at)) : 'Not set yet'}{(() => { const w = effectiveWindow(j.delivery_window, { speed: j.speed, pickup: j.pickup, enabled: s.windows_enabled }); return w ? <span className="block text-[13px] text-muted">Rider: {windowText(w)}</span> : null; })()}</td>
                  <td className={`px-4 py-3 font-bold whitespace-nowrap tabular ${j.status === 'late' ? 'text-bad' : ''}`}>{left == null || j.clock_paused ? '—' : left < 0 ? `${durationText(-left)} late` : durationText(left)}</td>
                  <td className="px-4 py-3"><StatusPill status={j.status} /></td>
                  <td className="px-4 py-2"><Link className="btn-secondary btn-sm" href={`/console/jobs/${j.id}`}>Open</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {can(staff.role, 'run_checks') && (
        <form action={runChecks} className="flex items-center gap-3"><button className="btn-secondary btn-sm">Run the promise checks now</button><span className="text-[14px] text-muted">Marks jobs at risk, refunds late orders and sends review requests. This also runs by itself every five minutes.</span></form>
      )}
    </div>
  );
}
