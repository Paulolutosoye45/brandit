import type { Metadata } from 'next';
import Link from 'next/link';
import { OwnPage } from '@/components/OwnPage';
import { pageOverride } from '@/lib/contentPages';
import { LegalPage, LSection, type TocItem } from '@/components/LegalPage';
import { getSettings } from '@/lib/settings';
import { SITE } from '@/lib/site';
import { getContact } from '@/lib/business';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Privacy Policy', description: 'What Brandit collects, why, who sees it, how long we keep it, and how to see or delete your data.' };

const TOC: TocItem[] = [
  { id: 'who', title: 'Who we are' },
  { id: 'collect', title: 'What we collect' },
  { id: 'use', title: 'Why we use it' },
  { id: 'share', title: 'Who sees it' },
  { id: 'studio', title: 'Brandit Studio and other countries' },
  { id: 'keep', title: 'How long we keep it' },
  { id: 'device', title: 'Cookies and your phone’s storage' },
  { id: 'rights', title: 'Your rights' },
  { id: 'safe', title: 'Keeping it safe' },
  { id: 'kids', title: 'Children' },
  { id: 'changes', title: 'Changes' },
  { id: 'contact', title: 'Contact and complaints' },
];

export default async function Privacy() {
  const mine = await pageOverride('privacy');
  if (mine) return <OwnPage title={mine.title} updatedAt={mine.updated_at} body={mine.body} />;
  const s = await getSettings();
  const c = await getContact();
  let n = 0;
  const sec = (id: string) => ({ id, n: ++n, title: TOC.find((x) => x.id === id)!.title });
  return (
    <LegalPage
      title="Privacy Policy"
      updated="October 2026"
      toc={TOC}
      intro={<p>We collect only what we need to print your order and deliver it. We do not sell your data. This policy is written to follow the Nigeria Data Protection Act 2023.</p>}
    >
      <LSection {...sec('who')}>
        <p>{SITE.name} is run by {SITE.owner}, Lagos, Nigeria. We decide why and how your personal information is used, so under the Nigeria Data Protection Act we are the &ldquo;data controller&rdquo;.</p>
      </LSection>

      <LSection {...sec('collect')}>
        <ul>
          <li><strong>You give us:</strong> your name, phone number and email; your delivery address and landmark; your business name and tax number if you add them for an invoice; the artwork, logos and words you upload; the brief you write for a design; and what you tell us when you report a problem.</li>
          <li><strong>Custom-order requests:</strong> what you describe, the size and quantity, any reference pictures you attach, and our quote and your reply.</li>
          <li><strong>Google sign-in:</strong> if you choose it, your name, email address and profile picture. Nothing else, and we never post for you.</li>
          <li><strong>Orders and coupons:</strong> what you bought, what you paid, your delivery information and the coupon codes you used.</li>
          <li><strong>Reviews:</strong> your rating, your words, and whether you agreed to have them shown on our site. If you add a photo, the photo too, and whether you agreed to have the photo shown.</li>
          <li><strong>Brand kit (optional):</strong> the logo, colours and files you choose to save in your account for later orders.</li>
          <li><strong>Templates and event plans:</strong> your answers (such as names, dates, times and venues), the kind of event, the date and the number of guests.</li>
          <li><strong>Delivery choices:</strong> whether you prefer a morning or afternoon delivery, and your reminder and language choices.</li>
          <li><strong>Referral codes:</strong> your personal code, which codes you used, and the rewards you earned. When your code is used on a delivered order, we message you that a reward is ready, and the message names the friend by first name.</li>
          <li><strong>Rider position:</strong> while your order is out for delivery, the rider&apos;s phone can share where it is (not yours). We keep only the latest position.</li>
          <li><strong>Payments:</strong> handled by our payment provider. We get a confirmation and a reference, never your full card number or PIN.</li>
          <li><strong>Technical:</strong> your IP address and device type when you sign in or place an order, kept to protect the service from abuse.</li>
          <li><strong>ID-card jobs:</strong> staff lists and photos you upload for printing ID cards. We treat these with extra care (see how long we keep it).</li>
        </ul>
      </LSection>

      <LSection {...sec('use')}>
        <ul>
          <li>To price, print, check, deliver and support your order, and to message you about it (this is needed to do the job).</li>
          <li>To take payment, issue receipts and VAT invoices, and keep the accounts the law requires.</li>
          <li>To reply to custom-order requests and keep your quote.</li>
          <li>To keep the service safe, find fraud and fix problems.</li>
          <li>To send reorder reminders and offers <strong>only if you choose to receive them</strong>. You can turn them off in your account.</li>
          {s.nudge_enabled && <li>To send <strong>one</strong> reminder, by WhatsApp or SMS, if you fill in your details at checkout and do not pay. You can turn this off in your account (&ldquo;Remind me once if I leave an order unpaid&rdquo;) or by telling us.</li>}
          <li>To give your friends a referral code and to give you a reward when a friend&apos;s order is delivered.</li>
          <li>To show you the rider&apos;s position on a map while your order is out for delivery, and to plan the day&apos;s deliveries around the window you chose.</li>
          <li>To use your photo on our site <strong>only if you agree</strong> with a separate box when you add it, and only after a person at Brandit has checked it.</li>
          <li>To show your review on our site <strong>only if you agree</strong> when you leave it. We show your first name and the product, nothing else.</li>
        </ul>
      </LSection>

      <LSection {...sec('share')}>
        <p>We do not sell your data. We share it only with people who need it to serve you:</p>
        <ul>
          <li><strong>Our team</strong>, according to their jobs. A designer sees your brief and files; a rider sees a delivery address and phone number.</li>
          <li><strong>Delivery partners</strong>, only the name, phone number and address needed to deliver. A rider who uses the rider link can see the delivery address and phone number for that delivery, and chooses whether to share their own position.</li>
          <li><strong>Other customers:</strong> never your files, your brand kit or your private photo. If you agreed to have a review or its photo shown, visitors see your first name, what you ordered and the words and photo you agreed to share. A friend who gets your referral code sees the first name on your account in the code&apos;s description (&ldquo;A gift from &hellip;&rdquo;).</li>
          <li><strong>Service providers</strong> that take payments, send SMS, WhatsApp and email, host our systems and store files. They may process data on servers outside Nigeria. We choose providers that protect data, and only share what the service needs.</li>
          <li><strong>Authorities</strong>, when the law requires it.</li>
        </ul>
        <p>If you ask us to deliver with &ldquo;plain pack&rdquo;, we leave Brandit&apos;s name off the packing slip and the customer&apos;s messages, but we still keep the order record.</p>
      </LSection>

      <LSection {...sec('studio')}>
        <ul>
          <li>When you use Brandit Studio, we keep the words you type, the photo and logo you upload, and the designs we make, so you can change and order them.</li>
          <li>To draw background art, Studio sends <strong>only your description of the look</strong> (style, colours, mood and the sentence you wrote) to picture-making companies, some outside Nigeria. Your names, dates, phone numbers, photos and logo are not sent. You agree to this before your first design.</li>
          <li>Your words and uploaded pictures may also pass through a safety check by a service that screens for content we refuse.</li>
          <li>We count free sketches by verified phone number, so we keep a short record of when a number asked for a sketch.</li>
          <li>Read more on the <Link href="/legal/ai-designs">AI designs page</Link>.</li>
        </ul>
      </LSection>

      <LSection {...sec('keep')}>
        <ul>
          <li><strong>Orders and invoices</strong> are kept for the period the law requires for business accounts, even if you delete your account.</li>
          <li><strong>Artwork</strong> is kept so you can reorder, until you ask us to delete it or you delete your account.</li>
          <li><strong>ID-card staff lists and photos</strong> are deleted {s.id_file_retention_days} days after delivery.</li>
          <li><strong>Unpaid drafts and unanswered custom quotes</strong> are cleaned up automatically after a while.</li>
          <li><strong>The rider&apos;s position</strong> is overwritten each time it updates, so only the latest one is kept. It is deleted when the order is delivered, and in any case within a day.</li>
          <li><strong>Review photos:</strong> a photo that nobody has checked is deleted after 60 days. A photo we reject is deleted straight away. An approved photo stays until you ask us to remove it or you delete your account.</li>
          <li><strong>Brand kit files:</strong> kept until you remove them or delete your account. We never save ID-card photos in a brand kit.</li>
          <li><strong>Event plans and template answers</strong> are kept with your order so we can reprint it. Event-plan details are cleared when you delete your account.</li>
          <li><strong>Studio designs, words and uploads</strong> are deleted {s.studio_keep_days} days after you last use the design, or when you delete it or your account. Free-sketch counts are deleted after 40 days.</li>
          <li><strong>Sign-in records</strong> are kept for a limited time for security.</li>
        </ul>
      </LSection>

      <LSection {...sec('device')}>
        <p>We do not use advertising cookies or trackers. We use:</p>
        <ul>
          <li>A sign-in cookie that keeps you signed in. It is needed for the site to work.</li>
          <li>A few small notes kept on your own phone, such as your last delivery area, an unfinished order so we can offer to continue it, and a coupon or referral code from a link you opened. They never leave your phone except when you use them, and you can clear them in your browser settings.</li>
          <li>A small cookie called <code>bl</code> that remembers whether you chose English or Pidgin. It holds nothing else and lasts a year.</li>
          <li>If you add Brandit to your home screen, your phone keeps a small copy of our pages and pictures so the app opens faster and shows a friendly message when you have no network. It never stores your orders, tracking pages, payments or anything from the staff console, and it holds nothing personal. We remember on your phone that you closed the &ldquo;Add to home screen&rdquo; message so we do not ask again for 30 days.</li>
          <li>The rider link asks the rider&apos;s phone for permission to share its position. It works only while the page is open and only after the rider starts the trip.</li>
        </ul>
      </LSection>

      <LSection {...sec('rights')}>
        <p>Under the Nigeria Data Protection Act you can ask to:</p>
        <ul>
          <li>see what we hold about you, and get a copy (your account page has a &ldquo;Download my data&rdquo; button, which includes your brand kit, referral codes and rewards, reviews and delivery choices);</li>
          <li>correct something that is wrong (you can change your details in your account);</li>
          <li>delete your account and your files, including your brand kit and any review photos (your account page has a &ldquo;Delete my account&rdquo; option, which works when you have no order in progress; we keep only the records the law requires; your referral code stops working);</li>
          <li>stop reminders and offers at any time;</li>
          <li>object to or limit how we use your data, and take back a consent you gave.</li>
        </ul>
        <p>You can also message us and we will help.</p>
      </LSection>

      <LSection {...sec('safe')}>
        <p>We protect your data with encrypted connections, restricted staff access based on job roles, private storage for your files, and rate limits on sign-in. No system is perfectly safe. If something happens that puts your data at risk, we will tell you and the authorities as the law requires.</p>
      </LSection>

      <LSection {...sec('kids')}>
        <p>Brandit is not meant for children under 18. If you think a child has given us personal information, tell us and we will delete it.</p>
      </LSection>

      <LSection {...sec('changes')}>
        <p>If we change this policy, we update the date at the top. If a change affects how we use your data in a big way, we tell you on the site or by message.</p>
      </LSection>

      <LSection {...sec('contact')}>
        <ul>
          <li>Ask us anything about your data{c.whatsapp ? <> on <a href={c.whatsappLink()!}>WhatsApp</a></> : <> through our <Link href="/contact">contact page</Link></>}{c.email ? <> or at <a href={`mailto:${c.email}`}>{c.email}</a></> : null}.</li>
          <li>If you are not happy with our answer, you can complain to the Nigeria Data Protection Commission (NDPC).</li>
        </ul>
        <p>Read how an order works in our <Link href="/legal/terms">Terms and Conditions</Link>.</p>
      </LSection>
    </LegalPage>
  );
}
