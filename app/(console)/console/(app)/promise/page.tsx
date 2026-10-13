import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { query } from '@/lib/db';
import { naira } from '@/lib/money';
import { describeWhen } from '@/lib/time';
import { Notice } from '@/components/Bits';
import { decide } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Promise desk' };
const KIND: Record<string, string> = { late: 'Late', wrong_print: 'Printed wrong', damaged: 'Damaged', other: 'Other' };

export default async function PromiseDesk(props: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const searchParams = await props.searchParams;
  await requireStaff('claims');
  const base = `select c.*, o.code, o.public_token, o.total_kobo, o.delivery_fee_kobo, cu.name as cname, coalesce(cu.whatsapp_phone, cu.phone) as phone, j.id as job_id, coalesce(i.label, p.name) as product
     from claims c join orders o on o.id = c.order_id join order_items i on i.order_id = o.id join products p on p.id = i.product_id
     left join customers cu on cu.id = o.customer_id left join jobs j on j.order_id = o.id`;
  const open = await query<any>(`${base} where c.status = 'open' order by c.created_at`);
  const done = await query<any>(`${base} where c.status = 'resolved' order by c.resolved_at desc limit 25`);
  return (
    <div className="grid gap-8 max-w-[980px]">
      <div><h1 className="text-[34px]">Promise desk</h1><p className="text-muted">Problems customers report, and the late orders the system refunded by itself. Decide fast: a quick yes is worth more than the cost of the job.</p></div>
      {searchParams.e && <Notice tone="bad">{searchParams.e}</Notice>}
      {searchParams.ok && <Notice tone="good">{searchParams.ok}</Notice>}

      <section className="grid gap-4"><h2 className="text-[24px]">Waiting for a decision ({open.length})</h2>
        {open.length === 0 && <div className="card p-8 text-center text-muted">No open reports. Nothing is waiting on you.</div>}
        {open.map((c) => (
          <div key={c.id} className="card p-5 grid gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="font-bold text-[19px]">{c.code} · {c.product}</p><p className="text-[14px] text-muted">{c.cname} · {c.phone} · reported {describeWhen(new Date(c.created_at))}</p></div>
              <span className="pill bg-warn-tint text-warn">{KIND[c.kind]}</span>
            </div>
            <p className="whitespace-pre-wrap">&ldquo;{c.description}&rdquo;</p>
            {c.photo_file_id && <a href={`/api/files/${c.photo_file_id}`} target="_blank" rel="noreferrer" className="underline font-bold">Open the customer&apos;s photo</a>}
            <form action={decide} className="grid gap-3 border-t border-line pt-4">
              <input type="hidden" name="id" value={c.id} />
              <fieldset className="flex flex-wrap gap-4">
                <legend className="label">Decision</legend>
                {[['reprint', 'Reprint at no charge'], ['refund', 'Refund'], ['rejected', 'Reject, with a reason']].map(([v, l]) => <label key={v} className="flex items-center gap-2 min-h-[44px]"><input type="radio" name="resolution" value={v} className="h-5 w-5 accent-[#0B1F33]" />{l}</label>)}
              </fieldset>
              <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                <div><label className="label" htmlFor={`am-${c.id}`}>Refund amount (₦)</label><input id={`am-${c.id}`} name="amount" className="field" placeholder={String(c.total_kobo / 100)} /></div>
                <div><label className="label" htmlFor={`nt-${c.id}`}>Note (the customer sees this if you reject)</label><input id={`nt-${c.id}`} name="note" className="field" /></div>
              </div>
              <div className="flex flex-wrap gap-3"><button className="btn-primary btn-sm">Record decision</button>{c.job_id && <Link className="btn-secondary btn-sm" href={`/console/jobs/${c.job_id}`}>Open the job</Link>}<Link className="btn-secondary btn-sm" href={`/track/${c.public_token}`}>See what the customer sees</Link></div>
            </form>
          </div>
        ))}
      </section>

      <section className="grid gap-3"><h2 className="text-[24px]">Closed recently</h2>
        <div className="card overflow-x-auto"><table className="w-full min-w-[640px] text-[15px] text-left">
          <thead><tr className="text-[13px] text-muted border-b border-line">{['Order', 'Problem', 'Decision', 'Cost', 'Decided by', 'When'].map((h) => <th key={h} className="px-4 py-3 font-bold">{h}</th>)}</tr></thead>
          <tbody>{done.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">Nothing yet.</td></tr>}
            {done.map((c) => (<tr key={c.id} className="border-b border-line last:border-0"><td className="px-4 py-3 font-bold">{c.code}</td><td className="px-4 py-3">{KIND[c.kind]}</td><td className="px-4 py-3">{String(c.resolution ?? '').replace('_', ' ')}</td><td className="px-4 py-3 tabular">{naira(c.cost_kobo)}</td><td className="px-4 py-3">{c.source === 'system' ? 'Automatic' : 'A person'}</td><td className="px-4 py-3 whitespace-nowrap">{describeWhen(new Date(c.resolved_at))}</td></tr>))}</tbody>
        </table></div>
      </section>
    </div>
  );
}
