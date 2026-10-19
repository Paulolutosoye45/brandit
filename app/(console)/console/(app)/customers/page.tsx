import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { can } from '@/lib/permissions';
import { FILTERS, listCustomers, type CustomerFilter } from '@/lib/customers';
import { naira } from '@/lib/money';
import { describeWhen } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Customers' };

export default async function Customers(props: { searchParams: Promise<{ q?: string; f?: string; p?: string; s?: string }> }) {
  const sp = await props.searchParams;
  const staff = await requireStaff('see_customers');
  const filter = (FILTERS.some((x) => x.key === sp.f) ? sp.f : 'all') as CustomerFilter;
  const sort = sp.s === 'spent' || sp.s === 'orders' ? sp.s : 'recent';
  const q = (sp.q ?? '').trim().slice(0, 80);
  const { rows, total, pages, page } = await listCustomers({ q, filter, sort, page: Number(sp.p) || 1 });
  const href = (o: { f?: string; s?: string; p?: number }) => {
    const u = new URLSearchParams();
    const f = o.f ?? filter, s = o.s ?? sort;
    if (q) u.set('q', q);
    if (f !== 'all') u.set('f', f);
    if (s !== 'recent') u.set('s', s);
    if (o.p && o.p > 1) u.set('p', String(o.p));
    const t = u.toString();
    return `/console/customers${t ? `?${t}` : ''}`;
  };
  const exportHref = `/console/customers/export?${new URLSearchParams({ ...(q ? { q } : {}), f: filter }).toString()}`;
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-[34px]">Customers</h1><p className="text-muted">{total.toLocaleString('en-NG')} {total === 1 ? 'person' : 'people'}{filter !== 'all' ? ` in “${FILTERS.find((x) => x.key === filter)!.label}”` : ''}. Search by name, phone, email, company or order code.</p></div>
        {can(staff.role, 'export_customers') && <a className="btn-secondary btn-sm" href={exportHref} download>Download as spreadsheet</a>}
      </div>
      <form className="flex max-w-[560px] gap-3" role="search">
        <input name="q" defaultValue={q} className="field" placeholder="Name, 0803…, email or BR-1042" aria-label="Search customers" />
        {filter !== 'all' && <input type="hidden" name="f" value={filter} />}
        <button className="btn-dark">Search</button>
      </form>
      <nav aria-label="Filter" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => <Link key={f.key} href={href({ f: f.key })} aria-current={f.key === filter ? 'true' : undefined} className={`inline-flex min-h-[44px] items-center rounded-full border-2 px-4 font-bold ${f.key === filter ? 'border-ink bg-ink text-white' : 'border-line-control bg-surface hover:border-ink'}`}>{f.label}</Link>)}
      </nav>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-[15px]">
          <thead><tr className="border-b border-line text-[13px] text-muted">
            <th className="px-4 py-3 font-bold">Customer</th><th className="px-4 py-3 font-bold">Contact</th>
            <th className="px-4 py-3 font-bold"><Link className="underline" href={href({ s: 'orders' })}>Orders</Link></th>
            <th className="px-4 py-3 font-bold"><Link className="underline" href={href({ s: 'spent' })}>Paid in total</Link></th>
            <th className="px-4 py-3 font-bold"><Link className="underline" href={href({ s: 'recent' })}>Last order</Link></th><th className="px-4 py-3" />
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">No one matches. Try fewer letters, or the phone number without spaces.</td></tr>}
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3"><Link href={`/console/customers/${c.id}`} className="font-bold underline">{c.name ?? 'No name yet'}</Link>{c.company && <span className="block text-[13px] text-muted">{c.company}</span>}{c.account_type === 'business' && !c.company && <span className="block text-[13px] text-muted">Business account</span>}</td>
                <td className="px-4 py-3">{c.whatsapp_phone ?? c.phone ?? '—'}<span className="block text-[13px] text-muted">{c.email ?? ''}</span></td>
                <td className="px-4 py-3 tabular">{c.orders}</td>
                <td className="px-4 py-3 tabular">{c.spent_kobo ? naira(c.spent_kobo) : '—'}</td>
                <td className="px-4 py-3 whitespace-nowrap text-muted">{c.last_order_at ? describeWhen(new Date(c.last_order_at)) : `joined ${describeWhen(new Date(c.created_at))}`}</td>
                <td className="px-4 py-2"><Link className="btn-secondary btn-sm" href={`/console/customers/${c.id}`}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between gap-3">
          {page > 1 ? <Link className="btn-secondary btn-sm" href={href({ p: page - 1 })}>← Newer</Link> : <span />}
          <span className="text-muted">Page {page} of {pages}</span>
          {page < pages ? <Link className="btn-secondary btn-sm" href={href({ p: page + 1 })}>Older →</Link> : <span />}
        </div>
      )}
    </div>
  );
}
