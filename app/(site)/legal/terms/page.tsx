import type { Metadata } from 'next';
import Link from 'next/link';
import { OwnPage } from '@/components/OwnPage';
import { pageOverride } from '@/lib/contentPages';
import { LegalPage, LSection, type TocItem } from '@/components/LegalPage';
import { getSettings } from '@/lib/settings';
import { naira } from '@/lib/money';
import { clock12, toMinutes } from '@/lib/time';
import { SITE } from '@/lib/site';
import { getContact } from '@/lib/business';
import { MAX_ASSETS, MAX_ASSET_MB } from '@/lib/brandKit';
import { EVENT_BUFFER_DAYS } from '@/lib/eventPlanCore';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Terms and Conditions', description: 'The terms that apply when you order from Brandit: prices, payment, artwork, proofs, delivery, custom orders, templates and event plans, coupons, referral codes, reprints and refunds.' };

const TOC: TocItem[] = [
  { id: 'about', title: 'About these terms' },
  { id: 'using', title: 'Using Brandit' },
  { id: 'prices', title: 'Prices, VAT and fees' },
  { id: 'orders', title: 'How an order works' },
  { id: 'payment', title: 'Payment' },
  { id: 'artwork', title: 'Your artwork and content' },
  { id: 'brandkit', title: 'Your brand kit' },
  { id: 'design', title: 'Our design service' },
  { id: 'studio', title: 'Brandit Studio (AI designs)' },
  { id: 'proofs', title: 'Proofs and approval' },
  { id: 'delivery', title: 'Production and delivery' },
  { id: 'custom', title: 'Custom orders' },
  { id: 'events', title: 'Templates and event plans' },
  { id: 'coupons', title: 'Coupon codes' },
  { id: 'referrals', title: 'Referral codes' },
  { id: 'quality', title: 'Quality and colour' },
  { id: 'refunds', title: 'Cancellations, reprints and refunds' },
  { id: 'liability', title: 'Our responsibility to you' },
  { id: 'beyond', title: 'Things outside our control' },
  { id: 'messages', title: 'Messages and reviews' },
  { id: 'data', title: 'Your data' },
  { id: 'changes', title: 'Changes to these terms' },
  { id: 'law', title: 'Governing law and disputes' },
  { id: 'contact', title: 'Contact us' },
];

