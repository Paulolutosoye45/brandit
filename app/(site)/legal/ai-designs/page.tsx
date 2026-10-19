import type { Metadata } from 'next';
import Link from 'next/link';
import { OwnPage } from '@/components/OwnPage';
import { pageOverride } from '@/lib/contentPages';
import { LegalPage, LSection, type TocItem } from '@/components/LegalPage';
import { getSettings } from '@/lib/settings';
import { naira, priceOf, allowanceFor } from '@/lib/studio/config';
import { POLICY_SUMMARY } from '@/content/studio-policy';
import { getContact } from '@/lib/business';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'AI designs (Brandit Studio)', description: 'How Brandit Studio makes designs, what is sent to the picture-making companies, what we will not make, what you pay, and how long we keep your things.' };

const TOC: TocItem[] = [
  { id: 'what', title: 'What Studio is' },
  { id: 'how', title: 'How your design is made, and what is sent abroad' },
  { id: 'wont', title: 'What Studio will not make' },
  { id: 'pay', title: 'What you pay and what you get' },
  { id: 'check', title: 'Checking and approving' },
  { id: 'rights', title: 'Who owns the design' },
  { id: 'keep', title: 'How long we keep your things' },
  { id: 'problem', title: 'If something goes wrong' },
];

export default async function AiDesigns() {
  const mine = await pageOverride('ai-designs');
  if (mine) return <OwnPage title={mine.title} updatedAt={mine.updated_at} body={mine.body} />;
  const s = await getSettings();
  const c = await getContact();
  const std = allowanceFor('standard', s), prem = allowanceFor('premium', s);
  let n = 0;
  const sec = (id: string) => ({ id, n: ++n, title: TOC.find((x) => x.id === id)!.title });
  return (
    <LegalPage
      title="AI designs (Brandit Studio)"
      updated="October 2026"
      toc={TOC}
      intro={<p>Brandit Studio uses computer picture-making to create the background art for your design. Brandit sets your words, places your photo and logo, and checks the print. This page explains what that means for you, in plain words.</p>}
    >
      <LSection {...sec('what')}>
        <ul>
          <li>You tell us the occasion, type your names, dates and other words, and describe the look you want. You can add your own photo and logo.</li>
          <li>A picture-making program draws the <strong>background art only</strong>. It never draws your words, your photo or your logo.</li>
          <li>Brandit puts your words on the design using real fonts, so the spelling is exactly what you typed. Your photo and logo are placed as you supplied them. We never redraw a face.</li>
          <li>Before you can approve a design, Brandit checks that the print file is sharp enough for the size you chose.</li>
        </ul>
      </LSection>

      <LSection {...sec('how')}>
        <p>Studio sends only your <strong>description of the look</strong> (the style, the colours and the sentence you wrote about the feel) to the picture-making companies. These companies may be outside Nigeria. They may include Recraft, Black Forest Labs, Google, OpenAI and fal (which enlarges pictures). Which of them is used can change.</p>
        <ul>
          <li><strong>Not sent:</strong> your names, dates, venues, phone numbers, your photos and your logo.</li>
          <li><strong>Sent:</strong> the occasion type, the style, the colours, and the look sentence. Please do not put names or phone numbers in the look sentence.</li>
          <li>A text and picture safety check may use a service such as OpenAI&apos;s moderation tool on your words and uploaded pictures. We use it to refuse content that breaks our rules.</li>
          <li>We tick this with you before the first design: you agree to this when you ask for a sketch or unlock a design. This is the consent the Nigeria Data Protection Act asks for when information goes to another country.</li>
          <li>Our providers are asked not to use your content to train their models. We rely on each provider&apos;s published terms for this and cannot control what a provider does inside its own systems.</li>
        </ul>
      </LSection>

      <LSection {...sec('wont')}>
        <p>Studio refuses some requests, whatever the reason given. This protects you, other people and Brandit.</p>
        <ul>{POLICY_SUMMARY.map((p) => <li key={p.title}><strong>{p.title}.</strong> {p.body}</li>)}</ul>
        <p>If a request is stopped, nothing is charged for it. If a few requests are stopped in a short time, Studio pauses on the account until a person at Brandit has looked. If you have your own artwork for any of these, you can still upload it as a normal Brandit print order, where it is checked like any other file.</p>
      </LSection>

      <LSection {...sec('pay')}>
        <ul>
          <li><strong>Free sketches:</strong> {s.studio_free_per_week} a week for each verified phone number. They are small and carry a Brandit Studio mark.</li>
          <li><strong>Standard, {naira(priceOf(s, 'standard'))}:</strong> {std.concepts} designs, {std.rounds} rounds of changes with {std.perRound} new versions each, a checked print file. An extra round is {naira(priceOf(s, 'round', 'standard'))}. A vector file is {naira(priceOf(s, 'vector'))}. A check by a Brandit designer is {naira(priceOf(s, 'check'))}.</li>
          <li><strong>Premium, {naira(priceOf(s, 'premium'))}:</strong> {prem.concepts} drafts, {prem.finals} finished designs, {prem.rounds} rounds of edits, a vector file, the same look on {prem.extraProducts} more products, and a check by a Brandit designer. An extra round is {naira(priceOf(s, 'round', 'premium'))}.</li>
          <li><strong>Pack of three Standard designs, {naira(priceOf(s, 'pack3'))}.</strong> The designs in a pack never expire. If you delete your account, unused pack designs end with it.</li>
          <li><strong>Print credit:</strong> {naira(s.studio_credit_standard_kobo)} (Standard) or {naira(s.studio_credit_premium_kobo)} (Premium) comes off the Brandit print order that uses the design, if you order within {s.studio_credit_days} days of approving it.</li>
          <li>Changing a word, a number or a font on a design you have unlocked is free and does not use a round.</li>
          <li>All prices include VAT. If a design you paid for cannot be made, Brandit returns the money by itself. See <Link href="/legal/refunds#studio">Reprints and refunds</Link>.</li>
        </ul>
      </LSection>

      <LSection {...sec('check')}>
        <ul>
          <li>You must read every name, date and phone number before you approve. You tick a box to confirm they are spelled right. Brandit prints exactly what you approved, so a mistake you approved is not covered by our reprint promise.</li>
          <li>When you approve, the print file is locked and recorded with a unique fingerprint, so the file that prints is the file you approved.</li>
          <li>A Brandit designer looks at Premium designs (and any Standard design where you buy a check) before they can be ordered. The designer checks the layout, readability and sharpness. The designer is not responsible for the spelling of your words.</li>
        </ul>
      </LSection>

      <LSection {...sec('rights')}>
        <ul>
          <li>You may print and use the design you paid for, for yourself or your business, including with printers other than Brandit.</li>
          <li>You must have the right to use any photo, logo or text you give Studio. Do not upload someone else&apos;s work or a person&apos;s photo without their permission.</li>
          <li>Pictures made by a computer may not be protected by copyright in Nigeria or elsewhere. We cannot promise that no one else will receive a similar-looking design, and we do not promise exclusivity. If you need a logo or a mark that must be yours alone, ask a Brandit designer.</li>
        </ul>
      </LSection>

      <LSection {...sec('keep')}>
        <ul>
          <li>We keep your words, uploads and drafts for <strong>{s.studio_keep_days} days after you last use the design</strong>, then delete them. You can delete a design yourself at any time on its page.</li>
          <li>The print file for an order you paid for is kept with that order, like any other order file.</li>
          <li>If you delete your account, your designs, words and pictures are deleted too.</li>
          <li>A record that you approved a design (the time and the file fingerprint) and your payment records are kept for the accounts and disputes, without the picture or the words.</li>
          <li>The share link you can send to family shows one preview only. Anyone who has the link can open it, so share it only with people you trust, and switch it off when you are done.</li>
        </ul>
      </LSection>

      <LSection {...sec('problem')}>
        <ul>
          <li>A design that fails to make is refunded automatically.</li>
          <li>If a design shows something that breaks the rules above, or looks like a real person, tell us straight away and we will remove it and refund it.</li>
          <li>For anything else, {c.whatsapp ? <>message us on <a href={c.whatsappLink('Hi Brandit, I have a question about Studio.')!}>WhatsApp</a></> : <>use our <Link href="/contact">contact page</Link></>}, or ask a Brandit designer to make the design by hand: <Link href="/custom-order">ask for a price</Link>.</li>
        </ul>
      </LSection>
    </LegalPage>
  );
}
