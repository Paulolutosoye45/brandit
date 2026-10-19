import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { query } from '@/lib/db';
import { can } from '@/lib/permissions';
import { naira } from '@/lib/money';
import { describeWhen } from '@/lib/time';
import { summarySql, proofLabel, proofStateOf } from '@/lib/lines';
import { STAGE_LABEL, type Stage } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Orders' };

export default async function Orders(props: { searchParams: Promise<{ q?: string }> }) {
  const searchParams = await props.searchParams;
  const staff = await requireStaff();
  const contact = can(staff.role, 'see_contact');
  const q = (searchParams.q ?? '').trim();
  const rows = await query<any>(
    `select o.id, o.code, o.public_token, o.status, o.total_kobo, o.created_at, c.name, coalesce(c.whatsapp_phone, c.phone) as phone, ${summarySql('o')} as summary,
            (select count(*)::int from order_items x where x.order_id = o.id) as line_count,
            (select j.id from jobs j where j.order_id = o.id order by j.created_at, j.id limit 1) as job_id
     from orders o
     left join customers c on c.id = o.customer_id
     where o.status <> 'draft' and ($1 = '' or o.code ilike $2 ${contact ? 'or c.phone like $2 or c.whatsapp_phone like $2 or c.name ilike $2' : ''})
     order by o.created_at desc limit 60`,
    [q, `%${q}%`],
  );
  const lineJobs = rows.some((r) => r.line_count > 1)
    ? await query<any>(`select j.id, j.order_id, j.stage, coalesce(i.label, p.name) as name, i.quantity, i.artwork_path, i.preview_approved_at, i.artwork_file_id,
         (select pf.status from proofs pf where pf.order_item_id = i.id order by pf.version desc limit 1) as proof_status
         from jobs j join order_items i on i.id = j.order_item_id join products p on p.id = i.product_id where j.order_id = any($1::uuid[]) order by i.position, i.id`, [rows.filter((r) => r.line_count > 1).map((r) => r.id)])
    : [];
  return (
    <div className="grid gap-6">
      <div><h1 className="text-[34px]">Orders</h1><p className="text-muted">{contact ? 'Search by order code, name or phone number.' : 'Search by order code.'}</p></div>
      <form className="flex gap-3 max-w-[520px]"><input name="q" defaultValue={q} className="field" placeholder="BR-1042" aria-label="Search orders" /><button className="btn-dark">Search</button></form>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[15px]">
          <thead><tr className="text-[13px] text-muted border-b border-line">{['Order', 'Product', contact ? 'Customer' : '', 'Status', 'Total', 'When', ''].map((h, i) => <th key={i} className="px-4 py-3 font-bold">{h}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">No orders match.</td></tr>}
            {rows.map((o) => (
              <tr key={o.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3 font-bold"><Link className="underline" href={`/console/orders/${o.code}`}>{o.code}</Link></td>
                <td className="px-4 py-3">
                  {o.summary}
                  {o.line_count > 1 && (
                    <ul className="mt-1 grid gap-0.5 text-[13px] text-muted">
                      {lineJobs.filter((l) => l.order_id === o.id).map((l) => <li key={l.id}><Link className="underline" href={`/console/jobs/${l.id}`}>{l.name} × {l.quantity}</Link> · {STAGE_LABEL[l.stage as Stage]} · {proofLabel(proofStateOf(l, { stage: l.stage }))}</li>)}
                    </ul>
                  )}
                </td>
                <td className="px-4 py-3">{contact ? <>{o.name ?? '—'}<br /><span className="text-muted text-[13px]">{o.phone}</span></> : null}</td>
                <td className="px-4 py-3">{o.status.replace('_', ' ')}</td>
                <td className="px-4 py-3 tabular">{naira(o.total_kobo)}</td>
                <td className="px-4 py-3 whitespace-nowrap">{describeWhen(new Date(o.created_at))}</td>
                <td className="px-4 py-2 whitespace-nowrap">{o.job_id && <Link className="btn-secondary btn-sm" href={`/console/jobs/${o.job_id}`}>Job</Link>} <Link className="btn-secondary btn-sm" href={`/track/${o.public_token}`}>Tracker</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
