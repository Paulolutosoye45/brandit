import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHead } from '@/components/Bits';
import { Check } from '@/components/Bits';
import { getSettings } from '@/lib/settings';
import { contact } from '@/lib/site';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Brandit for business', description: 'Reorder in one tap, VAT invoices, plain-pack delivery for agencies, ID cards for staff, and custom quotes for bigger jobs.' };

export default async function Business() {
  const s = await getSettings();
  const c = contact();
  const perks: [string, string][] = [
    ['Same again, in one tap', 'Reorder a past job with its approved file at today\'s price. No uploading, no new proof.'],
    ['Proper invoices', 'A pro-forma before you pay and a VAT invoice after, with your business name and tax number.'],
    ['Plain-pack delivery', 'Printing for your own clients? We leave the Brandit name off the packing slip and the messages.'],
    ['Deadline check', 'Tell us when you need it. We say yes or no before you pay, never after.'],
    ['ID cards for staff', 'Upload a staff list and photos. We print and deliver, then delete the files after delivery.'],
    ['Quotes for bigger jobs', `Large or unusual? Send a custom request. A person replies with a price, usually within ${s.custom_reply_hours} hours.`],
  ];
  return (
    <>
      <PageHead title="Brandit for business" sub="Print for your company or your clients without the back and forth." />
      <div className="mx-auto grid max-w-[1160px] gap-12 px-5 pb-12">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {perks.map(([t, d]) => (
            <li key={t} className="card grid content-start gap-2 p-6">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-good-tint text-good"><Check className="h-4 w-4" /></span>
              <p className="text-[20px] font-bold leading-tight">{t}</p>
              <p className="text-muted">{d}</p>
            </li>
          ))}
        </ul>
        <section className="grid items-center gap-6 rounded-lg2 bg-ink p-8 text-white sm:p-10 lg:grid-cols-[1.4fr_1fr]">
          <div className="grid gap-2">
            <h2 className="text-[30px] leading-tight">Ready to start?</h2>
            <p className="text-on-ink-muted">Open your account to see your past jobs and reorder. Or ask for a quote for a bigger job.</p>
          </div>
          <div className="on-dark flex flex-wrap gap-3 lg:justify-end">
            <Link href="/signin?next=/account" className="btn-primary">Open your account</Link>
            <Link href="/custom-order" className="btn-secondary !border-white !bg-transparent !text-white">Get a quote</Link>
            {c.whatsapp && <a className="btn-secondary !border-white !bg-transparent !text-white" href={c.whatsappLink('Hi Brandit, I would like to talk about printing for my business.')!}>WhatsApp us</a>}
          </div>
        </section>
      </div>
    </>
  );
}
