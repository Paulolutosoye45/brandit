import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { POLICY_PAGES, allOverrides } from '@/lib/contentPages';
import { faqRows } from '@/lib/faqContent';
import { describeWhen } from '@/lib/time';
import { getBusiness } from '@/lib/business';
import { Notice } from '@/components/Bits';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'FAQ and policies' };

export default async function Pages() {
  await requireStaff('manage_content');
  const [over, rows, biz] = await Promise.all([allOverrides(), faqRows(), getBusiness()]);
  const edits = rows.filter((r) => r.key && !r.hidden).length, hidden = rows.filter((r) => r.hidden).length, added = rows.filter((r) => !r.key).length;
  return (
    <div className="grid max-w-[820px] gap-6">
      <div><h1 className="text-[34px]">FAQ and policies</h1><p className="text-muted">The words on the Questions page and the legal pages. The built-in text stays until you save your own, and every version you publish is kept.</p></div>
      {!biz.legalReviewed && <Notice tone="warn">The Terms, Privacy and Refunds pages still say “draft for legal review”. Once a Nigerian lawyer has been through them, publish their wording below and tick the box in <Link className="underline" href="/console/business">Business details</Link>.</Notice>}
      <ul className="grid gap-3">
        <li className="card flex flex-wrap items-center justify-between gap-3 p-5">
          <div><p className="text-[19px] font-bold">Questions and answers (FAQ)</p><p className="text-muted">{edits} changed · {added} added · {hidden} hidden</p></div>
          <div className="flex gap-2"><Link href="/faq" target="_blank" className="btn-secondary btn-sm">View</Link><Link href="/console/pages/faq" className="btn-dark btn-sm">Edit</Link></div>
        </li>
        {POLICY_PAGES.map((p) => {
          const o = over.find((x) => x.slug === p.slug);
          return (
            <li key={p.slug} className="card flex flex-wrap items-center justify-between gap-3 p-5">
              <div><p className="text-[19px] font-bold">{p.title}</p><p className="text-muted">{o ? `Your version, saved ${describeWhen(new Date(o.updated_at))} by ${o.updated_by}` : 'Built-in version'}</p></div>
              <div className="flex gap-2"><Link href={p.path} target="_blank" className="btn-secondary btn-sm">View</Link><Link href={`/console/pages/${p.slug}`} className="btn-dark btn-sm">{o ? 'Edit' : 'Write your own'}</Link></div>
            </li>
          );
        })}
      </ul>
      <p className="text-[15px] text-muted">The Delivery page shows your delivery areas and fees automatically: change those in Delivery &amp; rules.</p>
    </div>
  );
}
