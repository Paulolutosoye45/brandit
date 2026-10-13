import type { Metadata } from 'next';
import { listZones } from '@/lib/catalog';
import { getSettings } from '@/lib/settings';
import { naira } from '@/lib/money';
import { clock12, toMinutes } from '@/lib/time';
import { PageHead } from '@/components/Bits';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Help' };

export default async function Help() {
  const [zones, s] = await Promise.all([listZones(), getSettings()]);
  const t = (hhmm: string) => clock12(Math.floor(toMinutes(hhmm) / 60), toMinutes(hhmm) % 60);
  return (
    <>
      <PageHead title="Help" sub="How Brandit works, what we promise, and how to get your file right." />
      <div className="mx-auto max-w-[760px] px-5 pb-12 grid gap-12">
        <section id="promise" className="grid gap-4 scroll-mt-24">
          <h2 className="text-[30px]">The Brandit Promise</h2>
          <ul className="grid gap-3 text-[17px]">
            <li><span className="font-bold">Printed wrong? We reprint or refund.</span> If the job does not match the file you approved, we fix it at no cost. Report it within {s.claim_window_hours} hours of delivery, with a photo if you can.</li>
            <li><span className="font-bold">Late on a 24-hour order? Delivery is on us.</span> We refund the delivery fee automatically. You do not have to ask.</li>
            <li><span className="font-bold">A person answers.</span> We reply on WhatsApp within 15 minutes, Monday to Saturday, 8am to 6pm.</li>
          </ul>
          <p className="text-muted">What is not covered: mistakes in a file you approved, and the small colour difference between a screen and paper.</p>
        </section>

        <section id="how24" className="grid gap-4 scroll-mt-24">
          <h2 className="text-[30px]">How 24-hour printing works</h2>
          <p>Order before <span className="font-bold">{t(s.cutoff_time)}</span> on a working day with a file that passes our check, and eligible jobs arrive the next working day by <span className="font-bold">{t(s.arrive_by)}</span>. We only show the 24-hour badge when your job qualifies at that moment, and you see the exact arrival time before you pay.</p>
          <p className="text-muted">A job qualifies when the product, quantity, size and area are within the 24-hour limits, and today&apos;s 24-hour slots are not full. If it does not qualify, we tell you why and how to qualify. Design jobs run from the moment you approve the proof.</p>
        </section>

        <section id="zones" className="grid gap-4 scroll-mt-24">
          <h2 className="text-[30px]">Delivery areas and fees</h2>
          <div className="grid gap-3">
            {zones.map((z) => (
              <div key={z.id} className="card p-4 grid gap-1">
                <div className="flex items-baseline justify-between gap-3"><p className="font-bold">{z.name}</p><p className="font-bold tabular">{naira(z.fee_kobo)}</p></div>
                <p className="text-[14px] text-muted">{z.areas.join(', ')}</p>
                <p className="text-[14px]">{z.eligible_24h ? '24-hour delivery available' : 'Standard delivery only'}</p>
              </div>
            ))}
          </div>
          <p className="text-muted text-[15px]">Pickup is always free. Not sure your area is listed? Message us.</p>
        </section>

        <section id="files" className="grid gap-4 scroll-mt-24">
          <h2 className="text-[30px]">Getting your file right</h2>
          <ul className="grid gap-3 list-disc pl-5">
            <li><span className="font-bold">Use PDF, JPG or PNG.</span> If you have a Word or Canva file, export it as a PDF first.</li>
            <li><span className="font-bold">Make it big enough.</span> Small pictures print blurry. We check this the moment you upload and tell you in plain words. A photo straight from a phone camera works for most frames.</li>
            <li><span className="font-bold">Keep important words away from the edges.</span> Edges can be trimmed by a few millimetres.</li>
            <li><span className="font-bold">Check your spelling and phone numbers.</span> You approve a preview before anything prints, and we print exactly what you approve.</li>
            <li><span className="font-bold">No file yet?</span> Choose &ldquo;Design it for me&rdquo; and we will make one. Or if a file is not sharp enough, choose &ldquo;Fix it for me&rdquo;.</li>
          </ul>
        </section>

        <section className="grid gap-3">
          <h2 className="text-[30px]">Paying</h2>
          <p>Pay in full when you order, by card, bank transfer or USSD. We start as soon as your payment is confirmed. Custom print cannot be resold if it is refused, so we ask for payment first and back it with the Promise.</p>
        </section>
      </div>
    </>
  );
}
