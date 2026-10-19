import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { getProductById } from '@/lib/catalog';
import { runPriceTests } from '@/lib/priceTestRun';
import { PriceTestView } from '@/components/PriceTestView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Price test' };

export default async function ProductTest(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  await requireStaff('manage_catalog');
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const p = await getProductById(id);
  if (!p) notFound();
  const [report] = await runPriceTests(p.slug);
  if (!report) notFound();
  return (
    <div className="grid max-w-[900px] gap-6">
      <div>
        <Link href={`/console/products/${id}/prices`} className="text-[14px] text-muted underline">Price grid for {p.name}</Link>
        <h1 className="mt-1 text-[34px]">Price test: {p.name}</h1>
        <p className="text-muted">We price every combination a customer could build, at every quantity step and between steps, the way the website does. A <b>failure</b> is something a customer could hit that would break or charge the wrong amount. A <b>look at this</b> is not wrong, but worth a glance, such as a thin margin. Nothing is changed by this page.</p>
      </div>
      <PriceTestView report={report} open />
      <div className="flex flex-wrap gap-3">
        <Link className="btn-secondary btn-sm" href={`/console/products/${id}/prices`}>Back to the price grid</Link>
        <Link className="btn-ghost btn-sm" href="/console/products/test">Test every product</Link>
      </div>
    </div>
  );
}
