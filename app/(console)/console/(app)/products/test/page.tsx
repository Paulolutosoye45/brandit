import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { runPriceTests } from '@/lib/priceTestRun';
import { PriceTestView } from '@/components/PriceTestView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Price test, every product' };

export default async function AllTests() {
  await requireStaff('manage_catalog');
  const reports = await runPriceTests();
  const failed = reports.filter((r) => !r.ok).length;
  const looks = reports.filter((r) => r.ok && r.warn > 0).length;
  const tried = reports.reduce((n, r) => n + r.scenarios, 0);
  return (
    <div className="grid max-w-[900px] gap-6">
      <div>
        <Link href="/console/products" className="text-[14px] text-muted underline">All products</Link>
        <h1 className="mt-1 text-[34px]">Price test, every product</h1>
        <p className="text-muted">{tried.toLocaleString('en-US')} prices tried across {reports.length} products. Run this after any big price change, before a promotion, and before you put a product on sale.</p>
      </div>
      <div className={`rounded-md2 border-2 p-4 font-bold ${failed ? 'border-bad bg-bad-tint text-bad' : looks ? 'border-warn bg-warn-tint text-warn' : 'border-good bg-good-tint text-good'}`} role="status">
        {failed ? `${failed} of ${reports.length} products failed. Open them below.` : looks ? `Every product passed. ${looks} ha${looks === 1 ? 's' : 've'} things worth a look.` : `Every product passed.`}
      </div>
      <div className="grid gap-3">{reports.map((r) => <PriceTestView key={r.slug} report={r} />)}</div>
    </div>
  );
}
