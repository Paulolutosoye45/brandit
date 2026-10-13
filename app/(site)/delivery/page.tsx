import type { Metadata } from 'next';
import Link from 'next/link';
import { listZones } from '@/lib/catalog';
import { getSettings } from '@/lib/settings';
import { naira } from '@/lib/money';
import { clock12, toMinutes } from '@/lib/time';
import { PageHead } from '@/components/Bits';
import { SITE, contact } from '@/lib/site';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Delivery and pickup', description: 'Where Brandit delivers in Lagos, what it costs, how long it takes, and how pickup works.' };

export default async function Delivery() {
  const [zones, s] = await Promise.all([listZones(), getSettings()]);
  const c = contact();
  const t = (hhmm: string) => clock12(Math.floor(toMinutes(hhmm) / 60), toMinutes(hhmm) % 60);
  return (
    <>
      <PageHead title="Delivery and pickup" sub="Where we deliver, what it costs, and when it arrives. You always see the exact time before you pay." />
      <div className="mx-auto grid max-w-[760px] gap-12 px-5 pb-12">
        <section aria-labelledby="zones-h" className="grid gap-4">
          <h2 id="zones-h" className="text-[28px]">Delivery areas and fees</h2>
          <div className="grid gap-3">
            {zones.map((z) => (
              <div key={z.id} className="card grid gap-1 p-4">
                <div className="flex items-baseline justify-between gap-3"><p className="font-bold">{z.name}</p><p className="tabular font-bold">{naira(z.fee_kobo)}</p></div>
                <p className="text-[15px] text-muted">{z.areas.join(', ')}</p>
                <p className="text-[15px]">{z.eligible_24h ? '24-hour delivery available' : 'Standard delivery only'}</p>
              </div>
            ))}
          </div>
          <p className="text-muted">Not sure your area is listed? Pick the nearest one at checkout, or {c.whatsapp ? <a className="link" href={c.whatsappLink('Hi Brandit, do you deliver to my area?')!}>ask us on WhatsApp</a> : <Link className="link" href="/contact">ask us</Link>}. We tell you the real fee before you pay.</p>
        </section>

        <section aria-labelledby="time-h" className="grid gap-4">
          <h2 id="time-h" className="text-[28px]">How long it takes</h2>
          <ul className="grid list-disc gap-3 pl-5">
            <li><span className="font-bold">24-hour:</span> order before {t(s.cutoff_time)} on a working day with a file that passes our check, and eligible jobs arrive the next working day by {t(s.arrive_by)}. You only see this option when your job qualifies.</li>
            <li><span className="font-bold">Standard:</span> your exact arrival day and time show on the product page and again at checkout.</li>
            {s.windows_enabled && <li><span className="font-bold">Morning or afternoon:</span> when you choose delivery you can pick the morning (9am to 1pm) or the afternoon (1pm to 5pm). It helps the rider plan the day. It is a preference, not a change to your arrival time or the Brandit Promise. A 24-hour order is always delivered in the afternoon.</li>}
            <li><span className="font-bold">Design jobs:</span> the clock starts when you approve your proof, not when you pay.</li>
            <li><span className="font-bold">Working days:</span> {s.working_days.length >= 6 ? 'Monday to Saturday' : 'shown at checkout'}, except public holidays.</li>
          </ul>
        </section>

        <section aria-labelledby="pickup-h" className="grid gap-4">
          <h2 id="pickup-h" className="text-[28px]">Pickup is free</h2>
          <p>{s.pickup_address ? <>Collect your order from <span className="font-bold">{s.pickup_address}</span>. We message you when it is ready, so please do not come before that.</> : <>Choose pickup at checkout and we will message you the address and the time when your order is ready.</>} Bring your order number or the delivery code from your message.</p>
        </section>

        <section aria-labelledby="how-h" className="grid gap-4">
          <h2 id="how-h" className="text-[28px]">What happens on the day</h2>
          <ol className="grid list-decimal gap-3 pl-5">
            <li>You get a message when your order is out for delivery, with your <span className="font-bold">delivery code</span>.</li>
            <li>Track it any time on your order page: <Link className="link" href="/track">Track an order</Link>. When the rider is on the way you may also see a link to their last known position on a map. It disappears once your order is delivered.</li>
            <li>Check your parcel, then give the rider your delivery code. Only give the code once you have your parcel.</li>
            <li>If something is wrong, <Link className="link" href="/legal/refunds">report it within {s.claim_window_hours} hours</Link>.</li>
          </ol>
          <p className="text-muted">Please make sure someone can receive the parcel and that your phone is on. A good landmark helps our rider a lot. We are available {SITE.hours}.</p>
        </section>
      </div>
    </>
  );
}
