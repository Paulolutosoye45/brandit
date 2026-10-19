import Link from 'next/link';
import type { Metadata } from 'next';
import { requireCustomer } from '@/lib/session';
import { ordersForCustomer } from '@/lib/orders';
import { contactPhone, methodsFor } from '@/lib/identity';
import { naira } from '@/lib/money';
import { describeWhen } from '@/lib/time';
import { formatLocal } from '@/lib/phoneFormat';
import { one } from '@/lib/db';
import { Check, Notice } from '@/components/Bits';
import { Avatar } from '@/components/Brand';
import { GoogleIcon } from '@/components/GoogleIcon';
import { signOut } from '@/app/(auth)/actions';
import { requestsForCustomer } from '@/lib/custom';
import { sameAgain, savePreferences, setWeeklyReminder, stopWeeklyReminder } from './actions';
import { WEEKDAYS, weeklyFor } from '@/lib/reminders';
import { referralSummary } from '@/lib/referrals';
import { InviteCard } from '@/components/InviteCard';
import { getSettings } from '@/lib/settings';
import { brandKitFor } from '@/lib/brandKit';
import { runnable } from '@/lib/studio/config';
import { one as oneRow } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'My account' };

const REQUEST_LABEL: Record<string, [string, string]> = {
  new: ['Waiting for our price', 'bg-warn-tint text-warn'], quoted: ['Price ready', 'bg-good-tint text-good'], expired: ['Price expired', 'bg-placeholder text-ink'],
  declined: ['We could not do this', 'bg-placeholder text-ink'], cancelled: ['Cancelled', 'bg-placeholder text-ink'], accepted: ['Accepted', 'bg-good-tint text-good'],
};

const LABEL: Record<string, [string, string]> = {
  awaiting_payment: ['Waiting for payment', 'bg-warn-tint text-warn'], paid: ['In progress', 'bg-good-tint text-good'], in_production: ['In production', 'bg-good-tint text-good'],
  delivered: ['Delivered', 'bg-placeholder text-ink'], refunded: ['Refunded', 'bg-placeholder text-ink'], cancelled: ['Cancelled', 'bg-placeholder text-ink'],
};

