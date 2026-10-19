import type { Metadata } from 'next';
import Link from 'next/link';
import { OwnPage } from '@/components/OwnPage';
import { pageOverride } from '@/lib/contentPages';
import { LegalPage, LSection, type TocItem } from '@/components/LegalPage';
import { getSettings } from '@/lib/settings';
import { getContact } from '@/lib/business';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Reprints and Refunds', description: 'What Brandit does when a print is wrong, damaged or late, how to report it, and how refunds work.' };

const TOC: TocItem[] = [
  { id: 'promise', title: 'The Brandit Promise' },
  { id: 'report', title: 'How to report a problem' },
  { id: 'what', title: 'What happens next' },
  { id: 'late', title: 'Late 24-hour orders' },
  { id: 'cancel', title: 'Cancelling an order' },
  { id: 'studio', title: 'Brandit Studio designs' },
  { id: 'notcovered', title: 'What is not covered' },
  { id: 'how', title: 'How refunds are paid' },
];

export default async function Refunds() {
  const mine = await pageOverride('refunds');
  if (mine) return <OwnPage title={mine.title} updatedAt={mine.updated_at} body={mine.body} />;
  const s = await getSettings();
  const c = await getContact();
  let n = 0;
  const sec = (id: string) => ({ id, n: ++n, title: TOC.find((x) => x.id === id)!.title });
  return (
    <LegalPage
      title="Reprints and Refunds"
      updated="October 2026"
      toc={TOC}
      intro={<p>If we get it wrong, we fix it. This page says exactly how, so you never have to argue with anyone.</p>}
    >
      <LSection {...sec('promise')}>
        <ul>
          <li><strong>Printed wrong? We reprint or refund.</strong> If the job does not match the file you approved, we fix it at no cost to you.</li>
          <li><strong>Damaged on the way? Same.</strong> If your order arrives damaged, we reprint or refund.</li>
          <li><strong>Late on a 24-hour order? Delivery is on us.</strong> The delivery fee comes back automatically.</li>
        </ul>
        <p>This is the Brandit Promise. It is part of our <Link href="/legal/terms">Terms and Conditions</Link>.</p>
      </LSection>

      <LSection {...sec('report')}>
        <ul>
          <li>Report it within <strong>{s.claim_window_hours} hours of delivery</strong>. After that, we may still help, but the Promise no longer applies automatically.</li>
          <li>Open your order (from your account or the link in your messages) and choose <strong>Report a problem</strong>. Tell us what is wrong and add a photo if you can. A photo in daylight is best.</li>
          <li>Prefer to talk? {c.whatsapp ? <>Message us on <a href={c.whatsappLink(`Hi Brandit, I have a problem with my order.`)!}>WhatsApp</a>.</> : <>Use our <Link href="/contact">contact page</Link>.</>} We are available {c.hours} and reply within {c.replyWithin}.</li>
          <li>Please keep the wrong or damaged items until we decide. We may ask you to show them to our rider or send a photo.</li>
        </ul>
      </LSection>

      <LSection {...sec('what')}>
        <ul>
          <li>A person looks at your report the same working day.</li>
          <li>We compare what you received with the proof you approved.</li>
          <li>If the fault is ours, you choose what suits you: <strong>a reprint</strong> (we make it again and deliver it at no cost) or <strong>a refund</strong> of the part that was wrong. We will tell you the new arrival time for a reprint.</li>
          <li>If we decide the fault is not ours, we explain why in plain words.</li>
        </ul>
      </LSection>

      <LSection {...sec('late')}>
        <p>If a 24-hour order arrives after the time we promised, the delivery fee is refunded automatically, with no form to fill. This does not apply when the delay comes from events outside our control (see the <Link href="/legal/terms#beyond">Terms</Link>), or when the address or phone number you gave was wrong. A morning or afternoon delivery window is a preference for the rider, so a delivery outside your window is not a late order. Only the arrival time we promised counts.</p>
      </LSection>

      <LSection {...sec('cancel')}>
        <ul>
          <li><strong>Before we start:</strong> you can cancel and get a full refund before your file or proof is approved and production begins. Message us with your order number as soon as you can.</li>
          <li><strong>Once production has started:</strong> your order is made specially for you and cannot be resold, so we cannot cancel it or refund it for a change of mind.</li>
          <li><strong>Custom orders and event plans:</strong> a request and a quote cost you nothing, and you can decline a quote at any time before you pay. After you pay and approve the proofs, the rules above apply to each item.</li>
          <li>If <em>we</em> cancel (for example we cannot print your file, or we cannot reach you), we refund what you paid for what we did not do.</li>
        </ul>
      </LSection>

      <LSection {...sec('studio')}>
        <ul>
          <li><strong>A design that cannot be made</strong> is refunded automatically, in full, to the way you paid. You do not need to ask. A design made from a pack goes back into your pack.</li>
          <li><strong>A vector file</strong> that cannot be made is refunded the same way.</li>
          <li><strong>If you simply do not like the design,</strong> Studio is a service you pay for as the designs are made, so we do not refund a design that was made and worked. You have rounds of changes included, and fixing a word is free. If you are stuck, a Brandit designer can help: <Link href="/custom-order">ask for a price</Link>.</li>
          <li><strong>A mistake in the words you approved</strong> (a wrong name, date or number) is not covered by the reprint promise, because you confirmed the spelling. If the print does not match the file you approved, it is covered like any other order.</li>
          <li>The print credit comes off the print order. If you cancel that order, the credit is not paid out in cash.</li>
        </ul>
      </LSection>

      <LSection {...sec('notcovered')}>
        <ul>
          <li>A mistake in a proof you approved (spelling, a wrong phone number, wrong colours you chose). This includes wording you typed into a template or an event plan and then approved.</li>
          <li>The normal colour difference between a screen and paper or fabric.</li>
          <li>Blur from a small or low-quality picture, when we warned you and you chose to go ahead.</li>
          <li>Edges that move by a few millimetres when paper is cut.</li>
          <li>Damage after delivery, or a change of mind after production started.</li>
        </ul>
        <p>Your rights under Nigerian consumer-protection law stay as they are.</p>
      </LSection>

      <LSection {...sec('how')}>
        <ul>
          <li>Refunds go back to the way you paid, through our payment provider, for the amount you actually paid. If you used a coupon or a referral code, that is the discounted amount. A referral reward is not cash and is not part of a refund.</li>
          <li>We start the refund as soon as it is agreed. You get a message when it is sent.</li>
          <li>Your bank decides how fast it shows in your account. It often takes a few working days. If it has not arrived after a week, tell us and we will trace it with you.</li>
        </ul>
      </LSection>
    </LegalPage>
  );
}
