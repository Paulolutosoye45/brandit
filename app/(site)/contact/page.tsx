import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHead } from '@/components/Bits';
import { getSettings } from '@/lib/settings';
import { SITE, contact } from '@/lib/site';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Contact and hours', description: 'How to reach Brandit: WhatsApp, email and opening hours.' };

export default async function Contact() {
  const c = contact();
  const s = await getSettings();
  const today = new Date().toISOString().slice(0, 10);
  const closed = s.holidays.filter((d) => d >= today).slice(0, 4).map((d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', timeZone: 'UTC' }));
  return (
    <>
      <PageHead title="Contact and hours" sub={`A person answers. ${SITE.hours}.`} />
      <div className="mx-auto grid max-w-[760px] gap-8 px-5 pb-12">
        {c.whatsapp ? (
          <a href={c.whatsappLink('Hi Brandit, I need some help.')!} className="card grid gap-1 border-ink p-6 hover:bg-paper2">
            <span className="font-display text-[26px] font-extrabold leading-tight">Message us on WhatsApp</span>
            <span className="text-muted">The fastest way. We reply within {SITE.replyWithin}, {SITE.hours}.</span>
          </a>
        ) : (
          <div className="card grid gap-1 p-6">
            <span className="font-display text-[26px] font-extrabold leading-tight">We reply within {SITE.replyWithin}</span>
            <span className="text-muted">{SITE.hours}. Use the buttons below to get help with an order.</span>
          </div>
        )}

        <section className="grid gap-3">
          <h2 className="text-[26px]">Pick what you need</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ['Where is my order?', 'Enter your order number', '/track'],
              ['Something is wrong with my order', 'Reprint or refund', '/legal/refunds'],
              ['Ask for a custom price', 'Something not on the list', '/custom-order'],
              ['Quick answers', 'Ordering, paying, files, delivery', '/faq'],
            ].map(([t, d, href]) => (
              <Link key={href} href={href} className="card grid gap-0.5 p-4 hover:border-ink">
                <span className="text-[18px] font-bold">{t}</span>
                <span className="text-[15px] text-muted">{d}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="text-[26px]">Opening hours</h2>
          <p>{SITE.hours}. Closed on Sundays. Messages left outside these hours are answered when we open.</p>
          {closed.length > 0 && <p className="text-muted">No printing or deliveries on: {closed.join(', ')}.</p>}
        </section>

        {(c.email || c.address || s.pickup_address) && (
          <section className="grid gap-3">
            <h2 className="text-[26px]">Other ways</h2>
            <ul className="grid gap-2">
              {c.email && <li>Email: <a className="link" href={`mailto:${c.email}`}>{c.email}</a></li>}
              {c.address && <li>Address: {c.address}</li>}
              {s.pickup_address && <li>Pickup point: {s.pickup_address}</li>}
            </ul>
          </section>
        )}
        <p className="text-muted">Brandit is run by {SITE.owner}, Lagos, Nigeria.</p>
      </div>
    </>
  );
}
