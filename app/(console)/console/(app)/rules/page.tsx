import { requireStaff } from '@/lib/session';
import { query } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { listProducts, listZones } from '@/lib/catalog';
import { naira } from '@/lib/money';
import { Notice } from '@/components/Bits';
import Link from 'next/link';
import { saveSettingsAction, saveZoneAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Delivery and rules' };

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const naira0 = (k: number) => String(k / 100);

export default async function Rules(props: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const searchParams = await props.searchParams;
  await requireStaff('edit_rules');
  const [s, zones, products] = await Promise.all([getSettings(), listZones(), listProducts(true)]);
  const rules = await query<any>('select * from price_rules order by product_id, quantity nulls last, size_key');
  const provisionalCount = rules.filter((r) => r.provisional).length + zones.filter((z) => z.provisional).length;

  return (
    <div className="grid gap-8 max-w-[980px]">
      <div><h1 className="text-[34px]">Delivery and rules</h1><p className="text-muted">Delivery times, fees, VAT and the rules behind your promise. Product prices, photos and options are under <Link href="/console/products" className="underline">Products</Link>. Changes apply straight away, with no developer.</p></div>
      {searchParams.e && <Notice tone="bad">{searchParams.e}</Notice>}
      {searchParams.ok && <Notice tone="good">{searchParams.ok}</Notice>}
      {provisionalCount > 0 && <Notice tone="warn"><span className="font-bold">{provisionalCount} numbers are still placeholders.</span> Quantity prices and delivery fees marked &ldquo;placeholder&rdquo; were made up to demonstrate the system. Replace them with real figures from your cost sheet before taking public orders.</Notice>}

      <section id="settings" className="card p-5 grid gap-5 scroll-mt-6">
        <h2 className="text-[24px]">Delivery promise and fees</h2>
        <form action={saveSettingsAction} className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div><label className="label" htmlFor="co">Daily cut-off</label><input id="co" name="cutoff_time" className="field" defaultValue={s.cutoff_time} /><p className="text-[13px] text-muted mt-1">Orders after this start the next working day.</p></div>
            <div><label className="label" htmlFor="ab">Arrive by</label><input id="ab" name="arrive_by" className="field" defaultValue={s.arrive_by} /><p className="text-[13px] text-muted mt-1">The time of day we promise delivery.</p></div>
            <div><label className="label" htmlFor="sl">24-hour slots a day</label><input id="sl" name="daily_24h_slots" type="number" className="field" defaultValue={s.daily_24h_slots} /><p className="text-[13px] text-muted mt-1">Raise it only while on-time stays above 95%.</p></div>
          </div>
          <label className="flex items-center gap-3 min-h-[44px]"><input type="checkbox" name="slots_paused" defaultChecked={s.slots_paused} className="h-5 w-5 accent-[#0B1F33]" /><span><span className="font-bold">Pause 24-hour slots.</span> Customers see standard delivery until you turn this off.</span></label>
          <fieldset><legend className="label">Working days</legend><div className="flex flex-wrap gap-3">{DAYS.map((d, i) => <label key={d} className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" name={`wd_${i}`} defaultChecked={s.working_days.includes(i)} className="h-5 w-5 accent-[#0B1F33]" />{d}</label>)}</div></fieldset>
          <div><label className="label" htmlFor="hol">Public holidays and days off (one per line, as 2026-12-25)</label><textarea id="hol" name="holidays" className="field !py-3 min-h-[90px] font-mono text-[15px]" defaultValue={s.holidays.join('\n')} /></div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div><label className="label" htmlFor="v">VAT (%)</label><input id="v" name="vat_rate" className="field" defaultValue={String(+(s.vat_rate * 100).toFixed(2))} /></div>
            <div><label className="label" htmlFor="h">Hold a quote for (minutes)</label><input id="h" name="hold_minutes" type="number" className="field" defaultValue={s.hold_minutes} /></div>
            <label className="flex items-center gap-3 min-h-[48px] sm:mt-6"><input type="checkbox" name="prices_include_vat" defaultChecked={s.prices_include_vat} className="h-5 w-5 accent-[#0B1F33]" />Shown prices include VAT</label>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div><label className="label" htmlFor="df">Design fee (₦)</label><input id="df" name="design_fee" className="field" defaultValue={naira0(s.design_fee_kobo)} /><p className="text-[13px] text-muted mt-1">Placeholder until you set it.</p></div>
            <div><label className="label" htmlFor="ff">Fix-my-file fee (₦)</label><input id="ff" name="fix_fee" className="field" defaultValue={naira0(s.fix_fee_kobo)} /></div>
            <div><label className="label" htmlFor="ll">Production lead can approve up to (₦)</label><input id="ll" name="lead_limit" className="field" defaultValue={naira0(s.lead_reprint_limit_kobo)} /></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div><label className="label" htmlFor="cw">Problem reports open for (hours)</label><input id="cw" name="claim_window" type="number" className="field" defaultValue={s.claim_window_hours} /></div>
            <div><label className="label" htmlFor="r1">At risk if not at quality check (hours before)</label><input id="r1" name="risk_qc" type="number" step="0.5" className="field" defaultValue={s.at_risk_qc_hours} /></div>
            <div><label className="label" htmlFor="r2">At risk if not out for delivery (hours before)</label><input id="r2" name="risk_dispatch" type="number" step="0.5" className="field" defaultValue={s.at_risk_dispatch_hours} /></div>
          </div>
          <div className="border-t border-line pt-4 grid gap-4">
            <p className="font-bold">Custom orders and pickup</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="label" htmlFor="cr">We reply to custom requests within (hours)</label><input id="cr" name="custom_reply_hours" type="number" className="field" defaultValue={s.custom_reply_hours} /><p className="text-[13px] text-muted mt-1">Shown to customers after they send a request.</p></div>
              <div><label className="label" htmlFor="cv">A custom quote stays valid for (days)</label><input id="cv" name="custom_quote_valid_days" type="number" className="field" defaultValue={s.custom_quote_valid_days} /></div>
            </div>
            <div><label className="label" htmlFor="pa">Pickup address (optional)</label><input id="pa" name="pickup_address" className="field" defaultValue={s.pickup_address} placeholder="Street, area, Lagos" /><p className="text-[13px] text-muted mt-1">Shown to customers who choose to collect their order. Leave it empty if you do not offer pickup.</p></div>
          </div>
          <button className="btn-primary self-start">Save settings</button>
        </form>
      </section>

      <section id="zones" className="grid gap-3 scroll-mt-6">
        <h2 className="text-[24px]">Delivery zones</h2>
        {zones.map((z) => (
          <form key={z.id} action={saveZoneAction} className="card p-5 grid gap-3">
            <input type="hidden" name="id" value={z.id} />
            <div className="flex flex-wrap items-center gap-3"><input name="name" defaultValue={z.name} className="field !w-auto flex-1 min-w-[220px] font-bold" aria-label="Zone name" />{z.provisional && <span className="pill bg-warn-tint text-warn">Placeholder fee</span>}</div>
            <div className="grid gap-3 sm:grid-cols-[160px_1fr] items-start">
              <div><label className="label" htmlFor={`f-${z.id}`}>Fee (₦)</label><input id={`f-${z.id}`} name="fee" className="field" defaultValue={naira0(z.fee_kobo)} /></div>
              <div><label className="label" htmlFor={`a-${z.id}`}>Areas (one per line)</label><textarea id={`a-${z.id}`} name="areas" className="field !py-3 min-h-[100px]" defaultValue={z.areas.join('\n')} /></div>
            </div>
            <label className="flex items-center gap-3 min-h-[44px]"><input type="checkbox" name="eligible" defaultChecked={z.eligible_24h} className="h-5 w-5 accent-[#0B1F33]" />24-hour delivery available in this zone</label>
            <button className="btn-secondary btn-sm self-start">Save zone</button>
          </form>
        ))}
      </section>

      <section id="products" className="card p-5 grid gap-2 scroll-mt-6">
        <h2 className="text-[24px]">Products</h2>
        <p className="text-muted text-[15px]">Prices, photos, options and 24-hour limits for each product have moved to one place.</p>
        <Link href="/console/products" className="btn-primary btn-sm self-start">Open Products</Link>
        {products.some((p) => rules.some((r) => r.product_id === p.id && r.provisional)) && <p className="text-[14px] text-muted">Still placeholders: {products.filter((p) => rules.some((r) => r.product_id === p.id && r.provisional)).map((p) => p.name).join(', ')}.</p>}
      </section>
      <p className="text-[13px] text-muted">Benchmark prices came from Printivo and Hazken Digital&apos;s public listings. {naira(0)} shows as a missing price.</p>
    </div>
  );
}
