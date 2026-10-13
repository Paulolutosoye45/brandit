import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { listRequests, requestCounts, type ListFilter } from '@/lib/custom';
import { naira } from '@/lib/money';
import { Notice } from '@/components/Bits';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Custom orders' };

const TABS: { key: ListFilter; label: string; hint: string }[] = [
  { key: 'todo', label: 'Needs a price', hint: 'Customers waiting for you' },
  { key: 'waiting', label: 'Price sent', hint: 'Waiting for the customer to decide' },
  { key: 'won', label: 'Accepted', hint: 'Became orders' },
  { key: 'closed', label: 'Closed', hint: 'Declined or cancelled' },
];

const ago = (d: string) => {
  const m = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60000));
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)} hr ago`;
  return `${Math.floor(m / 1440)} day${Math.floor(m / 1440) === 1 ? '' : 's'} ago`;
};

export default async function CustomDesk(props: { searchParams: Promise<{ tab?: string; e?: string; ok?: string }> }) {
  const sp = await props.searchParams;
  await requireStaff('quote_custom');
  const tab = (TABS.find((t) => t.key === sp.tab)?.key ?? 'todo') as ListFilter;
  const [rows, counts] = await Promise.all([listRequests(tab), requestCounts()]);
  return (
    <div className="grid gap-6 max-w-[980px]">
      <div><h1 className="text-[34px]">Custom orders</h1><p className="text-muted">Customers describe a job, you send a price and a time, they accept and pay. Reply fast: the first price usually wins.</p></div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      <nav aria-label="Custom order lists" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={`/console/custom?tab=${t.key}`} aria-current={tab === t.key ? 'page' : undefined} className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border-2 px-4 font-bold ${tab === t.key ? 'border-ink bg-ink text-white' : 'border-line bg-surface hover:border-ink'}`}>
            {t.label}<span className={`rounded-full px-2 text-[13px] ${tab === t.key ? 'bg-white/20' : 'bg-paper2'}`}>{counts[t.key]}</span>
          </Link>
        ))}
      </nav>
      <p className="text-[14px] text-muted -mt-3">{TABS.find((t) => t.key === tab)!.hint}</p>
      {rows.length === 0 ? (
        <div className="card p-8 text-center"><p className="font-bold text-[18px]">{tab === 'todo' ? 'Nothing waiting for a price.' : 'Nothing here yet.'}</p><p className="text-muted">New requests appear here as soon as a customer sends one.</p></div>
      ) : (
        <ul className="grid gap-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/console/custom/${r.id}`} className="card p-4 sm:p-5 grid gap-1 hover:border-ink transition-colors">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold text-[18px]">{r.kind === 'event' && <span className="pill mr-2 bg-accent align-middle text-ink">Event</span>}{r.title}</p>
                  <p className="text-[14px] text-muted">{r.code} · {ago(r.created_at)}</p>
                </div>
                <p className="text-[15px] text-muted line-clamp-2">{r.details}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px]">
                  <span className="font-bold">{r.name}</span>
                  {r.product_name && <span>Like: {r.product_name}</span>}
                  {r.quantity_text && <span>{r.quantity_text}</span>}
                  {r.budget_kobo != null && <span>Budget {naira(r.budget_kobo)}</span>}
                  {r.quote_price_kobo != null && <span className="font-bold">Quoted {naira(r.quote_price_kobo)}</span>}
                  {r.effective === 'expired' && <span className="pill bg-warn-tint text-warn">Price expired</span>}
                  {r.order_status && <span className="pill bg-placeholder text-ink">Order {r.order_code}: {r.order_status.replace('_', ' ')}</span>}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
