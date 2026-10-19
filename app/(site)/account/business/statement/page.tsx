import Link from 'next/link';
import type { Metadata } from 'next';
import { requireCustomer } from '@/lib/session';
import { lastMonth, statementFor } from '@/lib/businessAccounts';
import { naira } from '@/lib/money';
import { Notice } from '@/components/Bits';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Monthly statement', robots: { index: false } };

export default async function StatementPage(props: { searchParams: Promise<{ month?: string }> }) {
  const sp = await props.searchParams;
  const c = await requireCustomer('/account/business');
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? sp.month! : lastMonth();
  const s = await statementFor(c.id, month);
  if (!s) {
    return (
      <div className="mx-auto grid max-w-[720px] gap-4 px-5 py-8">
        <Link href="/account/business" className="text-[14px] text-muted underline">My business</Link>
        <Notice tone="warn">The statement is for the owner of a company account, and the month has to be valid.</Notice>
      </div>
    );
  }
  const t = s.totals;
  return (
    <div className="mx-auto grid max-w-[1000px] gap-5 px-5 py-8">
      <div>
        <Link href="/account/business" className="text-[14px] text-muted underline print:hidden">My business</Link>
        <h1 className="mt-1 text-[32px] leading-tight sm:text-[40px]">{s.business}</h1>
        <p className="text-[17px] text-muted">Statement for {s.label}{s.taxId ? ` · Tax ID ${s.taxId}` : ''}</p>
      </div>
      <div className="flex flex-wrap gap-2 print:hidden">
        <a className="btn-primary btn-sm" href={`/api/account/business/statement?month=${s.month}`}>Download for Excel (CSV)</a>
        <form action="/account/business/statement" className="flex items-center gap-2">
          <label className="sr-only" htmlFor="m">Month</label>
          <input id="m" name="month" type="month" defaultValue={s.month} className="field !min-h-[40px]" />
          <button className="btn-secondary btn-sm">Show</button>
        </form>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="card p-4"><p className="text-[13px] font-bold text-muted">Orders</p><p className="font-display text-[26px] font-extrabold tabular">{s.lines.length}</p></div>
        <div className="card p-4"><p className="text-[13px] font-bold text-muted">Print and design</p><p className="font-display text-[26px] font-extrabold tabular">{naira(t.printKobo + t.designKobo)}</p></div>
        <div className="card p-4"><p className="text-[13px] font-bold text-muted">Delivery</p><p className="font-display text-[26px] font-extrabold tabular">{naira(t.deliveryKobo)}</p></div>
        <div className="card p-4"><p className="text-[13px] font-bold text-muted">Total paid</p><p className="font-display text-[26px] font-extrabold tabular">{naira(t.totalKobo)}</p></div>
      </div>
      {s.lines.length === 0 ? <p className="text-muted">No company orders were paid in {s.label}.</p> : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-[15px]">
            <thead><tr className="border-b border-line text-[13px] text-muted"><th className="p-3">Order</th><th className="p-3">Paid</th><th className="p-3">By</th><th className="p-3">What</th><th className="p-3 text-right">VAT incl.</th><th className="p-3 text-right">Total</th></tr></thead>
            <tbody>
              {s.lines.map((l) => (
                <tr key={l.code} className="border-b border-line align-top last:border-0">
                  <td className="p-3 font-bold">{l.code}</td><td className="p-3 tabular">{l.paidAt.slice(0, 10)}</td><td className="p-3">{l.by}</td><td className="p-3">{l.summary}</td>
                  <td className="p-3 text-right tabular">{naira(l.vatKobo)}</td><td className="p-3 text-right font-bold tabular">{naira(l.totalKobo)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="bg-paper2 font-bold"><td className="p-3" colSpan={4}>Total</td><td className="p-3 text-right tabular">{naira(t.vatKobo)}</td><td className="p-3 text-right tabular">{naira(t.totalKobo)}</td></tr></tfoot>
          </table>
        </div>
      )}
      <p className="text-[13px] text-muted">Orders paid in {s.label}, by Lagos time. Refunded and cancelled orders are not included. Each order has its own VAT invoice under Company orders.</p>
    </div>
  );
}
