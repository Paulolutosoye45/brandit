import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getSettings } from '@/lib/settings';
import { naira } from '@/lib/money';
import { Notice } from '@/components/Bits';
import { studioOverview } from '@/lib/studio/report';
import { engineStatus } from '@/lib/studio/engine';
import { runnable } from '@/lib/studio/config';
import { saveSwitchesAction, testEnginesAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Brandit Studio' };

const usd = (n: number) => `$${n < 0.1 && n > 0 ? n.toFixed(3) : n.toFixed(2)}`;

export default async function StudioConsole(props: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const sp = await props.searchParams;
  const staff = await requireStaff();
  const manage = can(staff.role, 'manage_studio');
  const review = can(staff.role, 'review_studio');
  if (!manage && !review) await requireStaff('manage_studio');
  const s = await getSettings();
  const o = await studioOverview(s);
  const engines = engineStatus(s);
  const pct = o.cap.cap > 0 ? Math.min(100, Math.round((o.cap.spent / o.cap.cap) * 100)) : 0;
  const ceilPct = o.ceiling.ceilingKobo > 0 ? Math.min(100, Math.round((o.ceiling.spentKobo / o.ceiling.ceilingKobo) * 100)) : 0;
  const stat = (label: string, value: string, sub?: string) => (
    <div className="card p-4"><p className="text-[13px] font-bold text-muted">{label}</p><p className="font-display text-[28px] font-extrabold leading-tight tabular">{value}</p>{sub && <p className="text-[13px] text-muted">{sub}</p>}</div>
  );
  return (
    <div className="grid max-w-[1080px] gap-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-[34px]">Brandit Studio</h1><p className="text-muted">AI designs: money in, money out, and what needs a person.</p></div>
        <div className="flex flex-wrap gap-2">
          {review && <Link className="btn-primary btn-sm" href="/console/studio/review">Checks and flags{o.reviewsWaiting + o.flagsOpen > 0 ? ` (${o.reviewsWaiting + o.flagsOpen})` : ''}</Link>}
          {manage && <Link className="btn-secondary btn-sm" href="/console/studio/settings">Settings and prices</Link>}
        </div>
      </div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good"><span className="break-words">{sp.ok}</span></Notice>}
      {!runnable() && <Notice tone="warn"><span className="font-bold">Studio is closed to customers.</span> No picture-maker key is set on the server. Add at least one of RECRAFT_API_KEY, BFL_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY in the environment, then redeploy. Customers cannot pay for designs that cannot be made.</Notice>}
      {o.cap.state !== 'ok' && <Notice tone="bad"><span className="font-bold">{o.cap.state === 'all_off' ? 'Monthly spend cap reached. New work is paused.' : 'Past 80 percent of the monthly cap. Free sketches are paused.'}</span> Raise the cap in Settings if this is expected.</Notice>}
      {o.plan.some((p) => p.belowFloor) && <Notice tone="warn"><span className="font-bold">A tier is under your margin floor of {s.studio_margin_floor_pct}% at full use.</span> See the table below. Raise the price, lower what is included, or choose a cheaper picture maker.</Notice>}

      <section aria-labelledby="month-h" className="grid gap-3">
        <h2 id="month-h" className="text-[22px]">This month</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stat('Designs started', String(o.month.projects), `${o.month.paid} unlocked`)}
          {stat('Studio sales', naira(o.month.revenueKobo), `${o.month.refunds} refunded (${naira(o.month.refundedKobo)})`)}
          {stat('Free sketches', String(o.month.sketches))}
          {stat('Print orders from Studio', String(o.month.orders), `${o.month.failed} designs failed`)}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="card grid gap-2 p-4">
            <div className="flex items-baseline justify-between"><p className="font-bold">Picture-maker spend</p><p className="tabular">{usd(o.cap.spent)} of {o.cap.cap > 0 ? usd(o.cap.cap) : 'no cap'}</p></div>
            <div className="h-3 overflow-hidden rounded-full bg-paper2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Monthly spend"><div className={`h-full ${pct >= 100 ? 'bg-bad' : pct >= 80 ? 'bg-warn' : 'bg-good'}`} style={{ width: `${pct}%` }} /></div>
            <p className="text-[13px] text-muted">Real calls only. Free sketches pause at 80 percent, all new work at 100 percent.</p>
          </div>
          <div className="card grid gap-2 p-4">
            <div className="flex items-baseline justify-between"><p className="font-bold">Free sketches today</p><p className="tabular">{naira(o.ceiling.spentKobo)} of {naira(o.ceiling.ceilingKobo)}</p></div>
            <div className="h-3 overflow-hidden rounded-full bg-paper2" role="progressbar" aria-valuenow={ceilPct} aria-valuemin={0} aria-valuemax={100} aria-label="Free spend today"><div className={`h-full ${ceilPct >= 100 ? 'bg-bad' : ceilPct >= 80 ? 'bg-warn' : 'bg-good'}`} style={{ width: `${ceilPct}%` }} /></div>
            <p className="text-[13px] text-muted">When this fills up, free sketches rest until tomorrow.</p>
          </div>
        </div>
        <p className="text-[14px] text-muted">{o.queue} {o.queue === 1 ? 'picture' : 'pictures'} waiting or being made right now.</p>
      </section>

      <section aria-labelledby="margin-h" className="grid gap-3">
        <h2 id="margin-h" className="text-[22px]">Margin</h2>
        <div className="card overflow-x-auto"><table className="w-full min-w-[720px] text-left text-[15px]">
          <thead><tr className="border-b border-line text-[13px] text-muted">{['Tier', 'Price', 'After VAT and Paystack', 'Cost at full use', 'Margin at full use', 'Last 30 days: paid / cost / margin'].map((h) => <th key={h} className="px-4 py-3 font-bold">{h}</th>)}</tr></thead>
          <tbody>
            {o.plan.map((p) => {
              const ob = o.observed.find((x) => x.tier === p.tier)!;
              return (
                <tr key={p.tier} className="border-b border-line last:border-0 align-top">
                  <td className="px-4 py-3 font-bold capitalize">{p.tier}</td>
                  <td className="px-4 py-3 tabular">{naira(p.priceKobo)}</td>
                  <td className="px-4 py-3 tabular">{naira(p.netKobo)}</td>
                  <td className="px-4 py-3 tabular">{naira(p.costKobo)}<ul className="mt-1 text-[12px] text-muted">{p.lines.map((l) => <li key={l.label}>{l.label}: {usd(l.usd)}</li>)}</ul></td>
                  <td className="px-4 py-3"><span className={`pill ${p.belowFloor ? 'bg-bad-tint text-bad' : 'bg-good-tint text-good'}`}>{p.marginPct}%</span><p className="mt-1 text-[12px] text-muted">floor {s.studio_margin_floor_pct}%</p></td>
                  <td className="px-4 py-3 tabular">{ob.projects === 0 ? <span className="text-muted">No paid designs yet</span> : <>{ob.projects} designs · {naira(ob.avgRevenueKobo)} / {naira(ob.avgCostKobo)} each · {ob.marginPct}%</>}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <p className="text-[13px] text-muted">Full use means the customer uses every design, round, print file and vector included, at the cautious rate of ₦{s.studio_fx_plan} to the dollar. The time a Brandit designer spends on a check is staff time and is not counted here. The print credit (₦{s.studio_credit_standard_kobo / 100} or ₦{s.studio_credit_premium_kobo / 100}) is a discount on a print job, so it comes out of that job&apos;s margin.</p>
      </section>

      <section aria-labelledby="eng-h" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="eng-h" className="text-[22px]">Picture makers</h2>
          {manage && <form action={testEnginesAction}><button className="btn-secondary btn-sm" title="Makes one real picture with each connected company. Costs a few cents.">Test the connections</button></form>}
        </div>
        <div className="card overflow-x-auto"><table className="w-full min-w-[640px] text-left text-[15px]">
          <thead><tr className="border-b border-line text-[13px] text-muted">{['Picture maker', 'Model', 'Cost each', 'Connected'].map((h) => <th key={h} className="px-4 py-3 font-bold">{h}</th>)}</tr></thead>
          <tbody>{engines.map((e) => (
            <tr key={e.id} className="border-b border-line last:border-0"><td className="px-4 py-3 font-bold">{e.label}</td><td className="px-4 py-3 font-mono text-[13px]">{e.model}</td><td className="px-4 py-3 tabular">{usd(e.usd)}</td><td className="px-4 py-3"><span className={`pill ${e.configured ? 'bg-good-tint text-good' : 'bg-placeholder text-ink'}`}>{e.configured ? 'Yes' : 'No key'}</span></td></tr>
          ))}</tbody>
        </table></div>
        <p className="text-[13px] text-muted">The model names and prices above came from each company&apos;s published rate card when Studio was built. Use “Test the connections” after adding a key, and correct names or prices under Settings if a company has changed them.</p>
      </section>

      <section aria-labelledby="spend-h" className="grid gap-3">
        <h2 id="spend-h" className="text-[22px]">Spend by company this month</h2>
        <div className="card overflow-x-auto"><table className="w-full min-w-[520px] text-left text-[15px]">
          <thead><tr className="border-b border-line text-[13px] text-muted">{['Company', 'What', 'Calls', 'Failed', 'Cost'].map((h) => <th key={h} className="px-4 py-3 font-bold">{h}</th>)}</tr></thead>
          <tbody>
            {o.vendors.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No real spend yet this month.</td></tr>}
            {o.vendors.map((v) => <tr key={v.vendor + v.op} className="border-b border-line last:border-0"><td className="px-4 py-3 font-bold capitalize">{v.vendor}</td><td className="px-4 py-3">{v.op}</td><td className="px-4 py-3 tabular">{v.calls}</td><td className="px-4 py-3 tabular">{v.failed}</td><td className="px-4 py-3 tabular">{usd(v.usd)}</td></tr>)}
          </tbody>
        </table></div>
      </section>

      {manage && (
        <section aria-labelledby="sw-h" className="card grid gap-4 p-5">
          <h2 id="sw-h" className="text-[22px]">Switches</h2>
          <form action={saveSwitchesAction} className="grid gap-3">
            {([['studio_enabled', 'Studio is open', s.studio_enabled], ['studio_standard_on', 'Standard designs on', s.studio_standard_on], ['studio_premium_on', 'Premium designs on', s.studio_premium_on]] as const).map(([k, l, v]) => (
              <label key={k} className="flex min-h-[44px] items-center gap-3"><input type="checkbox" name={k} defaultChecked={v} className="h-5 w-5 accent-[#0B1F33]" />{l}</label>
            ))}
            <div className="max-w-[360px]"><label className="label" htmlFor="acc">Who can use Studio</label>
              <select id="acc" name="studio_access" defaultValue={s.studio_access} className="field"><option value="invited">Only people on the invite list</option><option value="everyone">Everyone</option></select></div>
            <button className="btn-primary btn-sm w-fit">Save switches</button>
          </form>
        </section>
      )}
    </div>
  );
}