export default async function Terms() {
  const mine = await pageOverride('terms');
  if (mine) return <OwnPage title={mine.title} updatedAt={mine.updated_at} body={mine.body} />;
  const s = await getSettings();
  const t = (hhmm: string) => clock12(Math.floor(toMinutes(hhmm) / 60), toMinutes(hhmm) % 60);
  const c = await getContact();
  const vat = `${+(s.vat_rate * 100).toFixed(2)}%`;
  let n = 0;
  const sec = (id: string) => ({ id, n: ++n, title: TOC.find((x) => x.id === id)!.title });

  return (
    <LegalPage
      title="Terms and Conditions"
      updated="October 2026"
      toc={TOC}
      intro={<p>These are the rules for ordering from Brandit. We have written them in plain words so you can read them on your phone. If something is unclear, message us before you pay and we will explain.</p>}
    >
      <LSection {...sec('about')}>
        <p>Brandit is a design and print service run by <strong>{SITE.owner}</strong>, based in Lagos, Nigeria. In these terms, &ldquo;we&rdquo;, &ldquo;us&rdquo; and &ldquo;Brandit&rdquo; mean {SITE.owner} trading as Brandit. &ldquo;You&rdquo; means the person (or business) who uses the site or places an order.</p>
        <p>By placing an order, creating an account or sending us a custom-order request, you agree to these terms, our <Link href="/legal/refunds">Reprints and Refunds</Link> page and our <Link href="/legal/privacy">Privacy Policy</Link>. If you do not agree, please do not order.</p>
        <p>Some words have a special meaning here. An <strong>order</strong> is a job you have paid for. A <strong>proof</strong> is the preview we show you before printing. The <strong>Brandit Promise</strong> is our commitment to reprint or refund a job that does not match the file you approved, and to refund the delivery fee on a 24-hour order that arrives late. A <strong>custom order</strong> is a job that is not on our standard price list, which we quote for you one by one.</p>
      </LSection>

      <LSection {...sec('using')}>
        <ul>
          <li>You must be at least 18, or ordering on behalf of a business through an adult who is allowed to do so.</li>
          <li>Give us true details: your name, phone number, email and delivery address. If we cannot reach you or find you, your order may be delayed and the Promise may not apply to the delay.</li>
          <li>You can sign in with Google, your email or your phone number. Keep your sign-in codes private. You are responsible for what is done on your account.</li>
          <li>We may suspend an account or refuse an order that is used to abuse the service, break the law, or harm other people. If we cancel a paid order for this reason, we refund what you paid unless the work has already been made.</li>
        </ul>
      </LSection>

      <LSection {...sec('prices')}>
        <ul>
          <li>All prices are in Nigerian naira (₦).</li>
          <li>{s.prices_include_vat ? `Prices shown include VAT at ${vat}.` : `VAT at ${vat} is added at checkout.`} Your checkout page and invoice show the VAT amount separately.</li>
          <li>The delivery fee depends on your delivery area and is shown before you pay. Pickup is free.</li>
          <li>If you choose our design service there is a design fee (currently {naira(s.design_fee_kobo)}). If you ask us to fix a file that is not sharp enough, there is a fix fee (currently {naira(s.fix_fee_kobo)}). Both are shown before you pay.</li>
          <li>The price you see is the price you pay for that order. We may change prices for future orders at any time. If we make an obvious mistake in a price (for example a missing zero), we will tell you before we start and you can either pay the correct price or cancel with a full refund.</li>
        </ul>
      </LSection>

      <LSection {...sec('orders')}>
        <ul>
          <li>You choose a product, a quantity and any options. We show your price and your arrival time before you pay.</li>
          <li>We hold the arrival time we show you for {s.hold_minutes} minutes while you check out. If you pay after that, the time may change, and we show you the new time first.</li>
          <li><strong>Your order is confirmed only when our payment provider confirms your payment.</strong> Until then it is a draft and nothing has been promised.</li>
          <li>After payment, a person checks your file. If there is a problem we tell you what it is and how to fix it. For jobs we design, we start designing and send you a proof.</li>
          <li>You approve a proof (see section {TOC.findIndex((x) => x.id === 'proofs') + 1}). Then we print, check quality, and deliver or prepare it for pickup.</li>
          <li>We may decline or cancel an order we cannot do properly: for example an artwork file that cannot be printed, content we are not allowed to print, or a delivery address we cannot reach. We tell you why and refund what you paid for the part we did not do.</li>
        </ul>
      </LSection>

      <LSection {...sec('payment')}>
        <ul>
          <li>You pay in full before we start, by card, bank transfer or USSD, through our payment provider. We never see or keep your full card number.</li>
          <li>We ask for payment first because printed work made to your design cannot be resold if it is refused.</li>
          <li>Bank transfers and USSD can take a few minutes to confirm. Do not pay twice. If you pay twice by mistake, tell us and we refund the extra payment.</li>
          <li>If money leaves your account but your order does not show as paid, keep your bank alert and message us with your order number. We will check with the payment provider and fix it.</li>
          <li>You will get a receipt by email or message, and a VAT invoice you can download from your order page. If you need your business name or tax number on the invoice, add it at checkout.</li>
        </ul>
      </LSection>

      <LSection {...sec('artwork')}>
        <ul>
          <li>You keep ownership of your artwork, logos and words. You give us permission to copy, edit for size and colour, and print them, only so we can produce and deliver your order, and to keep the approved file so you can reorder.</li>
          <li><strong>You promise that you have the right to use everything you send us</strong> (images, logos, fonts, text, music names, brand marks), and that it does not break anyone&apos;s rights or the law. If someone claims it does, you are responsible for that claim.</li>
          <li><strong>We do not print:</strong> anything illegal or meant to deceive or defraud; fake or altered official documents, certificates, IDs, receipts or currency; the insignia or uniforms of the police, military or government used to pretend to be them; counterfeit or knock-off brand goods; sexually explicit material; content that attacks people for their tribe, religion, gender or disability, or encourages violence; and content that breaks someone else&apos;s copyright or trademark. We decide in good faith, and we may ask you to show that you have permission.</li>
          <li>We will not use your artwork or finished work in our own advertising without asking you first.</li>
          <li>Files for ID cards and staff lists are deleted {s.id_file_retention_days} days after delivery. Other artwork is kept so you can reorder, until you ask us to delete it.</li>
        </ul>
      </LSection>

      <LSection {...sec('brandkit')}>
        <p>A brand kit is an optional place in your account where you keep your logo, your brand colours and other files, so you can use them again on a later order without sending them again.</p>
        <ul>
          <li>You choose what goes in. You can keep up to {MAX_ASSETS} files, each up to {MAX_ASSET_MB} MB.</li>
          <li>The files are yours. We use them only to prepare and print your orders and to show them to you in your account, on the same terms as your other artwork (see section {TOC.findIndex((x) => x.id === 'artwork') + 1}). The same promise applies: you must have the right to use everything you save there.</li>
          <li>We never save ID-card photos or staff lists in a brand kit.</li>
          <li>When you remove a file, we delete our copy, unless an order that is still open needs it. If you delete your account, your brand kit is deleted with it.</li>
          <li>A business account can be used by more than one person. Whoever is signed in to the account can see its brand kit, so remove access for people who leave.</li>
        </ul>
      </LSection>

      <LSection {...sec('design')}>
        <ul>
          <li>If you choose &ldquo;Design it for me&rdquo;, tell us what you need in the brief. The more you tell us, the closer the first proof will be.</li>
          <li>We send a proof. You can approve it, or ask for changes and we send a new one. Two rounds of changes are included in the design fee. After that, more rounds may carry an extra charge, and we tell you before we do the work. A completely new idea after you have approved a proof is a new design job.</li>
          <li>Once you have paid, the design we made for you is yours. We do not sell it to anyone else. We may keep a copy so you can reorder.</li>
          <li>We design from the words, pictures and logos you give us. If you want us to use a font, photo or logo that has to be bought, you must supply it or the licence.</li>
          <li>The production clock for a design job starts when you approve the proof, not when you pay.</li>
        </ul>
      </LSection>

      <LSection {...sec('studio')}>
        <ul>
          <li>Brandit Studio makes designs with the help of computer picture-making. The terms for it are on the <Link href="/legal/ai-designs">AI designs page</Link>, which is part of these Terms.</li>
          <li>You are responsible for the words you type and the pictures you upload. You must have the right to use them. Studio refuses some content, and we may pause Studio on an account that repeatedly asks for it.</li>
          <li>You must read your design and confirm the spelling before you approve it. We print exactly the file you approved.</li>
          <li>Studio prices are shown with VAT before you pay. A design that cannot be made is refunded automatically. Packs of designs do not expire.</li>
          <li>The credit that comes off a print order applies once, to one Brandit print order, within the time shown when you approve the design.</li>
          <li>We may change, pause or stop Studio, or the companies it uses. If we stop Studio, designs you have paid for and not yet used are refunded or finished.</li>
        </ul>
      </LSection>

      <LSection {...sec('proofs')}>
        <ul>
          <li>Before anything prints, you approve a proof. <strong>Please read it slowly.</strong> Check spelling, names, phone numbers, email addresses, prices, dates and colours.</li>
          <li>When you press &ldquo;Approve&rdquo;, we print exactly what you approved. If a mistake was in the approved proof, the Promise does not cover it and a reprint is a new order.</li>
          <li>If you do not respond to a proof for several days we will remind you. We cannot start printing or promise an arrival time until you approve.</li>
        </ul>
      </LSection>

      <LSection {...sec('delivery')}>
        <ul>
          <li>The arrival time we show is our commitment for your area and product. It is based on a working day (we work {s.working_days.length >= 6 ? 'Monday to Saturday' : 'on the days shown in your checkout'}), and public holidays are not working days.</li>
          <li><strong>24-hour orders:</strong> order before {t(s.cutoff_time)} on a working day with a file that passes our check, and an eligible job arrives the next working day by {t(s.arrive_by)}. We only offer 24-hour delivery when your product, quantity, size and area qualify at that moment, and when slots are available.</li>
          <li>If a 24-hour order arrives after the time we promised, we refund the delivery fee automatically, as long as the delay was ours (see section {TOC.findIndex((x) => x.id === 'beyond') + 1}). Your print itself is not refunded for lateness.</li>
          {s.windows_enabled && <li><strong>Delivery window:</strong> when you choose delivery, you can say whether you prefer the morning (9am to 1pm) or the afternoon (1pm to 5pm). We pass this to the rider as a plan for the day. <strong>It is a preference, not a change to your arrival time and not a separate promise.</strong> The arrival time we show at checkout and the Brandit Promise stay exactly as they are. A 24-hour order is always delivered in the afternoon. Pickup has no window.</li>}
          <li><strong>Rider link:</strong> when your order is out for delivery you may see a link to the rider&apos;s last known position on a map. It is shown only while the order is out for delivery and only if the rider&apos;s phone has shared its position in the last few minutes. A missing link does not mean your order is late, and a link does not change the time we promised. The position is deleted when the order is delivered.</li>
          <li>Delivery is by our riders and delivery partners to the address you give. Please make sure the address, landmark and phone number are right, and that someone can receive the parcel. At handover you give the rider your <strong>delivery code</strong>; only give it when you have your parcel.</li>
          <li>If we cannot reach you or no one can receive the parcel, we try again. Repeated failed deliveries may incur another delivery fee.</li>
          <li>For pickup, we tell you when your order is ready and where to collect it. Please collect it within a reasonable time. Orders not collected for 30 days may be recycled without a refund after we have tried to reach you.</li>
          <li>You become the owner of the goods and carry the risk when you receive them. Please check your order when it arrives.</li>
        </ul>
      </LSection>

      <LSection {...sec('custom')}>
        <p>For something that is not on our price list, send us a custom-order request. This is how it works:</p>
        <ul>
          <li>A request is a question, not an order. It does not commit you to buy or us to sell. It is free.</li>
          <li>A person replies with a quote, usually within {s.custom_reply_hours} hours on working days. The quote shows the price, how many working days it takes after you approve the proof, and how long the quote is open (currently {s.custom_quote_valid_days} days).</li>
          <li>If you accept, we create an order at the quoted price. You then pay the quoted price plus the delivery fee for your area (and VAT where it applies), and the order follows the normal steps: proof, approval, production and delivery.</li>
          <li>The quote is based on what you described. If the real job turns out to be different (a different size, quantity, material or amount of design work), we will tell you and send a new quote before going on.</li>
          <li>If a quote expires, you can ask us to renew it. Prices of materials can change.</li>
          <li>Coupon codes cannot be used on custom quotes.</li>
          <li>The Brandit Promise to reprint or refund applies to custom orders in the same way, against the proof you approved. The 24-hour option does not apply to custom orders.</li>
        </ul>
      </LSection>

      <LSection {...sec('events')}>
        <p><strong>Templates.</strong> A template is a ready-made starting point for a common job, such as a church programme, a wedding invitation or a menu card.</p>
        <ul>
          <li>You answer a few questions and choose a quantity. We design your first proof from your answers. A template order is a design order: the design fee shown at checkout applies, and the rules for our design service and for proofs (sections {TOC.findIndex((x) => x.id === 'design') + 1} and {TOC.findIndex((x) => x.id === 'proofs') + 1}) apply.</li>
          <li>The pictures on a template page show the style. They are not your finished design. The wording on your proof comes from what you typed, so please check every name, date, time and phone number on it before you approve.</li>
          <li>The quantity and price on a template are the same as on the product it uses. Delivery, VAT and any coupon work as they do for any other order.</li>
        </ul>
        <p><strong>Event plans.</strong> &ldquo;Plan my event&rdquo; lets you ask for several items for one event, such as invitations, programmes and a banner, in one request.</p>
        <ul>
          <li>You tell us the kind of event, the date, roughly how many guests and which items you want. The quantities we suggest are only suggestions. You can change them. The price shown on the form is a rough guide for printing only, not a quote.</li>
          <li>An event plan is handled like a custom order (see section {TOC.findIndex((x) => x.id === 'custom') + 1}). A person sends one quote for everything on the plan, including design. If you accept it, you pay once and we make and deliver the items together. Coupon codes and the 24-hour option do not apply.</li>
          <li>We aim to deliver {EVENT_BUFFER_DAYS} days before your event. Printing depends on you approving your proofs in good time, so we cannot promise an event date. The quote tells you honestly whether we can meet it. If you cannot meet it, we say so before you pay.</li>
          <li>The Brandit Promise applies to each item on the plan, against the proof you approved for that item.</li>
        </ul>
      </LSection>

      <LSection {...sec('coupons')}>
        <ul>
          <li>A coupon code gives you a discount: a percentage, a fixed amount, or free delivery. Each code shows what it gives and its conditions (for example a minimum order, an expiry date, or a limit on how many times it can be used).</li>
          <li>You enter a code at checkout. One code per order. Codes cannot be combined, exchanged for cash, or sold.</li>
          <li>A percentage or fixed-amount code reduces the print price only. It never reduces the delivery fee or design fee. A free-delivery code removes the delivery fee for that order.</li>
          <li>We check the code again when you pay. If the order changes so that the code no longer qualifies, the discount is taken off.</li>
          <li>A code may be limited to one use for each customer. We may stop or cancel a code that is abused, shared where it should not be, or created by mistake. A code we have already applied to a paid order stays honoured.</li>
          <li>If an order paid with a coupon is refunded, you get back what you actually paid, not the full price before the discount.</li>
        </ul>
      </LSection>

      <LSection {...sec('referrals')}>
        {s.referral_enabled ? (
          <ul>
            <li>Signed-in customers can get a personal referral code from their account page. A friend who uses it on their <strong>first order</strong> takes {s.referral_friend_percent}% off the print price{s.referral_friend_cap_kobo > 0 ? `, up to ${naira(s.referral_friend_cap_kobo)}` : ''}. The rules for coupon codes in section {TOC.findIndex((x) => x.id === 'coupons') + 1} apply to it.</li>
            <li>You cannot use your own code. A friend can use one referral code, on one first order.</li>
            <li>When your friend&apos;s order has been <strong>delivered</strong>, you earn a reward code worth {naira(s.referral_reward_kobo)} off your own next order. It is valid for {s.referral_reward_days} days and only you can use it. You earn one reward for each friend, and up to {s.referral_max_rewards} rewards in all. We tell you by message when you earn one.</li>
            <li>Rewards are not cash and cannot be sold or given to someone else. If the friend&apos;s order is cancelled or refunded before delivery, no reward is earned.</li>
            <li>Share your code with people you know. Do not send it to people who have not asked for it. We may cancel codes and rewards that come from fake accounts, orders placed only to collect rewards, or other abuse.</li>
            <li>We may change or stop the referral programme at any time. A reward you have already earned stays valid until the date shown on it.</li>
          </ul>
        ) : (
          <p>Referral codes are switched off at the moment. If we switch them on again, the rules will be shown here. A reward you have already earned stays valid until the date shown on it.</p>
        )}
      </LSection>

      <LSection {...sec('quality')}>
        <ul>
          <li><strong>Colour:</strong> colours on a phone or computer screen look different from ink on paper or fabric, and they change from one screen to another. Printed colours can also vary a little between print runs and materials. This is normal and is not a print fault.</li>
          <li><strong>Trim and position:</strong> paper is cut in stacks, so edges can move by a few millimetres. Keep important words and logos away from the edges.</li>
          <li><strong>Quantity:</strong> for some products a very small difference in count is normal in the trade. If you receive noticeably less than you paid for, tell us and we fix it.</li>
          <li><strong>Your file:</strong> a low-quality or small picture prints blurry. We warn you when we spot it. If you choose to go ahead anyway, the Promise does not cover blur that came from the file.</li>
        </ul>
      </LSection>

      <LSection {...sec('refunds')}>
        <p>The short version is below. The full details, with the steps to report a problem, are on our <Link href="/legal/refunds">Reprints and Refunds</Link> page.</p>
        <ul>
          <li><strong>Before we start:</strong> you can cancel a paid order for a full refund before your file or proof has been approved and before production starts. Message us with your order number.</li>
          <li><strong>After production starts:</strong> the job is made to order for you and cannot be cancelled or refunded for a change of mind.</li>
          <li><strong>Printed wrong, or damaged on the way:</strong> report it within {s.claim_window_hours} hours of delivery, with a photo if you can. We reprint it or refund you. This is the Brandit Promise.</li>
          <li><strong>Late 24-hour order:</strong> the delivery fee is refunded automatically.</li>
          <li><strong>Not covered:</strong> mistakes in a proof you approved; the normal screen-to-paper colour difference; blur from a low-quality file you chose to use; and a change of mind after production starts.</li>
          <li>Refunds go back to the way you paid, through our payment provider. Your bank decides how fast it shows in your account.</li>
          <li>Nothing here takes away your rights under Nigerian consumer-protection law.</li>
        </ul>
      </LSection>

      <LSection {...sec('liability')}>
        <ul>
          <li>We do our work with reasonable care and skill, and we stand behind the Promise.</li>
          <li>Apart from the Promise, our responsibility for any one order is limited to the amount you paid for that order. We are not responsible for indirect losses, such as lost sales, lost profit or an event that went ahead without your print, even if you told us about the event. If a date is critical, tell us when you order so that we can say honestly whether we can meet it.</li>
          <li>Nothing in these terms limits liability that the law does not allow us to limit, including liability for death or personal injury caused by negligence, and for fraud.</li>
        </ul>
      </LSection>

      <LSection {...sec('beyond')}>
        <p>Some things are outside our control: power cuts and fuel shortages, floods, road closures, protests, strikes, curfews, failures of the internet, the telephone network or payment providers, and other events a reasonable business cannot prevent. When this happens we may need more time. We tell you as early as we can and give you the new time. If the delay is long, you can cancel the unprinted part of the order for a refund. We do not refund the delivery fee on a 24-hour order when the delay is caused by one of these events.</p>
      </LSection>

      <LSection {...sec('messages')}>
        <ul>
          <li>We send messages about your order by WhatsApp, SMS and email: payment confirmation, proofs, delivery and problems. These are part of the service.</li>
          {s.nudge_enabled && <li><strong>Unpaid-order reminder:</strong> if you fill in your details at checkout and do not pay, we may send you one reminder, by WhatsApp or SMS, with a link to carry on. We send it at most once for an order, only between 8am and 8pm Lagos time, and not at all if you have paid for something newer. You can turn it off in your account (&ldquo;Remind me once if I leave an order unpaid&rdquo;) or by telling us.</li>}
          <li>We send reorder reminders and offers only if you chose to receive them. You can turn them off in your account at any time.</li>
          {s.pidgin_enabled && <li>You can read the site and get our messages in English or in Nigerian Pidgin. English is the default. If the two ever differ, the English wording of these terms is the one that counts.</li>}
          <li>After delivery we may ask for a review. We show your review on our site only if you agree when you leave it, and we show only your first name and the product.</li>
          <li><strong>Review photos:</strong> you may add a photo of your finished job. It is private at first. A person at Brandit looks at it before anyone else can. We show it on our site only if you tick the separate box that allows it and we choose to feature your review. We may refuse a photo that shows other people&apos;s faces, personal details such as phone numbers, plate numbers or documents, or anything that is not your printed item. We remove the location and camera details from every photo. A photo we do not use is deleted, and a photo nobody has checked is deleted after 60 days. You can ask us to remove your photo or review at any time.</li>
          <li>Please be respectful to our staff and riders. We may stop serving anyone who threatens or abuses them.</li>
        </ul>
      </LSection>

      <LSection {...sec('data')}>
        <p>We collect and use your personal information as described in our <Link href="/legal/privacy">Privacy Policy</Link>, in line with the Nigeria Data Protection Act 2023. You can ask for a copy of your data or for your account to be deleted from your account page.</p>
      </LSection>

      <LSection {...sec('changes')}>
        <p>We may update these terms from time to time. The date at the top shows the latest version. A change applies to orders placed after it is published. An order you have already paid for stays under the terms it was placed under. If we make a big change, we say so on the site.</p>
      </LSection>

      <LSection {...sec('law')}>
        <ul>
          <li>These terms are governed by the laws of the Federal Republic of Nigeria.</li>
          <li>If you are unhappy, please talk to us first on WhatsApp. Most problems are solved in a day. If we cannot agree, either of us can take the matter to the courts of Lagos State, Nigeria, or to another body that has power over consumer complaints in Nigeria.</li>
        </ul>
      </LSection>

      <LSection {...sec('contact')}>
        <ul>
          <li>{SITE.name}, operated by {SITE.owner}, Lagos, Nigeria.</li>
          {c.whatsapp && <li>WhatsApp: <a href={c.whatsappLink()!}>message us</a> ({c.hours}, we reply within {c.replyWithin}).</li>}
          {c.email && <li>Email: <a href={`mailto:${c.email}`}>{c.email}</a></li>}
          {c.address && <li>Address: {c.address}</li>}
          {!c.whatsapp && !c.email && <li>See our <Link href="/contact">contact page</Link> for how to reach us. We are available {c.hours}.</li>}
        </ul>
      </LSection>
    </LegalPage>
  );
}
