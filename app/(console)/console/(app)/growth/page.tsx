import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { query } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { naira } from '@/lib/money';
import { Notice } from '@/components/Bits';
import { nudgeStats } from '@/lib/nudge';
import { referralStats } from '@/lib/referrals';
import { eventPlanStats } from '@/lib/eventPlan';
import { campaignViews, listCampaigns, phaseNow } from '@/lib/campaigns';
import { saveNudgeAction, saveReferralAction, saveSwitchesAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Growth' };

const naira0 = (k: number) => String(k / 100);
const Stat = ({ label, value, hint }: { label: string; value: string | number; hint?: string }) => (
  <div className="rounded-lg border border-line bg-paper p-3"><p className="text-[13px] text-muted">{label}</p><p className="text-[24px] font-bold leading-tight">{value}</p>{hint && <p className="text-[12px] text-muted">{hint}</p>}</div>
);
const Check = ({ name, on, children }: { name: string; on: boolean; children: React.ReactNode }) => (
  <label className="flex items-start gap-3 min-h-[44px]"><input type="checkbox" name={name} defaultChecked={on} className="mt-1 h-5 w-5 accent-[#0B1F33]" /><span>{children}</span></label>
);

export default async function Growth(props: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const sp = await props.searchParams;
  await requireStaff('manage_growth');
  const [s, nudge, ref, plans, views, campaigns, tpl, photos, windows] = await Promise.all([
    getSettings(), nudgeStats(30), referralStats(90), eventPlanStats(30), campaignViews(30), listCampaigns(),
    query<{ title: string; slug: string; started: number; paid: number }>(
      `select t.title, t.slug, count(o.id)::int as started, count(o.id) filter (where o.status in ('paid','in_production','delivered'))::int as paid
         from templates t left join orders o on o.template_id = t.id and o.created_at > now() - interval '30 days'
        group by t.id order by started desc, t.sort limit 8`),
    query<{ n: number }>("select count(*)::int as n from reviews where photo_status = 'pending'"),
    query<{ w: string; n: number }>("select delivery_window as w, count(*)::int as n from orders where delivery_window is not null and created_at > now() - interval '30 days' group by 1"),
  ]);
  const nWin = (w: string) => windows.find((x) => x.w === w)?.n ?? 0;
  return (
    <div className="grid gap-8 max-w-[980px]">
      <div>
        <h1 className="text-[34px]">Growth</h1>
        <p className="text-muted">Reminders, referrals, templates, seasonal pages and event plans in one place: what is switched on, what it earned, and the numbers behind it. Last 30 days unless it says otherwise.</p>
      </div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      {photos[0]?.n > 0 && <Notice tone="warn"><Link href="/console/reviews" className="font-bold underline">{photos[0].n} review photo{photos[0].n === 1 ? '' : 's'} waiting</Link> for a person to check. Nothing is public until you approve it.</Notice>}

      <section id="nudge" className="card p-5 grid gap-4 scroll-mt-6">
        <div><h2 className="text-[24px]">Unpaid-order reminder</h2><p className="text-[14px] text-muted">When someone fills in delivery details but does not pay, we send one friendly WhatsApp message with a link that takes them back to payment. One message only, between 8am and 8pm Lagos time, never after 48 hours, never to someone who opted out.</p></div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Reminders sent" value={nudge.sent} />
          <Stat label="Opened the link" value={nudge.clicked} />
          <Stat label="Paid afterwards" value={nudge.recovered} />
          <Stat label="Money recovered" value={naira(nudge.recoveredKobo)} />
        </div>
        <form action={saveNudgeAction} className="grid gap-4">
          <Check name="nudge_enabled" on={s.nudge_enabled}><span className="font-bold">Send the reminder.</span> Turn it off and none are sent.</Check>
          <div className="max-w-[320px]"><label className="label" htmlFor="nm">Wait this long after they stop (minutes)</label><input id="nm" name="nudge_after_minutes" type="number" min={30} max={1440} className="field" defaultValue={s.nudge_after_minutes} /></div>
          <button className="btn-primary self-start">Save</button>
        </form>
      </section>

      <section id="referral" className="card p-5 grid gap-4 scroll-mt-6">
        <div><h2 className="text-[24px]">Referral codes (last 90 days)</h2><p className="text-[14px] text-muted">Every signed-in customer gets a personal code. A friend takes a percentage off their first order. When the friend&apos;s order is delivered, the person who shared earns a fixed-value code for their next order. Rewards are only given after delivery, so a refunded or cancelled order never pays out.</p></div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Personal codes" value={ref.codes} />
          <Stat label="Friend orders" value={ref.friendOrders} />
          <Stat label="Given to friends" value={naira(ref.discountKobo)} />
          <Stat label="Rewards earned" value={ref.rewards} />
          <Stat label="Reward value" value={naira(ref.rewardKobo)} />
          <Stat label="Rewards used" value={ref.rewardsUsed} />
        </div>
        {ref.top.length > 0 && <p className="text-[14px] text-muted">Top sharers: {ref.top.map((t) => `${t.name} (${t.friends})`).join(', ')}</p>}
        <form action={saveReferralAction} className="grid gap-4">
          <Check name="referral_enabled" on={s.referral_enabled}><span className="font-bold">Referral codes are on.</span> Turn them off to stop new codes from working. Rewards already earned still work.</Check>
          <div className="grid gap-4 sm:grid-cols-3">
            <div><label className="label" htmlFor="rp">Friend takes off (%)</label><input id="rp" name="referral_friend_percent" type="number" min={1} max={50} className="field" defaultValue={s.referral_friend_percent} /></div>
            <div><label className="label" htmlFor="rc">Most a friend can save (₦)</label><input id="rc" name="referral_friend_cap" className="field" defaultValue={naira0(s.referral_friend_cap_kobo)} /><p className="mt-1 text-[13px] text-muted">0 means no limit.</p></div>
            <div><label className="label" htmlFor="rr">Reward for the sharer (₦)</label><input id="rr" name="referral_reward" className="field" defaultValue={naira0(s.referral_reward_kobo)} /></div>
            <div><label className="label" htmlFor="rd">Reward code valid for (days)</label><input id="rd" name="referral_reward_days" type="number" min={7} max={365} className="field" defaultValue={s.referral_reward_days} /></div>
            <div><label className="label" htmlFor="rm">Most rewards one person can earn</label><input id="rm" name="referral_max_rewards" type="number" min={0} max={500} className="field" defaultValue={s.referral_max_rewards} /></div>
          </div>
          <button className="btn-primary self-start">Save</button>
        </form>
      </section>

      <section id="switches" className="card p-5 grid gap-4 scroll-mt-6">
        <h2 className="text-[24px]">Switches</h2>
        <form action={saveSwitchesAction} className="grid gap-3">
          <Check name="windows_enabled" on={s.windows_enabled}><span className="font-bold">Let customers choose morning or afternoon delivery.</span> It is a plan for the rider, not a change to the promise. A 24-hour order is always delivered in the afternoon. Last 30 days: {nWin('morning')} morning, {nWin('afternoon')} afternoon.</Check>
          <Check name="pidgin_enabled" on={s.pidgin_enabled}><span className="font-bold">Show the English / Pidgin switch.</span> English stays the default. Customers who pick Pidgin get the menus and WhatsApp messages in Pidgin. Have a Pidgin speaker read the wording before you turn this on for everyone.</Check>
          <button className="btn-secondary btn-sm self-start">Save</button>
        </form>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="card p-5 grid gap-2 content-start">
          <h2 className="text-[20px]">Templates</h2>
          {tpl.length === 0 ? <p className="text-[14px] text-muted">No templates yet.</p> : (
            <ul className="grid gap-1 text-[14px]">{tpl.map((t) => <li key={t.slug} className="flex justify-between gap-2"><span className="truncate">{t.title}</span><span className="text-muted whitespace-nowrap">{t.started} started · {t.paid} paid</span></li>)}</ul>
          )}
          <Link href="/console/templates" className="btn-secondary btn-sm self-start mt-1">Manage templates</Link>
        </div>
        <div className="card p-5 grid gap-2 content-start">
          <h2 className="text-[20px]">Event plans</h2>
          <p className="text-[14px] text-muted">{plans.requests} sent, {plans.accepted} accepted. Each one is a single quote and a single order, delivered together.</p>
          <Link href="/console/custom" className="btn-secondary btn-sm self-start mt-1">Open custom requests</Link>
        </div>
        <div className="card p-5 grid gap-2 content-start">
          <h2 className="text-[20px]">Seasonal pages</h2>
          {campaigns.length === 0 ? <p className="text-[14px] text-muted">No seasonal pages yet.</p> : (
            <ul className="grid gap-1 text-[14px]">{campaigns.slice(0, 6).map((c) => <li key={c.id} className="flex justify-between gap-2"><span className="truncate">{c.title}</span><span className="text-muted whitespace-nowrap">{phaseNow(c)} · {views.get(c.slug) ?? 0} views</span></li>)}</ul>
          )}
          <Link href="/console/campaigns" className="btn-secondary btn-sm self-start mt-1">Manage seasonal pages</Link>
        </div>
      </section>
    </div>
  );
}
