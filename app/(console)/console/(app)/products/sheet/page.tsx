import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { SheetUpload } from './SheetUpload';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Price sheet' };

export default async function SheetPage() {
  await requireStaff('manage_catalog');
  return (
    <div className="grid max-w-[820px] gap-6">
      <div>
        <Link href="/console/products" className="text-[14px] text-muted underline">All products</Link>
        <h1 className="mt-1 text-[34px]">Price sheet</h1>
        <p className="text-muted">Every price in the shop on one spreadsheet, with a column for what each one costs you. Fill it in on a computer or phone, upload it, see exactly what it would change, then save.</p>
      </div>

      <section className="card grid gap-3 p-5" aria-labelledby="dl-h">
        <h2 id="dl-h" className="text-[22px]">1. Download the sheet</h2>
        <p className="text-[15px] text-muted">It opens in Excel or Google Sheets. Each line is one price: a quantity or size in a product&rsquo;s price table, an add-on, a quantity rule (smallest and largest order, and whether customers may type their own quantity), or a delivery fee. Prices that are not set yet are empty.</p>
        <div><a className="btn-primary btn-sm" href="/api/console/products/sheet" download>Download the price sheet</a></div>
      </section>

      <section className="card grid gap-3 p-5" aria-labelledby="fill-h">
        <h2 id="fill-h" className="text-[22px]">2. Fill it in</h2>
        <ul className="list-disc pl-5 text-[15px]">
          <li>Type your selling price in <b>Price (₦)</b> and what it costs you to make in <b>Cost (₦)</b>. Digits only, like 15000.</li>
          <li><b>A new quantity adds a new step.</b> A line for a quantity the product does not have yet creates that step, so one sheet can carry the steps as well as the prices. <b>Quantity rule</b> lines set the smallest and largest online order. <b>Delivery</b> lines set each area&rsquo;s fee and whether 24-hour delivery is offered there. The largest order anywhere in the shop is 10,000 pieces.</li>
          <li><b>An empty box means leave it as it is.</b> To take a price away, use the price grid.</li>
          <li>On the demo and test sites, example prices are marked <b>no</b> in &ldquo;Real price?&rdquo;. Change it to <b>yes</b> once you have checked one.</li>
          <li>Do not change the three <b>key</b> columns on the right. They tell us which price each line is.</li>
          <li>Save it as it is, an Excel file (.xlsx) or CSV, and upload it. Only the <b>Price sheet</b> tab is read.</li>
        </ul>
      </section>

      <section className="card grid gap-3 p-5" aria-labelledby="up-h">
        <h2 id="up-h" className="text-[22px]">3. Upload and check</h2>
        <p className="text-[15px] text-muted">Checking saves nothing. If anything in the sheet is wrong, nothing at all is saved and you are told which line to fix. Orders already placed keep the price they were placed at.</p>
        <SheetUpload />
      </section>
    </div>
  );
}
