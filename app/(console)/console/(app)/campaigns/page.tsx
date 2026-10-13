import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { listCampaigns, campaignViews, lagosToday } from '@/lib/campaigns';
import { phaseOf, niceDay } from '@/lib/campaignCore';
import { Notice } from '@/components/Bits';
import { setCampaignActiveAction, moveCampaignAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Seasonal pages' };

const PILL: Record<string, string> = { live: 'bg-good-tint text-good', upcoming: 'bg-warn-tint text-warn', ended: 'bg-placeholder text-ink', hidden: 'bg-placeholder text-ink' };
const LABEL: Record<string, string> = { live: 'Live now', upcoming: 'Starts soon', ended: 'Ended', hidden: 'Switched off' };

export default async function Campaigns(props: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const sp = await props.searchParams;
  await requireStaff('manage_campaigns');
  const [rows, views] = await Promise.all([listCampaigns(), campaignViews(30)]);
  const today = lagosToday();
  return (
    <div className="grid max-w-[980px] gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[34px]">Seasonal pages</h1>
          <p className="text-muted">Pages for moments like wedding season or December events. Each shows on its own dates, can offer a coupon, and can put a banner on the home page.</p>
        </div>
        <Link href="/console/campaigns/new" className="btn-primary">Add a page</Link>
      </div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      <ul className="grid gap-3">
        {rows.map((c, i) => {
          const ph = phaseOf(c, today);
          return (
            <li key={c.id} className="card flex flex-wrap items-center gap-3 p-4 sm:gap-4">
              <div className="min-w-0 flex-1 basis-56">
                <Link href={`/console/campaigns/${c.id}`} className="block text-[19px] font-bold leading-tight hover:underline">{c.title}</Link>
                <p className="text-[14px] text-muted">{c.starts_on ? niceDay(c.starts_on) : 'No start'} to {c.ends_on ? niceDay(c.ends_on) : 'no end'} · {views.get(c.slug) ?? 0} views in 30 days</p>
                <p className="mt-1 flex flex-wrap gap-2"><span className={`pill ${PILL[ph]}`}>{LABEL[ph]}</span>{c.show_on_home && <span className="pill bg-placeholder text-ink">Home banner</span>}{c.coupon_code && <span className="pill bg-placeholder text-ink">Code {c.coupon_code}</span>}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/console/campaigns/${c.id}`} className="btn-secondary btn-sm">Edit</Link>
                <Link href={`/season/${c.slug}`} target="_blank" rel="noopener" className="btn-ghost btn-sm">Open page</Link>
                <form action={setCampaignActiveAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="on" value={c.active ? '0' : '1'} /><button className="btn-ghost btn-sm">{c.active ? 'Switch off' : 'Switch on'}</button></form>
                <form action={moveCampaignAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="dir" value="up" /><button className="btn-ghost btn-sm" disabled={i === 0} aria-label={`Move ${c.title} earlier`}>↑ Up</button></form>
                <form action={moveCampaignAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="dir" value="down" /><button className="btn-ghost btn-sm" disabled={i === rows.length - 1} aria-label={`Move ${c.title} later`}>↓ Down</button></form>
              </div>
            </li>
          );
        })}
        {rows.length === 0 && <li className="card p-8 text-center text-muted">No seasonal pages yet.</li>}
      </ul>
    </div>
  );
}
