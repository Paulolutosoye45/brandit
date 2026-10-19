import Link from 'next/link';
import type { Metadata } from 'next';
import { requireCustomer } from '@/lib/session';
import { businessView, lastMonth } from '@/lib/businessAccounts';
import { naira } from '@/lib/money';
import { describeWhen } from '@/lib/time';
import { Notice } from '@/components/Bits';
import { CopyLink } from './CopyLink';
import { handOverAction, leaveAction, removeMemberAction, replaceLinkAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'My business', robots: { index: false } };

const STATUS: Record<string, string> = { awaiting_payment: 'Waiting for payment', paid: 'In progress', in_production: 'In production', delivered: 'Delivered', refunded: 'Refunded', cancelled: 'Cancelled' };

export default async function BusinessPage(props: { searchParams: Promise<{ e?: string; ok?: string; joined?: string }> }) {
  const sp = await props.searchParams;
  const c = await requireCustomer('/account/business');
  const b = await businessView(c.id);
  if (!b) {
    return (
      <div className="mx-auto grid max-w-[720px] gap-5 px-5 py-8">
        <Link href="/account" className="text-[14px] text-muted underline">My account</Link>
        <h1 className="text-[34px] leading-tight">My business</h1>
        <div className="card grid gap-3 p-6">
          <p className="text-[17px]">You are not under a company account. Add your company name when you check out or under <Link href="/welcome?edit=1" className="link">Edit my details</Link>, and you can invite your team here. Or open the join link your company owner sent you.</p>
        </div>
      </div>
    );
  }
  const owner = b.role === 'owner';
  const month = lastMonth();
  return (
    <div className="mx-auto grid max-w-[860px] gap-6 px-5 py-8">
      <div>
        <Link href="/account" className="text-[14px] text-muted underline">My account</Link>
        <h1 className="mt-1 text-[34px] leading-tight sm:text-[44px]">{b.name}</h1>
        <p className="mt-1 text-[17px] text-muted">{owner ? 'You own this company account.' : `${b.ownerName} owns this company account. You order for the company.`}{b.taxId ? ` Tax ID ${b.taxId}.` : ''}</p>
      </div>
      {sp.joined && <Notice tone="good">You have joined {b.name}. Your orders now carry the company name.</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}

      <section className="card grid gap-4 p-5 sm:p-6" aria-labelledby="team-h">
        <h2 id="team-h" className="text-[22px]">People ({b.members.length})</h2>
        <ul className="grid gap-2">
          {b.members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md2 border border-line p-3">
              <div className="min-w-0">
                <p className="truncate font-bold">{m.name}{m.id === c.id ? ' (you)' : ''} <span className="pill bg-placeholder text-ink">{m.role === 'owner' ? 'Owner' : 'Member'}</span></p>
                <p className="text-[14px] text-muted">Joined {describeWhen(new Date(m.joinedAt))}{owner ? ` · ${m.orders} paid order${m.orders === 1 ? '' : 's'}` : ''}{m.phone ? ` · ${m.phone}` : ''}</p>
              </div>
              {owner && m.id !== c.id && (
                <div className="flex gap-3">
                  <form action={handOverAction}><input type="hidden" name="id" value={m.id} /><button className="link font-bold" aria-label={`Hand the company account to ${m.name}`}>Hand over</button></form>
                  <form action={removeMemberAction}><input type="hidden" name="id" value={m.id} /><button className="link font-bold text-bad" aria-label={`Remove ${m.name}`}>Remove</button></form>
                </div>
              )}
            </li>
          ))}
        </ul>
        {owner && b.joinUrl && (
          <div className="grid gap-2 border-t border-line pt-4">
            <h3 className="text-[18px]">Invite your team</h3>
            <p className="text-[15px] text-muted">Send this link on WhatsApp. Anyone who opens it and signs in joins {b.name}. Replace it if it reaches the wrong person.</p>
            <CopyLink url={b.joinUrl} />
            <form action={replaceLinkAction}><button className="btn-ghost btn-sm !px-0 underline">Make a new link</button></form>
          </div>
        )}
        {!owner && <form action={leaveAction}><button className="btn-ghost btn-sm !px-0 underline">Leave this company</button></form>}
      </section>

      {owner && (
        <section className="card grid gap-3 p-5 sm:p-6" aria-labelledby="stmt-h">
          <h2 id="stmt-h" className="text-[22px]">Monthly statement</h2>
          <p className="text-[15px] text-muted">Every company order paid in a month, with print, design, delivery, discount and VAT, ready for your finance team.</p>
          <form action="/account/business/statement" className="flex flex-wrap items-end gap-3">
            <div><label className="label" htmlFor="stmt-month">Month</label><input id="stmt-month" name="month" type="month" defaultValue={month} className="field" /></div>
            <button className="btn-secondary btn-sm">See statement</button>
          </form>
        </section>
      )}

      <section className="grid gap-3" aria-labelledby="orders-h">
        <h2 id="orders-h" className="text-[22px]">{owner ? 'Company orders' : 'Your orders for the company'}</h2>
        {b.orders.length === 0 ? <p className="text-muted">No orders yet.</p> : (
          <ul className="grid gap-2">
            {b.orders.map((o) => (
              <li key={o.code}>
                <Link href={`/track/${o.token}`} className="card flex items-start justify-between gap-3 p-4 hover:border-ink">
                  <span className="min-w-0"><span className="block truncate font-bold">{o.summary || o.code}</span><span className="block text-[14px] text-muted"><b className="text-ink">{o.code}</b>{owner && o.by ? ` · ${o.by}` : ''} · {describeWhen(new Date(o.createdAt))}</span></span>
                  <span className="grid justify-items-end gap-0.5"><span className="font-display text-[18px] font-extrabold tabular">{naira(o.totalKobo)}</span><span className="text-[13px] text-muted">{STATUS[o.status] ?? o.status}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-[14px] text-muted">The company&apos;s <Link href="/account/brand" className="link">brand kit</Link> is used on every order.</p>
    </div>
  );
}