export default async function Account(props: { searchParams: Promise<{ e?: string; saved?: string; reminder?: string }> }) {
  const searchParams = await props.searchParams;
  const c = await requireCustomer('/account');
  const [orders, used, company, requests, invite, settings, kit, weekly] = await Promise.all([
    ordersForCustomer(c.id), methodsFor(c.id),
    c.business_id ? one<{ name: string }>('select name from businesses where id = $1', [c.business_id]) : Promise.resolve(null),
    requestsForCustomer(c.id),
    referralSummary(c.id),
    getSettings(),
    brandKitFor(c.id),
    weeklyFor(c.id),
  ]);
  const ways = [
    c.google_sub && { icon: <GoogleIcon className="h-4 w-4" />, label: 'Google', detail: c.email },
    c.email && c.email_verified && !c.google_sub && { icon: <Check className="h-4 w-4 text-good" />, label: 'Email', detail: c.email },
    c.phone && { icon: <Check className="h-4 w-4 text-good" />, label: 'Phone', detail: `0${formatLocal(c.phone)}` },
  ].filter(Boolean) as { icon: React.ReactNode; label: string; detail: string | null }[];
  void used;
  const studioCount = Number((await oneRow<{ n: string }>("select count(*) as n from studio_projects where customer_id = $1 and status <> 'purged'", [c.id]))?.n ?? 0);

  return (
    <div className="mx-auto grid max-w-[1160px] grid-cols-[minmax(0,1fr)] gap-8 px-5 py-8 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
      <aside className="card grid gap-5 p-6 lg:sticky lg:top-24">
        <div className="flex items-center gap-4">
          <Avatar name={c.name ?? c.email} className="h-14 w-14 text-[24px]" />
          <div className="min-w-0">
            <h1 className="truncate text-[26px] leading-tight">{c.name ?? 'Your account'}</h1>
            {company && <p className="truncate text-[15px] text-muted">{company.name}</p>}
          </div>
        </div>
        <dl className="grid gap-3 text-[15px]">
          <div><dt className="font-bold text-muted">Order updates go to</dt><dd className="tabular">{contactPhone(c) ? `0${formatLocal(contactPhone(c)!)}` : 'Add a number'}</dd></div>
          {c.email && <div><dt className="font-bold text-muted">Receipts go to</dt><dd className="break-all">{c.email}</dd></div>}
          {c.default_area && <div><dt className="font-bold text-muted">Usual delivery area</dt><dd>{c.default_area}</dd></div>}
        </dl>
        <div className="grid min-w-0 gap-2 border-t border-line pt-4">
          <p className="text-[14px] font-bold text-muted">You can sign in with</p>
          <ul className="grid min-w-0 gap-1.5 text-[15px]">
            {ways.map((w) => <li key={w.label} className="flex min-w-0 items-center gap-2.5"><span className="grid h-5 w-5 place-items-center">{w.icon}</span><span className="font-bold">{w.label}</span><span className="min-w-0 truncate text-muted">{w.detail}</span></li>)}
          </ul>
        </div>
        <div className="grid gap-2">
          <Link href="/welcome?edit=1" className="btn-secondary btn-sm">Edit my details</Link>
          <form action={signOut}><button className="btn-ghost btn-sm w-full">Sign out</button></form>
        </div>
        <details className="border-t border-line pt-4 text-[14px]" open={!!searchParams.saved}>
          <summary className="cursor-pointer font-bold text-muted">Messages and language</summary>
          <form action={savePreferences} className="mt-3 grid gap-3">
            <label className="flex min-h-[44px] items-start gap-3"><input type="checkbox" name="nudge_ok" defaultChecked={c.nudge_ok} className="mt-0.5 h-5 w-5 accent-[#0B1F33]" /><span>Remind me once if I leave an order unpaid</span></label>
            <label className="flex min-h-[44px] items-start gap-3"><input type="checkbox" name="reminders_ok" defaultChecked={c.reminders_ok} className="mt-0.5 h-5 w-5 accent-[#0B1F33]" /><span>Remind me to order again when I may be running low</span></label>
            {settings.pidgin_enabled && (
              <fieldset className="grid gap-1">
                <legend className="font-bold text-muted">Wording of buttons and messages</legend>
                <label className="flex min-h-[44px] items-center gap-3"><input type="radio" name="lang" value="en" defaultChecked={c.lang !== 'pcm'} className="h-5 w-5 accent-[#0B1F33]" />English</label>
                <label className="flex min-h-[44px] items-center gap-3"><input type="radio" name="lang" value="pcm" defaultChecked={c.lang === 'pcm'} className="h-5 w-5 accent-[#0B1F33]" />Pidgin</label>
              </fieldset>
            )}
            <button className="btn-secondary btn-sm self-start">Save</button>
            {searchParams.saved && <p role="status" className="text-good">Saved.</p>}
          </form>
        </details>
        <details className="border-t border-line pt-4 text-[14px]">
          <summary className="cursor-pointer font-bold text-muted">Your data</summary>
          <div className="mt-3 grid gap-2">
            <a href="/api/account/export" className="link">Download my data</a>
            <Link href="/account/delete" className="link">Delete my account</Link>
          </div>
        </details>
      </aside>

      <section className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-[30px] leading-tight">Your orders</h2>
          <div className="flex flex-wrap gap-2"><Link href="/custom-order" className="btn-secondary btn-sm">Ask for a custom price</Link><Link href="/products" className="btn-primary btn-sm">Start a new order</Link></div>
        </div>
        {searchParams.e && <Notice tone="bad">{searchParams.e}</Notice>}
        {searchParams.reminder === '1' && <Notice tone="good">Done. We will remind you every week.</Notice>}
        {searchParams.reminder === '0' && <Notice tone="good">Reminder stopped.</Notice>}
        {company && (
          <Link href="/account/business" className="card flex items-center justify-between gap-3 p-4 hover:border-ink">
            <span><span className="block text-[17px] font-bold">{company.name}</span><span className="text-[14px] text-muted">{c.business_role === 'member' ? 'Your company account. See your company orders.' : 'Your team, company orders and the monthly statement.'}</span></span>
            <span aria-hidden className="text-[22px]">›</span>
          </Link>
        )}
        <Link href="/account/brand" className="card flex items-center justify-between gap-3 p-4 hover:border-ink">
          <span><span className="block text-[17px] font-bold">{kit ? 'Your brand kit' : 'Set up your brand kit'}</span><span className="text-[14px] text-muted">{kit ? 'Your logo, colours and approved designs, ready for every order.' : 'Save your logo and colours once. We use them every time you order.'}</span></span>
          <span aria-hidden className="text-[22px]">›</span>
        </Link>
        {settings.studio_enabled && runnable() && (
          <Link href={studioCount > 0 ? '/studio/projects' : '/studio'} className="card flex items-center justify-between gap-3 p-4 hover:border-ink">
            <span><span className="block text-[17px] font-bold">{studioCount > 0 ? `My designs (${studioCount})` : 'Make a design with Brandit Studio'}</span><span className="text-[14px] text-muted">{studioCount > 0 ? 'Open a design, change a word, or print it again.' : 'Type your words, see free sketches, and get a print-ready design.'}</span></span>
            <span aria-hidden className="text-[22px]">›</span>
          </Link>
        )}
        {invite && <InviteCard r={invite} />}
        {requests.length > 0 && (
          <div className="grid gap-3" aria-label="Your custom price requests">
            <p className="text-[15px] font-bold text-muted">Your custom price requests</p>
            {requests.map((r) => {
              const [label, tone] = REQUEST_LABEL[r.effective] ?? [r.effective, 'bg-placeholder text-ink'];
              return (
                <Link key={r.id} href={`/custom-order/${r.public_token}`} className="card flex items-start justify-between gap-3 p-4 hover:border-ink">
                  <div className="min-w-0">
                    <p className="truncate text-[17px] font-bold">{r.title}</p>
                    <p className="text-[14px] text-muted"><span className="font-bold text-ink">{r.code}</span> asked {describeWhen(new Date(r.created_at))}</p>
                  </div>
                  <div className="grid justify-items-end gap-1"><span className={`pill ${tone}`}>{label}</span>{r.effective === 'quoted' && r.quote_price_kobo && <span className="font-display text-[18px] font-extrabold tabular">{naira(r.quote_price_kobo)}</span>}</div>
                </Link>
              );
            })}
          </div>
        )}
        {orders.length === 0 ? (
          <div className="card grid justify-items-center gap-3 p-10 text-center">
            <p className="font-display text-[24px] font-extrabold">Nothing here yet.</p>
            <p className="text-muted">What do you need printed?</p>
            <Link className="btn-primary" href="/products">Choose a product</Link>
          </div>
        ) : orders.map((o) => {
          const [label, tone] = LABEL[o.status] ?? [o.status, 'bg-placeholder text-ink'];
          return (
            <article key={o.id} className="card grid gap-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[19px] font-bold">{o.custom_request_id || o.line_count > 1 ? o.product_name : `${o.quantity.toLocaleString('en-US')} × ${o.product_name}`}</p>
                  <p className="mt-0.5 text-[14px] text-muted"><span className="font-bold text-ink">{o.code}</span> ordered {describeWhen(new Date(o.created_at))}</p>
                </div>
                <div className="grid justify-items-end gap-1"><span className={`pill ${tone}`}>{label}</span><span className="font-display text-[20px] font-extrabold tabular">{naira(o.total_kobo)}</span></div>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <Link href={`/track/${o.public_token}`} className="btn-secondary btn-sm">Track</Link>
                <Link href={`/invoice/${o.public_token}`} className="btn-secondary btn-sm">Receipt</Link>
                {o.custom_request_id
                  ? <Link href="/custom-order" className="btn-primary btn-sm">Ask for another price</Link>
                  : <form action={sameAgain}><input type="hidden" name="token" value={o.public_token} /><button className="btn-primary btn-sm">Same again</button></form>}
              </div>
              {!o.custom_request_id && ['paid', 'in_production', 'delivered'].includes(o.status) && settings.reminders_enabled && c.reminders_ok && (() => {
                const w = weekly.get(o.id);
                return w ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-md2 bg-paper2 px-4 py-3 text-[15px]">
                    <p><b>Weekly reminder:</b> every {WEEKDAYS[w.weekday - 1]} morning, to order this again.</p>
                    <form action={stopWeeklyReminder}><input type="hidden" name="id" value={w.id} /><button className="link font-bold">Stop</button></form>
                  </div>
                ) : (
                  <details className="text-[15px]">
                    <summary className="cursor-pointer font-bold text-muted">Order this every week? Get a reminder</summary>
                    <form action={setWeeklyReminder} className="mt-3 flex flex-wrap items-end gap-3">
                      <input type="hidden" name="token" value={o.public_token} />
                      <div><label className="label" htmlFor={`wd-${o.id}`}>Remind me on</label>
                        <select id={`wd-${o.id}`} name="weekday" defaultValue="4" className="field">{WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></div>
                      <button className="btn-secondary btn-sm">Remind me</button>
                    </form>
                    <p className="mt-2 text-[13px] text-muted">We message you at 8am on WhatsApp with one tap to order the same again. You can stop any time.</p>
                  </details>
                );
              })()}
            </article>
          );
        })}
      </section>
    </div>
  );
}
