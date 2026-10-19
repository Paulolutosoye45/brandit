import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { customerDetail } from '@/lib/customers';
import { naira } from '@/lib/money';
import { describeWhen } from '@/lib/time';
import { Notice } from '@/components/Bits';
import { addNoteAction, deleteNoteAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Customer' };

const STATUS: Record<string, string> = { draft: 'Draft', awaiting_payment: 'Waiting to pay', paid: 'Paid', in_production: 'In production', delivered: 'Delivered', cancelled: 'Cancelled', refunded: 'Refunded' };

export default async function CustomerPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; ok?: string }> }) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireStaff('see_customers');
  const d = await customerDetail(id);
  if (!d) notFound();
  const { c } = d;
  const phone = c.whatsapp_phone ?? c.phone;
  const wa = phone ? `https://wa.me/${String(phone).replace(/\D/g, '')}` : null;
  const stat = (label: string, value: string, sub?: string) => (
    <div className="card p-4"><p className="text-[13px] font-bold text-muted">{label}</p><p className="font-display text-[26px] font-extrabold leading-tight tabular">{value}</p>{sub && <p className="text-[13px] text-muted">{sub}</p>}</div>
  );
  return (
    <div className="grid max-w-[1000px] gap-7">
      <div><Link href="/console/customers" className="inline-flex min-h-[44px] items-center text-[15px] font-bold text-muted hover:text-ink">← Customers</Link></div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-[34px]">{c.name ?? 'No name yet'}</h1>
          <p className="text-muted">{d.company ? `${d.company.name}${c.business_role ? ` (${c.business_role === 'owner' ? 'owner' : 'team member'})` : ''}${d.company.tax_id ? ` · tax number ${d.company.tax_id}` : ''} · ` : ''}{c.account_type === 'business' ? 'Business account' : 'Personal account'} · joined {describeWhen(new Date(c.created_at))}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {wa && <a className="btn-primary btn-sm" href={wa} target="_blank" rel="noopener noreferrer">Message on WhatsApp</a>}
          {c.phone || c.email ? <Link className="btn-secondary btn-sm" href={`/console/orders/new?customer=${c.id}`}>New order for them</Link> : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stat('Paid in total', naira(d.stats.spent_kobo), `${d.stats.orders} order${d.stats.orders === 1 ? '' : 's'}`)}
        {stat('Average order', d.stats.orders ? naira(d.stats.average_kobo) : '—')}
        {stat('Last order', d.stats.last ? describeWhen(new Date(d.stats.last)) : '—', d.stats.first ? `first: ${describeWhen(new Date(d.stats.first))}` : undefined)}
        {stat('Designs and problems', `${d.designs} · ${d.claims}`, 'Studio designs · problem reports')}
      </div>

      <section className="card grid gap-3 p-5 sm:grid-cols-2">
        <div><p className="label">Phone</p><p>{c.phone ?? '—'}</p></div>
        <div><p className="label">WhatsApp for updates</p><p>{c.whatsapp_phone ?? (c.phone ? 'Same as phone' : '—')}</p></div>
        <div><p className="label">Email</p><p>{c.email ?? '—'} {c.email && <span className="text-[13px] text-muted">{c.email_verified ? '(verified)' : '(not verified)'}</span>}</p></div>
        <div><p className="label">Signs in with</p><p>{[c.has_google ? 'Google' : null, ...d.methods.filter((m) => m !== 'google').map((m) => (m === 'email' ? 'Email code' : 'Phone code'))].filter(Boolean).join(', ') || 'Has not signed in'}</p></div>
        <div><p className="label">Usual area</p><p>{c.default_area ?? '—'}</p></div>
        <div><p className="label">Messages in</p><p>{c.lang === 'pcm' ? 'Pidgin' : 'English'} · {c.marketing_opt_in ? 'agreed to offers' : 'has not agreed to offers'}</p></div>
      </section>

      <section id="orders" className="grid gap-3">
        <h2 className="text-[22px]">Orders</h2>
        {d.orders.length === 0 ? <p className="text-muted">No orders yet.</p> : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-[15px]">
              <tbody>
                {d.orders.map((o) => (
                  <tr key={o.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 font-bold"><Link className="underline" href={`/console/orders/${o.code}`}>{o.code}</Link></td>
                    <td className="px-4 py-3">{o.summary}</td>
                    <td className="px-4 py-3 text-muted">{STATUS[o.status] ?? o.status}</td>
                    <td className="px-4 py-3 tabular">{naira(o.total_kobo)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">{describeWhen(new Date(o.created_at))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d.custom.length > 0 && <p className="text-[15px] text-muted">Custom requests: {d.custom.map((x) => `${x.code} (${x.title}, ${x.status})`).join(' · ')}</p>}
      </section>

      <section id="notes" className="grid gap-3">
        <h2 className="text-[22px]">Notes for the team</h2>
        <form action={addNoteAction} className="grid max-w-[640px] gap-3">
          <input type="hidden" name="id" value={c.id} />
          <label className="label" htmlFor="note">Add a note (only the team sees it)</label>
          <textarea id="note" name="body" rows={3} maxLength={1000} className="field py-3" placeholder="For example: pays by transfer, always wants the tracker link on WhatsApp." required />
          <button className="btn-dark self-start">Save note</button>
        </form>
        <ul className="grid gap-3">
          {d.notes.map((n) => (
            <li key={n.id} className="card flex items-start justify-between gap-4 p-4">
              <div><p className="whitespace-pre-line">{n.body}</p><p className="mt-1 text-[13px] text-muted">{n.staff_name} · {describeWhen(new Date(n.created_at))}</p></div>
              <form action={deleteNoteAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="note" value={n.id} /><button className="min-h-[44px] text-[14px] font-bold text-muted underline hover:text-bad">Delete</button></form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
