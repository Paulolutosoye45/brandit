import type { Metadata } from 'next';
import Link from 'next/link';
import { getSettings } from '@/lib/settings';
import { PageHead } from '@/components/Bits';
import { getContact } from '@/lib/business';
import { applyFaqEdits, builtInFaq, faqRows } from '@/lib/faqContent';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Questions and answers', description: 'Quick answers about ordering, paying, files, templates, delivery, custom orders, event plans, coupons, referral codes and problems at Brandit.' };

export default async function Faq() {
  const s = await getSettings();
  const c = await getContact();
  const groups = applyFaqEdits(builtInFaq(s, c), await faqRows());

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: groups.flatMap((g) => g.items).map((i) => ({ '@type': 'Question', name: i.q, acceptedAnswer: { '@type': 'Answer', text: i.a } })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />
      <PageHead title="Questions and answers" sub="Quick answers. Cannot find yours? A person will help." />
      <div className="mx-auto grid max-w-[760px] gap-10 px-5 pb-12">
        <nav aria-label="Topics" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          {groups.map((g) => <a key={g.id} href={`#${g.id}`} className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border-2 border-line-control bg-surface px-4 font-bold hover:border-ink">{g.title.split(' and ')[0]}</a>)}
        </nav>
        {groups.map((g) => (
          <section key={g.id} id={g.id} aria-labelledby={`${g.id}-h`} className="grid scroll-mt-24 gap-3">
            <h2 id={`${g.id}-h`} className="text-[26px]">{g.title}</h2>
            <div className="grid gap-2">
              {g.items.map((i) => (
                <details key={i.q} className="card group p-0 open:border-ink">
                  <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 text-[17px] font-bold [&::-webkit-details-marker]:hidden">
                    {i.q}
                    <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-paper2 text-[20px] leading-none group-open:rotate-45">+</span>
                  </summary>
                  <div className="grid gap-2 px-5 pb-5 text-[16px] leading-relaxed">
                    <p>{i.a}</p>
                    {i.link && <p><Link className="link" href={i.link[1]}>{i.link[0]}</Link></p>}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}
        <section className="card grid gap-3 p-6">
          <p className="font-display text-[24px] font-extrabold leading-tight">Still stuck?</p>
          <p className="text-muted">A person answers, {c.hours}. We reply within {c.replyWithin}.</p>
          <div className="flex flex-wrap gap-3">
            {c.whatsapp && <a className="btn-primary" href={c.whatsappLink('Hi Brandit, I have a question.')!}>Ask on WhatsApp</a>}
            <Link className="btn-secondary" href="/contact">Contact and hours</Link>
          </div>
        </section>
      </div>
    </>
  );
}
